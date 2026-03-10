import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { saveSetupIntentPaymentMethod } from '@/lib/server/fundingStripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const BodySchema = z.object({
  setupIntentId: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());
    const userId = getWalletUserId();

    const method = await saveSetupIntentPaymentMethod({
      userId,
      setupIntentId: body.setupIntentId,
    });

    return NextResponse.json({
      ok: true,
      method,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to confirm setup intent';
    const status = error instanceof z.ZodError ? 400 : 500;
    const classified = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    const errorCode = classified === 'UNKNOWN_FAILURE' ? 'STRIPE_FAILURE' : classified;

    logServerEvent('error', 'funding.setup_intent_confirm.failed', { errorCode, message, status });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
