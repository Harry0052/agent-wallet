import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError } from '@/lib/server/auth';
import { recordWebAction } from '@/lib/server/ledger';
import { getProcurementTask } from '@/lib/server/procurement';
import { parseProcurementRecommendation } from '@/lib/server/procurementRecommendation';
import { createSubscriptionAction, listSubscriptionActions } from '@/lib/server/subscriptions';
import { runSubscriptionOperation } from '@/lib/server/subscriptionOperationRunner';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { RequestValidationError, validateJsonBody } from '@/security/requestValidator';

export const runtime = 'nodejs';

const BodySchema = z.object({
  taskId: z.string().trim().min(1),
  operation: z.enum(['inspect_billing', 'renewal_check', 'downgrade', 'cancel', 'switch_billing']),
});

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'subscriptions' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await validateJsonBody(req, BodySchema);
    const userId = auth.auth.walletUserId;
    logServerEvent('info', 'subscriptions.operate.requested', {
      userId,
      taskId: body.taskId,
      operation: body.operation,
    });

    const task = await getProcurementTask({ taskId: body.taskId, userId });
    if (!task) {
      return NextResponse.json(apiError('NOT_FOUND', 'Subscription task not found', true), { status: 404 });
    }

    const recommendation = parseProcurementRecommendation(task.recommendation);
    if (!recommendation || !recommendation.winner) {
      return NextResponse.json(
        apiError('INVALID_STATE', 'No approved subscription target found for this task.', true),
        { status: 409 },
      );
    }

    if (recommendation.approval?.decision !== 'approved') {
      return NextResponse.json(
        apiError('INVALID_STATE', 'Task must be approved before subscription operations can run.', true),
        { status: 409 },
      );
    }

    const allowedTaskStates: Array<typeof task.status> = ['purchase_prepared', 'purchase_preparing', 'awaiting_approval', 'researched'];
    if (!allowedTaskStates.includes(task.status)) {
      return NextResponse.json(
        apiError('INVALID_STATE', `Subscription operations cannot start while task is in ${task.status} state`, true),
        { status: 409 },
      );
    }

    const recent = await listSubscriptionActions({
      userId,
      taskId: task.id,
      limit: 16,
    });

    const running = recent.find((action) => action.status === 'running' && action.operation === body.operation);
    if (running) {
      logServerEvent('info', 'subscriptions.operate.idempotent', {
        userId,
        taskId: task.id,
        actionId: running.id,
        operation: body.operation,
      });
      return NextResponse.json({ ok: true, started: false, action: running, taskId: task.id });
    }

    const action = await createSubscriptionAction({
      userId,
      taskId: task.id,
      operation: body.operation,
    });

    await recordWebAction({
      userId,
      taskId: task.id,
      actionType: 'plan',
      status: 'running',
      url: recommendation.purchasePrep?.checkoutUrl || recommendation.winner.pricingPageUrl,
      details: {
        id: randomUUID(),
        phase: 'subscription_ops',
        event: 'subscription_operation_queued',
        code: 'SUBSCRIPTION_OPERATION_QUEUED',
        actionId: action.id,
        operation: body.operation,
        message: `subscription operation queued: ${body.operation} for ${recommendation.winner.vendorName}`,
      },
    });

    void runSubscriptionOperation({ userId, actionId: action.id }).catch((error) => {
      logServerEvent('error', 'subscriptions.operate.background_failed', {
        userId,
        actionId: action.id,
        taskId: task.id,
        operation: body.operation,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return NextResponse.json({
      ok: true,
      started: true,
      action,
      taskId: task.id,
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
        : 'Failed to start subscription operation';

    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'subscriptions.operate.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
