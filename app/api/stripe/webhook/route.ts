import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  hasWebhookBeenProcessed,
  getWalletUserId,
  markWebhookProcessed,
  recordLedgerEntryUnique,
  recordTopupCredit,
} from '@/lib/server/ledger';
import { getStripeClient } from '@/lib/server/stripe';

export const runtime = 'nodejs';

function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  return secret;
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

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
    }

    const payload = await req.text();
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(payload, signature, getWebhookSecret());

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Stripe webhook failed' },
      { status: 400 },
    );
  }
}
