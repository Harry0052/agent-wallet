import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { createRecoveryEngine } from '@/lib/recovery/recoveryEngine';
import { runRecoveryReconciliationCycle } from '@/lib/reconciliation/reconcileFailedPurchases';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  recoveryCaseId: z.string().trim().min(1).optional(),
  transactionId: z.string().trim().min(1).optional(),
  runReconciliation: z.boolean().default(true),
  autoRecover: z.boolean().default(false),
  limit: z.number().int().positive().max(500).optional(),
}).superRefine((value, ctx) => {
  if (!value.recoveryCaseId && !value.transactionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'recoveryCaseId or transactionId is required',
      path: ['recoveryCaseId'],
    });
  }
});

export async function POST(req: NextRequest) {
  const userId = getWalletUserId();

  try {
    const body = BodySchema.parse(await req.json());

    if (body.runReconciliation) {
      await runRecoveryReconciliationCycle({
        userId,
        limit: body.limit,
        autoRecover: body.autoRecover,
      });
    }

    const engine = createRecoveryEngine();
    const decision = await engine.evaluate({
      userId,
      recoveryCaseId: body.recoveryCaseId,
      transactionId: body.transactionId,
    });

    if (!decision) {
      return NextResponse.json(apiError('NOT_FOUND', 'Recovery case not found', true), {
        status: 404,
      });
    }

    return NextResponse.json({
      ok: true,
      decision,
      evaluatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to evaluate recovery decision';

    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'recovery.evaluate.failed', {
      userId,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}
