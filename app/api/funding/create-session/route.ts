import { NextRequest, NextResponse } from 'next/server';
import { getWalletUserId } from '@/lib/server/ledger';
import { createTopupCheckoutSession } from '@/lib/server/fundingStripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'funding' });
  if (rateLimited) return rateLimited;

  try {
    const body = (await req.json()) as { amount?: number };
    const amount = Number(body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(apiError('VALIDATION_ERROR', 'Invalid top-up amount', true), { status: 400 });
    }

    const cents = Math.round(amount * 100);
    if (cents < 50) {
      return NextResponse.json(apiError('VALIDATION_ERROR', 'Minimum top-up is $0.50', true), { status: 400 });
    }

    const userId = await getWalletUserId();
    logServerEvent('info', 'funding.session.started', { userId, amount });

    const session = await createTopupCheckoutSession({
      userId,
      amount,
      origin: req.nextUrl.origin,
    });

    logServerEvent('info', 'funding.session.created', {
      userId,
      sessionId: session.sessionId,
    });

    return NextResponse.json({
      checkoutUrl: session.checkoutUrl,
      sessionId: session.sessionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Stripe session';
    const classified = classifyTaskError({ message });
    const errorCode = classified === 'UNKNOWN_FAILURE' ? 'STRIPE_FAILURE' : classified;
    logServerEvent('error', 'funding.session.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
