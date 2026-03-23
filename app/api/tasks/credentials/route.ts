import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceEntitlement } from '@/security/entitlementGuard';
import { logServerEvent } from '@/lib/server/observability';
import {
  getCredentialRequest,
  listCredentialRequestsForTask,
  submitCredential,
  revokeCredentialRequest,
} from '@/lib/server/automation/credentialVault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const submitSchema = z.object({
  command: z.literal('submit'),
  requestId: z.string().uuid(),
  value: z.string().min(1).max(500),
});

const revokeSchema = z.object({
  command: z.literal('revoke'),
  requestId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

const commandSchema = z.discriminatedUnion('command', [submitSchema, revokeSchema]);

/**
 * GET /api/tasks/credentials?taskId=xxx
 * List pending credential requests for a task.
 */
export async function GET(req: NextRequest) {
  const guard = await enforceEntitlement(req, {
    requiredFeature: 'ai_automation',
    rateLimitScope: 'task_credentials',
  });
  if (!guard.ok) return guard.response;

  const taskId = req.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ ok: false, error: 'taskId is required' }, { status: 400 });
  }

  const requests = listCredentialRequestsForTask({
    taskId,
    userId: guard.ctx.auth.walletUserId,
  });

  // Strip any internal data — only return what the UI needs
  const safeRequests = requests.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    service: r.service,
    inputType: r.inputType,
    prompt: r.prompt,
    hint: r.hint,
    expiresAt: r.expiresAt,
  }));

  return NextResponse.json({ ok: true, requests: safeRequests });
}

/**
 * POST /api/tasks/credentials
 * Submit or revoke a credential.
 */
export async function POST(req: NextRequest) {
  const guard = await enforceEntitlement(req, {
    requiredFeature: 'ai_automation',
    rateLimitScope: 'task_credentials_submit',
  });
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const userId = guard.ctx.auth.walletUserId;

  if (parsed.data.command === 'submit') {
    // Verify the request exists and belongs to this user
    const request = getCredentialRequest({
      requestId: parsed.data.requestId,
      userId,
    });

    if (!request) {
      return NextResponse.json(
        { ok: false, error: 'Credential request not found or expired.' },
        { status: 404 },
      );
    }

    const result = submitCredential({
      requestId: parsed.data.requestId,
      userId,
      value: parsed.data.value,
    });

    if (!result) {
      return NextResponse.json(
        { ok: false, error: 'Could not store credential. It may have expired.' },
        { status: 410 },
      );
    }

    logServerEvent('info', 'credential.submitted_via_api', {
      requestId: parsed.data.requestId,
      userId,
      taskId: request.taskId,
      service: request.service,
      inputType: request.inputType,
      // NEVER log: parsed.data.value, result.accessToken
    });

    // Return success — the access token is NOT sent to the client.
    // It stays server-side for the execution engine to use.
    return NextResponse.json({
      ok: true,
      message: 'Credential received securely. Calico will continue the task.',
    });
  }

  if (parsed.data.command === 'revoke') {
    const revoked = revokeCredentialRequest({
      requestId: parsed.data.requestId,
      userId,
      reason: parsed.data.reason ?? 'User cancelled',
    });

    return NextResponse.json({
      ok: true,
      revoked,
      message: revoked ? 'Credential request cancelled.' : 'Request not found.',
    });
  }

  return NextResponse.json({ ok: false, error: 'Unknown command' }, { status: 400 });
}
