import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { createRefundService } from '@/lib/refunds/refundService';
import { isAdminOverrideAuthorized } from '@/lib/recovery/policies';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  recoveryCaseId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  activationFailureReason: z.string().trim().optional(),
  activationEvidence: z.record(z.string(), z.unknown()).optional(),
  allowWithoutActivationFailure: z.boolean().default(true),
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
    const refundService = createRefundService();
    const result = await refundService.requestRefund({
      userId,
      recoveryCaseId: body.recoveryCaseId,
      idempotencyKey: body.idempotencyKey,
      activationFailureReason: body.activationFailureReason,
      activationEvidence: body.activationEvidence,
      allowWithoutActivationFailure: body.allowWithoutActivationFailure,
      actorType: adminOverride ? 'admin' : 'user',
      actorId,
      adminOverride,
    });

    logServerEvent('info', 'recovery.refund.completed', {
      userId,
      recoveryCaseId: body.recoveryCaseId,
      refundCaseId: result.refundCase.id,
      refundStatus: result.refundCase.status,
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
        : 'Failed to request refund';

    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'recovery.refund.failed', {
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
