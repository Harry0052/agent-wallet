import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { listSavedFundingMethods, removeSavedFundingMethod } from '@/lib/server/fundingStripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const DeleteBodySchema = z.object({
  paymentMethodId: z.string().trim().min(1),
});

export async function GET() {
  try {
    const userId = await getWalletUserId();
    const methods = await listSavedFundingMethods(userId);
    return NextResponse.json({ ok: true, methods });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list payment methods';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'funding.payment_methods.list_failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = DeleteBodySchema.parse(await req.json());
    const userId = await getWalletUserId();

    await removeSavedFundingMethod({
      userId,
      stripePaymentMethodId: body.paymentMethodId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to remove payment method';
    const status = error instanceof z.ZodError
      ? 400
      : message.toLowerCase().includes('not found')
        ? 404
        : 500;
    const errorCode = classifyTaskError({ message, validation: error instanceof z.ZodError });

    logServerEvent('error', 'funding.payment_methods.remove_failed', { errorCode, message, status });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
