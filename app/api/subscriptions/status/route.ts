import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError } from '@/lib/server/auth';
import { listWebActionsForTask } from '@/lib/server/ledger';
import { listActiveSubscriptions, listSubscriptionActions } from '@/lib/server/subscriptions';
import type { ProcurementLifecycleState, ProcurementResearchLog } from '@/lib/types';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { RequestValidationError, validateSearchParams } from '@/security/requestValidator';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  taskId: z.string().trim().optional(),
});

function toLog(action: Awaited<ReturnType<typeof listWebActionsForTask>>[number]): ProcurementResearchLog {
  const details = action.details as Record<string, unknown> | undefined;
  const message = typeof details?.message === 'string'
    ? details.message
    : action.actionType;

  return {
    id: action.id,
    taskId: action.taskId,
    actionType: action.actionType,
    status: action.status,
    message,
    url: action.url,
    phase: typeof details?.phase === 'string' ? details.phase : undefined,
    event: typeof details?.event === 'string' ? details.event : undefined,
    code: typeof details?.code === 'string' ? details.code : undefined,
    createdAt: action.createdAt,
  };
}

function subscriptionLifecycle(input: {
  selectedTaskId?: string;
  actions: Awaited<ReturnType<typeof listSubscriptionActions>>;
}): ProcurementLifecycleState {
  if (!input.selectedTaskId) {
    return {
      phase: 'subscription_ops',
      canRetry: true,
      retryHint: 'Approve and prepare a procurement task before running subscription operations.',
    };
  }

  const running = input.actions.some((action) => action.taskId === input.selectedTaskId && action.status === 'running');
  if (running) {
    return {
      phase: 'subscription_ops',
      canRetry: false,
      retryHint: 'A subscription operation is running now.',
    };
  }

  return {
    phase: 'subscription_ops',
    canRetry: true,
    retryHint: 'Select an operation to run, or retry a blocked/failed action after fixing the blocker.',
  };
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'subscriptions' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const params = validateSearchParams(req.nextUrl.searchParams, QuerySchema);

    const userId = auth.auth.walletUserId;
    const [activeSubscriptions, actions] = await Promise.all([
      listActiveSubscriptions(userId),
      listSubscriptionActions({
        userId,
        taskId: params.taskId,
        limit: 100,
      }),
    ]);

    const selectedTaskId = params.taskId || activeSubscriptions[0]?.taskId;
    const logs = selectedTaskId
      ? await listWebActionsForTask({
        userId,
        taskId: selectedTaskId,
        limit: 120,
      })
      : [];

    return NextResponse.json({
      ok: true,
      activeSubscriptions,
      actions,
      logs: logs.map(toLog),
      selectedTaskId,
      lifecycle: subscriptionLifecycle({
        selectedTaskId,
        actions,
      }),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }

    if (error instanceof RequestValidationError) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }

    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to load subscriptions status';

    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'subscriptions.status.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
