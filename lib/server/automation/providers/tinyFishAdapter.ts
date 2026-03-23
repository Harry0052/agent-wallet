import 'server-only';

import type { AutomationActionType } from '@/lib/types';
import type { AutomationActionRecord } from '@/lib/server/automation/types';
import type {
  AutomationIntegrationHook,
  AutomationHookAttemptResult,
} from '@/lib/server/automation/integrationHooks';
import type {
  ExecutionTaskPayload,
  ExecutionTaskResult,
  ExecutionStatus,
  FailureReason,
} from './types';
import { isActionLive } from './types';
import { createActionPlan } from './actionPlanner';
import { logServerEvent } from '@/lib/server/observability';

// ── Tiny Fish Configuration ─────────────────────────────────────────────────

const TINY_FISH_BASE_URL = process.env.TINY_FISH_API_URL || '';
const TINY_FISH_API_KEY = process.env.TINY_FISH_API_KEY || '';
const TINY_FISH_TIMEOUT_MS = 120_000; // 2 minutes per execution attempt
const TINY_FISH_MAX_RETRIES = 2;
const TINY_FISH_RETRY_DELAY_MS = 3_000;

/** Action types routed to Tiny Fish for browser-based execution */
const TINY_FISH_SUPPORTED_ACTIONS = new Set<AutomationActionType>([
  'subscription_cancel',
  'subscription_negotiate',
  'trial_conversion_review',
]);

function isTinyFishConfigured(): boolean {
  return Boolean(TINY_FISH_BASE_URL && TINY_FISH_API_KEY);
}

// ── Payload Builder ─────────────────────────────────────────────────────────

