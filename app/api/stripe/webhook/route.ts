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
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function resolveFundingSource(
  stripe: Stripe,
  paymentIntentId: string | null,
): Promise<'stripe' | 'apple-pay' | 'cashapp'> {
  if (!paymentIntentId) return 'stripe';

  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });

    const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    const details = charge?.payment_method_details;

    if (details?.type === 'cashapp') return 'cashapp';
    if (details?.card?.wallet?.type === 'apple_pay') return 'apple-pay';
  } catch (err) {
    console.warn('[stripe-webhook] resolveFundingSource failed, defaulting to stripe:', err);
  }

  return 'stripe';
}

export async function POST(req: NextRequest) {
  // ── Step 1: Validate server environment ───────────────────────
  // 500 → Stripe retries once env is fixed on Vercel.
  try {
    validateCriticalServerEnv();
  } catch (error) {
    console.error('[stripe-webhook] Server env misconfiguration:', error);
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 },
    );
  }

  // ── Step 2: Verify Stripe signature ───────────────────────────
  // 400 → permanent client error, Stripe will not retry.
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    console.error('[stripe-webhook] Missing stripe-signature header');
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    const payload = await req.text();
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      getStripeWebhookSecret(),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[stripe-webhook] Signature verification failed:', msg);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${msg}` },
      { status: 400 },
    );
  }

  // ── Step 3: Process verified event ────────────────────────────
  // 500 → server-side failure, Stripe will retry.
  try {
    console.log(`[stripe-webhook] Processing event=${event.id} type=${event.type}`);

    const seen = await hasWebhookBeenProcessed(event.id);
    if (seen) {
      console.log(`[stripe-webhook] Duplicate event ${event.id}, skipping`);
      return NextResponse.json({ received: true, duplicate: true });
    }

    const stripe = getStripeClient();

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const action = session.metadata?.wallet_action;
      if (action === 'topup' && session.mode === 'payment') {
        const userId = session.metadata?.wallet_user_id || getWalletUserId();
        const amount = (session.amount_total || 0) / 100;
        if (amount > 0) {
          const paymentIntentId =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : null;

          if (paymentIntentId) {
            const alreadyCredited = await hasSuccessfulTopupForPaymentIntent(
              userId,
              paymentIntentId,
            );
            if (alreadyCredited) {
              await markWebhookProcessed(event.id);
              return NextResponse.json({
                received: true,
                duplicatePaymentIntent: true,
              });
            }
          }

          const source = await resolveFundingSource(stripe, paymentIntentId);

          await recordTopupCredit({
            userId,
            amount,
            currency: session.currency || 'usd',
            stripeObjectId: session.id,
            source,
            stripeEventId: event.id,
            description:
              source === 'cashapp'
                ? 'Cash App Pay top-up'
                : source === 'apple-pay'
                  ? 'Apple Pay top-up'
                  : 'Stripe card top-up',
            metadata: paymentIntentId
              ? { payment_intent_id: paymentIntentId }
              : undefined,
          });

          console.log(
            `[stripe-webhook] Recorded topup credit: userId=${userId} amount=${amount} source=${source} event=${event.id}`,
          );
        }
      }
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const action = paymentIntent.metadata?.wallet_action;
      if (action === 'topup') {
        const userId =
          paymentIntent.metadata?.wallet_user_id || getWalletUserId();
        const amount =
          (paymentIntent.amount_received || paymentIntent.amount || 0) / 100;
        if (amount > 0) {
          const alreadyCredited = await hasSuccessfulTopupForPaymentIntent(
            userId,
            paymentIntent.id,
          );
          if (!alreadyCredited) {
            const source = await resolveFundingSource(
              stripe,
              paymentIntent.id,
            );

            await recordTopupCredit({
              userId,
              amount,
              currency: paymentIntent.currency || 'usd',
              stripeObjectId: `pi:${paymentIntent.id}`,
              source,
              stripeEventId: event.id,
              description:
                source === 'cashapp'
                  ? 'Cash App Pay top-up'
                  : source === 'apple-pay'
                    ? 'Apple Pay top-up'
                    : 'Stripe card top-up',
              metadata: { payment_intent_id: paymentIntent.id },
            });

            console.log(
              `[stripe-webhook] Recorded PI topup credit: userId=${userId} amount=${amount} source=${source} event=${event.id}`,
            );
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
          stripeEventId: event.id,
          description: 'Top-up reversal/refund',
          status: 'succeeded',
          source: 'stripe',
        });

        console.log(
          `[stripe-webhook] Recorded refund: userId=${userId} amount=${amount} event=${event.id}`,
        );
      }
    }

    await markWebhookProcessed(event.id);
    console.log(`[stripe-webhook] Done: event=${event.id}`);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(
      `[stripe-webhook] Processing failed for event ${event.id}:`,
      error,
    );
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 },
    );
  }
}
