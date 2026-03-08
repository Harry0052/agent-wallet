import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  hasWebhookBeenProcessed,
  hasSuccessfulTopupForPaymentIntent,
  getWalletUserId,
  markWebhookProcessed,
  recordLedgerEntryUnique,
  recordTopupCredit,
} from '@/lib/server/ledger';
import { getStripeWebhookSecret, validateCriticalServerEnv } from '@/lib/server/env';
import { getStripeClient } from '@/lib/server/stripe';

export const runtime = 'nodejs';

function methodNotAllowed() {
  return NextResponse.json(
    { error: 'Method Not Allowed. Stripe webhooks must use POST.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}

async function resolveFundingSource(stripe: Stripe, paymentIntentId: string | null): Promise<'stripe' | 'apple-pay' | 'cashapp'> {
  if (!paymentIntentId) return 'stripe';

  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge'],
  });

  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const details = charge?.payment_method_details;

  if (details?.type === 'cashapp') return 'cashapp';
  if (details?.card?.wallet?.type === 'apple_pay') return 'apple-pay';
  return 'stripe';
}

export async function GET() {
  return methodNotAllowed();
}

export async function POST(req: NextRequest) {
  try {
    validateCriticalServerEnv();

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
    }

    const payload = await req.text();
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(payload, signature, getStripeWebhookSecret());

    const seen = await hasWebhookBeenProcessed(event.id);
    if (seen) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const action = session.metadata?.wallet_action;
      if (action === 'topup' && session.mode === 'payment') {
        const userId = session.metadata?.wallet_user_id || getWalletUserId();
        const amount = (session.amount_total || 0) / 100;
        if (amount > 0) {
          const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
          if (paymentIntentId) {
            const alreadyCredited = await hasSuccessfulTopupForPaymentIntent(userId, paymentIntentId);
            if (alreadyCredited) {
              await markWebhookProcessed(event.id);
              return NextResponse.json({ received: true, duplicatePaymentIntent: true });
            }
          }

          const source = await resolveFundingSource(stripe, paymentIntentId);

          await recordTopupCredit({
            userId,
            amount,
            currency: session.currency || 'usd',
            stripeObjectId: session.id,
            source,
            description: source === 'cashapp'
              ? 'Cash App Pay top-up'
              : source === 'apple-pay'
                ? 'Apple Pay top-up'
                : 'Stripe card top-up',
            metadata: paymentIntentId ? { payment_intent_id: paymentIntentId } : undefined,
          });
        }
      }
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const action = paymentIntent.metadata?.wallet_action;
      if (action === 'topup') {
        const userId = paymentIntent.metadata?.wallet_user_id || getWalletUserId();
        const amount = (paymentIntent.amount_received || paymentIntent.amount || 0) / 100;
        if (amount > 0) {
          const alreadyCredited = await hasSuccessfulTopupForPaymentIntent(userId, paymentIntent.id);
          if (!alreadyCredited) {
            const source = await resolveFundingSource(stripe, paymentIntent.id);
            await recordTopupCredit({
              userId,
              amount,
              currency: paymentIntent.currency || 'usd',
              stripeObjectId: `pi:${paymentIntent.id}`,
              source,
              description: source === 'cashapp'
                ? 'Cash App Pay top-up'
                : source === 'apple-pay'
                  ? 'Apple Pay top-up'
                  : 'Stripe card top-up',
              metadata: { payment_intent_id: paymentIntent.id },
            });
          }
        }
      }
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const action = charge.metadata?.wallet_action;
      if (action === 'topup' && charge.amount_refunded) {
        const userId = charge.metadata?.wallet_user_id || getWalletUserId();
        const amount = charge.amount_refunded / 100;

        await recordLedgerEntryUnique({
          userId,
          type: 'reversal',
          amount,
          currency: charge.currency,
          direction: 'debit',
          stripeObjectId: `refund:${charge.id}:${charge.amount_refunded}`,
          description: 'Top-up reversal/refund',
          status: 'succeeded',
          source: 'stripe',
        });
      }
    }

    await markWebhookProcessed(event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[stripe-webhook] failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Stripe webhook failed' },
      { status: 400 },
    );
  }
}