function buildTinyFishPayload(action: AutomationActionRecord): ExecutionTaskPayload {
  const targetService =
    (action.payload?.merchant as string)
    || (action.payload?.targetService as string)
    || 'Unknown service';

  const plan = createActionPlan({
    actionType: action.actionType,
    targetService,
  });

  return {
    taskId: action.id,
    userId: action.userId,
    actionType: action.actionType,
    targetService,
    intent: action.actionType,
    originalPrompt: (action.payload?.originalPrompt as string) || action.summary,
    parameters: {
      merchant: targetService,
      amount: action.amount,
      currency: action.currency,
      ...action.payload,
      executionPlan: {
        steps: plan.steps.map((s) => s.label),
        riskLevel: plan.riskLevel,
        requiresCredentials: plan.requiresCredentials,
        estimatedDuration: plan.estimatedDuration,
      },
    },
    riskLevel: plan.riskLevel,
    requiresApproval: action.requiresExplicitConfirmation,
    idempotencyKey: `tinyfish:${action.id}:${action.status}:${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
}

// ── HTTP Client ─────────────────────────────────────────────────────────────

async function callTinyFish(
  endpoint: string,
  payload: unknown,
): Promise<ExecutionTaskResult> {
  const url = `${TINY_FISH_BASE_URL}${endpoint}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TINY_FISH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TINY_FISH_API_KEY}`,
        'X-Idempotency-Key': (payload as Record<string, unknown>)?.idempotencyKey as string ?? '',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'no body');
      throw new Error(`Tiny Fish returned ${response.status}: ${errorBody.slice(0, 200)}`);
    }

    return (await response.json()) as ExecutionTaskResult;
  } finally {
    clearTimeout(timeout);
  }
}

/** Retry wrapper with exponential-ish backoff */
async function callTinyFishWithRetry(
  endpoint: string,
  payload: unknown,
): Promise<ExecutionTaskResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= TINY_FISH_MAX_RETRIES; attempt++) {
    try {
      return await callTinyFish(endpoint, payload);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on client errors (4xx)
      if (lastError.message.includes('returned 4')) break;

      if (attempt < TINY_FISH_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, TINY_FISH_RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error('Tiny Fish execution failed');
}

// ── Result Normalization ────────────────────────────────────────────────────

function normalizeStatus(status: ExecutionStatus): 'completed' | 'failed' {
  if (status === 'completed') return 'completed';
  return 'failed';
}

function normalizeFailureMessage(result: ExecutionTaskResult): string {
  const reason = result.failureReason as FailureReason | undefined;

  switch (reason) {
    case 'login_failed':
      return 'Calico couldn\'t log in to the service. Please check your credentials and try again.';
    case 'otp_expired':
      return 'The verification code expired before Calico could use it. Try again and enter the code promptly.';
    case 'otp_required':
      return 'The service requires a verification code. Calico will ask for it when needed.';
    case 'captcha_required':
      return 'The service presented a CAPTCHA that Calico couldn\'t solve. You may need to complete this step manually.';
    case 'site_changed':
      return 'The service\'s website has changed and Calico couldn\'t complete the action. We\'ll update our integration.';
    case 'action_blocked':
      return 'The service blocked the action. This may require contacting their support directly.';
    case 'partial_success':
      return 'Calico partially completed the action but couldn\'t finish. Check the details below.';
    case 'timeout':
      return 'The action took too long and timed out. You can try again.';
    case 'rate_limited':
      return 'The service is rate-limiting requests. Try again in a few minutes.';
    case 'credentials_missing':
      return 'Calico needs your login credentials for this service. Please add them and try again.';
    case 'unsupported_service':
      return 'This specific service isn\'t supported for automated actions yet. We\'re expanding coverage.';
    default:
      return result.outcome || 'The action couldn\'t be completed. You can try again or do it manually.';
  }
}

function buildHumanOutcome(result: ExecutionTaskResult): string {
  if (result.status === 'completed') {
    if (result.evidence.length > 0) {
      const confirmations = result.evidence
        .filter((e) => e.type === 'confirmation_number')
        .map((e) => e.value);
      if (confirmations.length > 0) {
        return `${result.outcome} Confirmation: ${confirmations[0]}`;
      }
    }
    return result.outcome;
  }

  return normalizeFailureMessage(result);
}

// ── Integration Hook ────────────────────────────────────────────────────────

/**
 * Tiny Fish integration hook for the Calico automation system.
 *
 * This adapter:
 * 1. Checks if the action type is supported by Tiny Fish
 * 2. Builds a provider-agnostic payload
 * 3. Sends it to Tiny Fish with retry logic
 * 4. Normalizes the response for the Calico state machine
 *
 * If Tiny Fish is not configured (no env vars), all actions gracefully
 * return as unsupported with a clear message.
 */
class TinyFishIntegrationHook implements AutomationIntegrationHook {
  key = 'tinyfish';

  supports(actionType: AutomationActionType): boolean {
    return TINY_FISH_SUPPORTED_ACTIONS.has(actionType) && isActionLive(actionType);
  }

  async attempt(input: { action: AutomationActionRecord }): Promise<AutomationHookAttemptResult> {
    const { action } = input;

    // Guard: Tiny Fish not configured
    if (!isTinyFishConfigured()) {
      logServerEvent('info', 'tinyfish.not_configured', {
        actionId: action.id,
        actionType: action.actionType,
      });

      return {
        supported: true,
        status: 'failed',
        message: 'Action execution is not yet configured. The Tiny Fish service connection needs to be set up.',
        metadata: {
          provider: 'tinyfish',
          reason: 'not_configured',
        },
      };
    }

    const payload = buildTinyFishPayload(action);

    logServerEvent('info', 'tinyfish.attempt.start', {
      actionId: action.id,
      actionType: action.actionType,
      targetService: payload.targetService,
      idempotencyKey: payload.idempotencyKey,
    });

    try {
      const result = await callTinyFishWithRetry('/v1/tasks/execute', payload);

      const status = normalizeStatus(result.status);
      const message = buildHumanOutcome(result);

      logServerEvent(
        status === 'completed' ? 'info' : 'warn',
        `tinyfish.attempt.${status}`,
        {
          actionId: action.id,
          actionType: action.actionType,
          providerTaskId: result.providerTaskId,
          status: result.status,
          failureReason: result.failureReason,
          stepsCompleted: result.steps.filter((s) => s.status === 'completed').length,
          stepsTotal: result.steps.length,
          evidenceCount: result.evidence.length,
        },
      );

      return {
        supported: true,
        status,
        message,
        metadata: {
          provider: 'tinyfish',
          providerTaskId: result.providerTaskId,
          steps: result.steps,
          evidence: result.evidence,
          nextSteps: result.nextSteps,
          failureReason: result.failureReason,
          executionDuration: result.completedAt && result.startedAt
            ? `${Math.round((Date.parse(result.completedAt) - Date.parse(result.startedAt)) / 1000)}s`
            : null,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Tiny Fish error';

      logServerEvent('error', 'tinyfish.attempt.error', {
        actionId: action.id,
        actionType: action.actionType,
        error: message,
      });

      return {
        supported: true,
        status: 'failed',
        message: 'Calico couldn\'t reach the execution service. This is usually temporary — try again in a moment.',
        metadata: {
          provider: 'tinyfish',
          reason: 'provider_error',
          error: message,
        },
      };
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

export const tinyFishHook = new TinyFishIntegrationHook();
