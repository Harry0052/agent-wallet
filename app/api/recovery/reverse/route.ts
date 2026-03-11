import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { createReversalService } from '@/lib/refunds/reversalService';
import { isAdminOverrideAuthorized } from '@/lib/recovery/policies';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  recoveryCaseId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  reason: z.string().trim().optional(),
  adminOverride: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const userId = await getWalletUserId();

  try {
    const body = BodySchema.parse(await req.json());
    const adminOverride = body.adminOverride === true;

    if (adminOverride && !isAdminOverrideAuthorized(req.headers)) {
      return NextResponse.json(apiError('POLICY_FAILURE', 'Admin override token is required', true), {
        status: 403,
      });
    }

    const actorId = req.headers.get('x-agent-wallet-actor-id')?.trim() || userId;
    const reversalService = createReversalService();
    const result = await reversalService.executeReversal({
      userId,
      recoveryCaseId: body.recoveryCaseId,
      idempotencyKey: body.idempotencyKey,
      reason: body.reason,
      actorType: adminOverride ? 'admin' : 'user',
      actorId,
      adminOverride,
    });

    logServerEvent('info', 'recovery.reverse.completed', {
      userId,
      recoveryCaseId: body.recoveryCaseId,
      executionType: result.executionType,
      idempotentReplay: result.idempotentReplay,
      ledgerEntryId: result.ledgerEntryId,
      paymentFlowId: result.paymentFlowId,
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to execute reversal';

    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'recovery.reverse.failed', {
      userId,
      errorCode,
      message,
    });

    const status = error instanceof z.ZodError
      ? 400
      : errorCode === 'POLICY_FAILURE'
        ? 409
        : errorCode === 'NOT_FOUND'
          ? 404
          : 500;

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
