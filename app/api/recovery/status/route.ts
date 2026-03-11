import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { createRecoveryEngine, groupRecoveryRecords } from '@/lib/recovery/recoveryEngine';
import { runRecoveryReconciliationCycle } from '@/lib/reconciliation/reconcileFailedPurchases';
import { createReversalService } from '@/lib/refunds/reversalService';
import { createRefundService } from '@/lib/refunds/refundService';
import { isAdminOverrideAuthorized } from '@/lib/recovery/policies';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const QuerySchema = z.object({
  recoveryCaseId: z.string().trim().optional(),
  unresolvedOnly: z.enum(['true', 'false']).optional(),
  autoReconcile: z.enum(['true', 'false']).optional(),
  autoRecover: z.enum(['true', 'false']).optional(),
  syncRefundStatus: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const BodySchema = z.object({
  action: z.enum(['reconcile', 'retry_recovery', 'force_reversal', 'export_evidence']),
  recoveryCaseId: z.string().trim().optional(),
  idempotencyKey: z.string().trim().optional(),
  reason: z.string().trim().optional(),
  autoRecover: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
}).superRefine((value, ctx) => {
  if ((value.action === 'retry_recovery' || value.action === 'force_reversal' || value.action === 'export_evidence') && !value.recoveryCaseId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recoveryCaseId'],
      message: 'recoveryCaseId is required for this action',
    });
  }
});

function toDetailExport(detail: Awaited<ReturnType<ReturnType<typeof createRecoveryEngine>['detail']>>): {
  generatedAt: string;
  case: unknown;
  auditTimeline: unknown;
} | null {
  if (!detail) return null;
  return {
    generatedAt: new Date().toISOString(),
    case: detail.record,
    auditTimeline: detail.auditLogs,
  };
}

async function loadStatus(input: {
  userId: string;
  recoveryCaseId?: string;
  unresolvedOnly?: boolean;
  autoReconcile?: boolean;
  autoRecover?: boolean;
  syncRefundStatus?: boolean;
  limit?: number;
}) {
  const engine = createRecoveryEngine();

  let reconciliation: Awaited<ReturnType<typeof runRecoveryReconciliationCycle>> | null = null;
  if (input.autoReconcile !== false) {
    reconciliation = await runRecoveryReconciliationCycle({
      userId: input.userId,
      autoRecover: input.autoRecover !== false,
      limit: input.limit,
    });
  }

  if (input.syncRefundStatus) {
    const pending = await engine.list({
      userId: input.userId,
      unresolvedOnly: true,
      limit: Math.min(input.limit || 150, 150),
    });

    const refundService = createRefundService({ recoveryStore: engine.store });
    for (const record of pending.records) {
      if (!record.paymentFlowId) continue;
      if (
        record.currentState !== 'refund_requested'
        && record.currentState !== 'refund_in_progress'
        && record.currentState !== 'refund_available'
        && record.recommendedRecoveryAction !== 'request_refund'
      ) {
        continue;
      }
      await refundService.syncRefundStatus({
        userId: input.userId,
        recoveryCaseId: record.id,
      }).catch(() => null);
    }
  }

  const list = await engine.list({
    userId: input.userId,
    unresolvedOnly: input.unresolvedOnly !== false,
    limit: input.limit,
  });

  const buckets = groupRecoveryRecords(list.records);

  const detail = input.recoveryCaseId
    ? await engine.detail({ userId: input.userId, recoveryCaseId: input.recoveryCaseId })
    : null;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    reconciliation,
    summary: list.summary,
    records: list.records,
    groups: {
      canBeRestoredInstantly: buckets.canBeRestoredInstantly,
      refundInProgress: buckets.refundInProgress,
      needsReview: buckets.needsReview,
    },
    detail,
  };
}

