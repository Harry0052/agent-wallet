import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { chargeSavedPaymentMethodTopup, createTopupCheckoutSession, paymentMethodDisplayLabel } from '@/lib/server/fundingStripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

const BodySchema = z.object({
  amount: z.number().positive(),
  paymentMethodId: z.string().trim().min(1).optional(),
  approved: z.boolean().default(false),
  forgetAfterUse: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'funding' });
  if (rateLimited) return rateLimited;

  try {
    const body = BodySchema.parse(await req.json());
    const userId = await getWalletUserId();

    if (Math.round(body.amount * 100) < 50) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Minimum top-up is $0.50', true),
        { status: 400 },
      );
    }

    if (!body.approved) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Approval is required before running a top-up.', true),
        { status: 400 },
      );
    }

    if (body.paymentMethodId) {
      const charged = await chargeSavedPaymentMethodTopup({
        userId,
        amount: body.amount,
        stripePaymentMethodId: body.paymentMethodId,
        forgetAfterUse: body.forgetAfterUse,
      });

      if (charged.status === 'succeeded') {
        return NextResponse.json({
          ok: true,
          status: 'succeeded',
          amount: charged.amount,
          paymentIntentId: charged.paymentIntentId,
          paymentMethod: charged.paymentMethod,
          paymentMethodLabel: paymentMethodDisplayLabel(charged.paymentMethod),
          detachedAfterUse: charged.detachedAfterUse,
          message: charged.detachedAfterUse
            ? `Top-up approved from ${paymentMethodDisplayLabel(charged.paymentMethod)}. The payment method was removed after use.`
            : `Top-up approved from ${paymentMethodDisplayLabel(charged.paymentMethod)}.`,
        });
      }

      return NextResponse.json({
        ok: true,
        status: 'requires_action',
        amount: charged.amount,
        paymentIntentId: charged.paymentIntentId,
        paymentMethod: charged.paymentMethod,
        paymentMethodLabel: paymentMethodDisplayLabel(charged.paymentMethod),
        checkoutUrl: charged.checkoutUrl,
        sessionId: charged.sessionId,
        message: charged.message,
      });
    }

    const fallback = await createTopupCheckoutSession({
      userId,
      amount: body.amount,
      origin: req.nextUrl.origin,
    });

    return NextResponse.json({
      ok: true,
      status: 'pending_checkout',
      amount: body.amount,
      checkoutUrl: fallback.checkoutUrl,
      sessionId: fallback.sessionId,
      message: 'No saved payment method available. Continue in Stripe to complete this top-up.',
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to start top-up';
    const isMissingSavedMethod = message.toLowerCase().includes('no saved payment method');
    const status = error instanceof z.ZodError
      ? 400
      : isMissingSavedMethod
        ? 404
        : 500;
    const classified = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    const errorCode = classified === 'UNKNOWN_FAILURE' ? 'STRIPE_FAILURE' : classified;

    logServerEvent('error', 'funding.topup.failed', {
      errorCode,
      message,
      status,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
