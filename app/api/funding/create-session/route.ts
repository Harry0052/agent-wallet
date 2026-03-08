import { NextRequest, NextResponse } from 'next/server';
import { getWalletUserId } from '@/lib/server/ledger';
import { getEnabledCheckoutMethods, getStripeClient } from '@/lib/server/stripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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

    const userId = getWalletUserId();
    logServerEvent('info', 'funding.session.started', { userId, amount });

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: getEnabledCheckoutMethods(),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: cents,
            product_data: {
              name: 'Agent Wallet top-up',
            },
          },
        },
      ],
      payment_intent_data: {
        metadata: {
          wallet_action: 'topup',
          wallet_user_id: userId,
        },
      },
      success_url: `${req.nextUrl.origin}/?funding_status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.nextUrl.origin}/?funding_cancelled=1`,
      metadata: {
        wallet_action: 'topup',
        wallet_user_id: userId,
      },
    });

    if (!session.url) {
      logServerEvent('error', 'funding.session.missing_url', {
        userId,
        sessionId: session.id,
      });
      return NextResponse.json(apiError('STRIPE_FAILURE', 'Unable to create Stripe checkout URL', true), { status: 500 });
    }

    logServerEvent('info', 'funding.session.created', {
      userId,
      sessionId: session.id,
    });

    return NextResponse.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Stripe session';
    const classified = classifyTaskError({ message });
    const errorCode = classified === 'UNKNOWN_FAILURE' ? 'STRIPE_FAILURE' : classified;
    logServerEvent('error', 'funding.session.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