export async function GET(req: NextRequest) {
  const userId = await getWalletUserId();

  try {
    const query = QuerySchema.parse({
      recoveryCaseId: req.nextUrl.searchParams.get('recoveryCaseId') || undefined,
      unresolvedOnly: req.nextUrl.searchParams.get('unresolvedOnly') || undefined,
      autoReconcile: req.nextUrl.searchParams.get('autoReconcile') || undefined,
      autoRecover: req.nextUrl.searchParams.get('autoRecover') || undefined,
      syncRefundStatus: req.nextUrl.searchParams.get('syncRefundStatus') || undefined,
      limit: req.nextUrl.searchParams.get('limit') || undefined,
    });

    const payload = await loadStatus({
      userId,
      recoveryCaseId: query.recoveryCaseId,
      unresolvedOnly: query.unresolvedOnly ? query.unresolvedOnly === 'true' : undefined,
      autoReconcile: query.autoReconcile ? query.autoReconcile === 'true' : undefined,
      autoRecover: query.autoRecover ? query.autoRecover === 'true' : undefined,
      syncRefundStatus: query.syncRefundStatus ? query.syncRefundStatus === 'true' : undefined,
      limit: query.limit,
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to load recovery status';

    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'recovery.status.failed', {
      userId,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}

export async function POST(req: NextRequest) {
  const userId = await getWalletUserId();

  try {
    const body = BodySchema.parse(await req.json());
    const engine = createRecoveryEngine();

    if (body.action === 'reconcile') {
      const reconciliation = await runRecoveryReconciliationCycle({
        userId,
        autoRecover: body.autoRecover !== false,
        limit: body.limit,
      });
      return NextResponse.json({
        ok: true,
        reconciliation,
        ranAt: new Date().toISOString(),
      });
    }

    if (body.action === 'export_evidence') {
      const detail = await engine.detail({ userId, recoveryCaseId: body.recoveryCaseId! });
      if (!detail) {
        return NextResponse.json(apiError('NOT_FOUND', 'Recovery case not found', true), {
          status: 404,
        });
      }
      return NextResponse.json({
        ok: true,
        export: toDetailExport(detail),
      });
    }

    const recoveryCase = await engine.store.getCaseById(userId, body.recoveryCaseId!);
    if (!recoveryCase) {
      return NextResponse.json(apiError('NOT_FOUND', 'Recovery case not found', true), {
        status: 404,
      });
    }

    if (body.action === 'force_reversal') {
      if (!isAdminOverrideAuthorized(req.headers)) {
        return NextResponse.json(apiError('POLICY_FAILURE', 'Admin override token is required', true), {
          status: 403,
        });
      }

      const reversalService = createReversalService({ recoveryStore: engine.store });
      const result = await reversalService.executeReversal({
        userId,
        recoveryCaseId: recoveryCase.id,
        idempotencyKey: body.idempotencyKey?.trim() || `force_reversal:${recoveryCase.id}`,
        reason: body.reason || 'Admin forced reversal from recovery status API.',
        actorType: 'admin',
        actorId: req.headers.get('x-agent-wallet-actor-id')?.trim() || 'admin_override',
        adminOverride: true,
      });

      return NextResponse.json({
        ok: true,
        result,
      });
    }

    const idempotencyKey = body.idempotencyKey?.trim() || `retry_recovery:${recoveryCase.id}`;
    if (
      recoveryCase.recommendedRecoveryAction === 'restore_wallet_balance'
      || recoveryCase.recommendedRecoveryAction === 'void_external_authorization'
    ) {
      const reversalService = createReversalService({ recoveryStore: engine.store });
      const result = await reversalService.executeReversal({
        userId,
        recoveryCaseId: recoveryCase.id,
        idempotencyKey,
        reason: body.reason || 'User-triggered recovery retry from status API.',
        actorType: 'user',
        actorId: req.headers.get('x-agent-wallet-actor-id')?.trim() || userId,
      });

      return NextResponse.json({
        ok: true,
        result,
      });
    }

    if (recoveryCase.recommendedRecoveryAction === 'request_refund') {
      const refundService = createRefundService({ recoveryStore: engine.store });
      const result = await refundService.requestRefund({
        userId,
        recoveryCaseId: recoveryCase.id,
        idempotencyKey,
        activationFailureReason: body.reason,
        actorType: 'user',
        actorId: req.headers.get('x-agent-wallet-actor-id')?.trim() || userId,
      });

      return NextResponse.json({
        ok: true,
        result,
      });
    }

    return NextResponse.json(apiError(
      'INVALID_STATE',
      `No self-serve retry is available for state ${recoveryCase.currentState}.`,
      true,
    ), {
      status: 409,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to process recovery status action';

    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'recovery.status.action_failed', {
      userId,
      errorCode,
      message,
    });

    const status = error instanceof z.ZodError
      ? 400
      : errorCode === 'NOT_FOUND'
        ? 404
        : errorCode === 'POLICY_FAILURE'
          ? 403
          : errorCode === 'INVALID_STATE'
            ? 409
            : 500;

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
