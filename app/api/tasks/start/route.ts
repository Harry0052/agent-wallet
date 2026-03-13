import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { classifyRequest } from '@/lib/ai/classifier';
import {
  canUseTinyFish,
  recordTinyFishCall,
  TINYFISH_LIMIT_ERROR_MESSAGE,
} from '@/lib/ai/tinyfishUsage';
import { getWalletUserId } from '@/lib/server/ledger';
import { isAuthError } from '@/lib/server/auth';
import { createTask } from '@/lib/server/tasks';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { getRequiredSecret } from '@/security/secretsManager';
import { sanitizeAiText } from '@/security/aiSanitizer';
import { PromptInjectionError, assertPromptSafe } from '@/security/promptGuard';
import { getRuntimeCredentialById } from '@/lib/server/toolsVault';

export const runtime = 'nodejs';

const CredentialsSchema = z.object({
  email: z.string().trim().optional(),
  // password: user-supplied only when no vault secret exists for the chosen tool.
  password: z.string().optional(),
  verificationCode: z.string().trim().optional(),
}).optional();

const BodySchema = z.object({
  prompt: z.string().trim().min(1, 'prompt is required'),
  // sourceButton must be "task" — hard route guard, no fallthrough to research/general.
  sourceButton: z.literal('task').optional(),
  // userToolId: references a saved tool to inject credentials from server side.
  userToolId: z.string().trim().optional(),
  // credentials: user-supplied fields (email, verificationCode only — never password).
  credentials: CredentialsSchema,
});

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function extractRunData(payload: Record<string, unknown>): {
  runId: string | null;
  runUrl: string | null;
  status: string;
  tokensUsed: number;
} {
  const dataRecord = asRecord(payload.data);

  const runId = pickString(payload, ['run_id', 'runId', 'id'])
    || pickString(dataRecord, ['run_id', 'runId', 'id']);

  const runUrlFromPayload = pickString(payload, ['run_url', 'runUrl', 'url'])
    || pickString(dataRecord, ['run_url', 'runUrl', 'url']);

  const runUrl = runUrlFromPayload
    || (runId ? `https://agent.tinyfish.ai/run/${runId}` : null);

  const status = (
    pickString(payload, ['status'])
    || pickString(dataRecord, ['status'])
    || 'running'
  ).toLowerCase();

  const usage = asRecord(payload.usage);
  const dataUsage = asRecord(dataRecord.usage);

  const tokensUsed = pickNumber(payload, ['total_tokens', 'tokens_used'])
    || pickNumber(dataRecord, ['total_tokens', 'tokens_used'])
    || pickNumber(usage, ['total_tokens', 'tokens', 'tokens_used'])
    || pickNumber(dataUsage, ['total_tokens', 'tokens', 'tokens_used'])
    || 0;

  return {
    runId,
    runUrl,
    status,
    tokensUsed: Math.max(0, Math.floor(tokensUsed)),
  };
}

function normalizeTaskStatus(status: string): 'running' | 'completed' | 'failed' | 'canceled' {
  const lower = status.toLowerCase();
  if (lower.includes('complete') || lower.includes('success')) return 'completed';
  if (lower.includes('fail') || lower.includes('error')) return 'failed';
  if (lower.includes('cancel')) return 'canceled';
  return 'running';
}

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());
    const { prompt, sourceButton, userToolId, credentials } = body;

    assertPromptSafe(prompt, 'api.tasks.start.prompt');

    // Hard route guard: only the Task button (sourceButton === 'task') or a
    // server-verified task classification may reach TinyFish.
    const userId = await getWalletUserId();
    const safePrompt = sanitizeAiText(prompt);
    const requestType = classifyRequest(safePrompt);

    logServerEvent('info', 'tasks.start.routing', {
      sourceButton: sourceButton ?? 'unset',
      classifiedRequestType: requestType,
      hasUserToolId: Boolean(userToolId),
      hasEmail: Boolean(credentials?.email),
      hasVerificationCode: Boolean(credentials?.verificationCode),
    });

    // If sourceButton is explicitly 'task', we trust the button source as the
    // authoritative gate. Only fall back to classifier if sourceButton is absent.
    const isTaskIntent = sourceButton === 'task' || requestType === 'task';

    if (!isTaskIntent) {
      logServerEvent('warn', 'tasks.start.blocked', {
        reason: 'not_task_intent',
        sourceButton: sourceButton ?? 'unset',
        classifiedRequestType: requestType,
      });
      return NextResponse.json(
        apiError('INVALID_STATE', `TinyFish tasks can only be started from task intents. Classified as: ${requestType}.`, true),
        { status: 409 },
      );
    }

    const usageDecision = canUseTinyFish({ sessionId: userId });
    if (!usageDecision.allowed) {
      return NextResponse.json(
        apiError('POLICY_FAILURE', usageDecision.error || TINYFISH_LIMIT_ERROR_MESSAGE, true),
        { status: 429 },
      );
    }

    const apiKey = getRequiredSecret('TINYFISH_API_KEY');
    const endpoint = process.env.TINYFISH_AUTOMATION_RUN_URL || 'https://agent.tinyfish.ai/v1/automation/run';
    const startUrl = process.env.TINYFISH_AUTOMATION_START_URL;

    // Resolve credentials: vault-stored secret takes priority over user-supplied fields.
    let resolvedEmail: string | null = credentials?.email ?? null;
    let resolvedPassword: string | null = credentials?.password ?? null;

    if (userToolId) {
      try {
        const vaultCred = await getRuntimeCredentialById({ userId, userToolId, actionType: 'task_run' });
        if (vaultCred) {
          // Vault email overrides manually-typed email
          if (vaultCred.loginIdentifier) resolvedEmail = vaultCred.loginIdentifier;
          // Vault password overrides manually-typed password
          if (vaultCred.credentialText) resolvedPassword = vaultCred.credentialText;
          logServerEvent('info', 'tasks.start.vault_resolved', {
            toolKey: vaultCred.toolKey,
            hasEmail: Boolean(vaultCred.loginIdentifier),
            hasPassword: Boolean(vaultCred.credentialText),
          });
        }
      } catch (vaultErr) {
        // Non-fatal — fall through to manually-supplied credentials
        logServerEvent('warn', 'tasks.start.vault_error', {
          userToolId,
          error: vaultErr instanceof Error ? vaultErr.message : 'unknown',
        });
      }
    }

    // Build enriched goal with explicit manual-login-only instruction so TinyFish
    // does not attempt Google/Apple/SSO sign-in flows.
    const loginInstruction =
      'IMPORTANT: Use manual email/password login ONLY. Do NOT use "Sign in with Google", "Sign in with Apple", or any SSO/OAuth option. Navigate directly to the manual login form and type the credentials.';

    let enrichedGoal = `${safePrompt}\n\n${loginInstruction}`;

    if (resolvedEmail) {
      enrichedGoal += `\nLogin email: ${resolvedEmail}`;
    }
    if (resolvedPassword) {
      enrichedGoal += `\nLogin password: ${resolvedPassword}`;
    }
    if (credentials?.verificationCode) {
      enrichedGoal += `\nVerification / 2FA code: ${credentials.verificationCode}`;
    }

    logServerEvent('info', 'tasks.start.credential_summary', {
      hasEmail: Boolean(resolvedEmail),
      hasPassword: Boolean(resolvedPassword),
      hasVerificationCode: Boolean(credentials?.verificationCode),
      source: userToolId ? 'vault' : 'manual',
    });

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        goal: enrichedGoal,
        ...(startUrl ? { url: startUrl } : {}),
        ...(userToolId ? { userToolId } : {}),
      }),
      cache: 'no-store',
    });

    const rawText = await upstream.text();
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new Error(`TinyFish returned non-JSON run creation response: ${rawText.slice(0, 240)}`);
    }

    if (!upstream.ok) {
      const providerError = pickString(payload, ['error', 'message']) || 'TinyFish run creation failed';
      throw new Error(`${providerError} (${upstream.status})`);
    }

    const run = extractRunData(payload);
    if (!run.runId) {
      throw new Error('TinyFish run creation did not return run_id');
    }

    const task = await createTask({
      userId,
      prompt: safePrompt,
      tinyfishRunId: run.runId,
      tinyfishRunUrl: run.runUrl,
      status: normalizeTaskStatus(run.status),
    });

    recordTinyFishCall({
      sessionId: userId,
      tokensUsed: run.tokensUsed,
      taskLabel: safePrompt.slice(0, 120),
    });

    return NextResponse.json({
      ok: true,
      task,
      requestType,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }

    if (error instanceof PromptInjectionError) {
      return NextResponse.json(apiError('POLICY_FAILURE', error.message, true), { status: error.status });
    }

    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to start TinyFish task';

    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'tasks.start.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
