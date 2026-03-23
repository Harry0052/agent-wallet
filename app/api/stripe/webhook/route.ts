import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  hasWebhookBeenProcessed,
  hasSuccessfulTopupForPaymentIntent,
  markWebhookProcessed,
  recordLedgerEntryUnique,
  recordTopupCredit,
} from '@/lib/server/ledger';
import { getStripeWebhookSecret, validateCriticalServerEnv } from '@/lib/server/env';
import { getStripeClient } from '@/lib/server/stripe';
import {
  markStripeDisconnectedFromExternalDetach,
  saveSetupSessionPaymentMethod,
} from '@/lib/server/fundingStripe';
import { markPaymentMethodRemovedByStripeIdWithUsers } from '@/lib/server/fundingPaymentMethods';
import { apiError, logServerEvent } from '@/lib/server/observability';
import { handleSubscriptionWebhookEvent } from '@/lib/server/billing';
import { recordReferralConversion } from '@/lib/server/referrals';

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
    logServerEvent('warn', 'stripe.webhook.resolve_funding_source_failed', {
      paymentIntentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return 'stripe';
}

export async function POST(req: NextRequest) {
  // ── Step 1: Validate server environment ───────────────────────
  // 500 → Stripe retries once env is fixed on Vercel.
  try {
    validateCriticalServerEnv();
  } catch (error) {
    logServerEvent('error', 'stripe.webhook.env_invalid', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      apiError('STRIPE_FAILURE', 'Server configuration error', true),
      { status: 500 },
    );
  }

  // ── Step 2: Verify Stripe signature ───────────────────────────
  // 400 → permanent client error, Stripe will not retry.
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    logServerEvent('error', 'stripe.webhook.signature_missing', {});
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Missing stripe-signature header', false),
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
    logServerEvent('error', 'stripe.webhook.signature_invalid', { error: msg });
    return NextResponse.json(
      apiError('VALIDATION_ERROR', `Webhook signature verification failed: ${msg}`, false),
      { status: 400 },
    );
  }

  // ── Step 3: Process verified event ────────────────────────────
  // 500 → server-side failure, Stripe will retry.
  try {
    logServerEvent('info', 'stripe.webhook.processing', {
      eventId: event.id,
      eventType: event.type,
    });

    const seen = await hasWebhookBeenProcessed(event.id);
    if (seen) {
      logServerEvent('info', 'stripe.webhook.duplicate', { eventId: event.id });
      return NextResponse.json({ received: true, duplicate: true });
    }

    const stripe = getStripeClient();

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const action = session.metadata?.wallet_action;
      if (action === 'save_payment_method' && session.mode === 'setup') {
        const savedMethod = await saveSetupSessionPaymentMethod({ session });

        logServerEvent('info', 'stripe.webhook.setup_method_saved', {
          userId: session.metadata?.wallet_user_id || null,
          sessionId: session.id,
          setupIntentId: typeof session.setup_intent === 'string' ? session.setup_intent : null,
          savedPaymentMethodId: savedMethod?.stripePaymentMethodId || null,
        });
      }

      if (action === 'topup' && session.mode === 'payment') {
        const userId = session.metadata?.wallet_user_id?.trim() || null;
        if (!userId) {
          logServerEvent('warn', 'stripe.webhook.topup_missing_user_id', {
            eventId: event.id,
            sessionId: session.id,
          });
          await markWebhookProcessed(event.id);
          return NextResponse.json({
            received: true,
            ignored: true,
            reason: 'missing_wallet_user_id',
          });
        }
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

          logServerEvent('info', 'stripe.webhook.topup_recorded', {
            userId,
            amount,
            source,
            eventId: event.id,
          });
        }
      }
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const action = paymentIntent.metadata?.wallet_action;
      if (action === 'topup') {
        const userId = paymentIntent.metadata?.wallet_user_id?.trim() || null;
        if (!userId) {
          logServerEvent('warn', 'stripe.webhook.payment_intent_topup_missing_user_id', {
            eventId: event.id,
            paymentIntentId: paymentIntent.id,
          });
          await markWebhookProcessed(event.id);
          return NextResponse.json({
            received: true,
            ignored: true,
            reason: 'missing_wallet_user_id',
          });
        }
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

            logServerEvent('info', 'stripe.webhook.payment_intent_topup_recorded', {
              userId,
              amount,
              source,
              eventId: event.id,
              paymentIntentId: paymentIntent.id,
            });
          }
        }
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const action = paymentIntent.metadata?.wallet_action;
      if (action === 'topup') {
        const userId = paymentIntent.metadata?.wallet_user_id?.trim() || null;
        if (!userId) {
          logServerEvent('warn', 'stripe.webhook.payment_intent_failed_missing_user_id', {
            eventId: event.id,
            paymentIntentId: paymentIntent.id,
          });
          await markWebhookProcessed(event.id);
          return NextResponse.json({
            received: true,
            ignored: true,
            reason: 'missing_wallet_user_id',
          });
        }
        const amount = (paymentIntent.amount || 0) / 100;
        if (amount > 0) {
          const source = await resolveFundingSource(stripe, paymentIntent.id);
          const errorCode = paymentIntent.last_payment_error?.code || 'unknown';
          const errorMessage = paymentIntent.last_payment_error?.message || 'Payment failed';

          await recordLedgerEntryUnique({
            userId,
            type: 'topup',
            amount,
            currency: paymentIntent.currency || 'usd',
            direction: 'credit',
            stripeObjectId: `pi_failed:${paymentIntent.id}`,
            stripeEventId: event.id,
            description: 'Top-up failed',
            status: 'failed',
            source,
            metadata: {
              payment_intent_id: paymentIntent.id,
              error_code: errorCode,
              error_message: errorMessage.slice(0, 220),
            },
          });

          logServerEvent('info', 'stripe.webhook.payment_intent_topup_failed_recorded', {
            userId,
            amount,
            source,
            eventId: event.id,
            paymentIntentId: paymentIntent.id,
            errorCode,
          });
        }
      }
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const action = charge.metadata?.wallet_action;
      if (action === 'topup' && charge.amount_refunded) {
        const userId = charge.metadata?.wallet_user_id?.trim() || null;
        if (!userId) {
          logServerEvent('warn', 'stripe.webhook.charge_refunded_missing_user_id', {
            eventId: event.id,
            chargeId: charge.id,
          });
          await markWebhookProcessed(event.id);
          return NextResponse.json({
            received: true,
            ignored: true,
            reason: 'missing_wallet_user_id',
          });
        }
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

        logServerEvent('info', 'stripe.webhook.refund_recorded', {
          userId,
          amount,
          eventId: event.id,
          chargeId: charge.id,
        });
      }
    }

    // ── Subscription billing events ────────────────────────────────
    const subscriptionEventTypes = [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'customer.subscription.trial_will_end',
      'invoice.paid',
      'invoice.payment_failed',
    ];
    if (subscriptionEventTypes.includes(event.type)) {
      try {
        await handleSubscriptionWebhookEvent(event);
        logServerEvent('info', 'stripe.webhook.subscription_event_processed', {
          eventId: event.id,
          eventType: event.type,
        });

        // Record referral conversion on first successful subscription payment
        if (event.type === 'invoice.paid') {
          const invoice = event.data.object as Stripe.Invoice;
          const rawSub = (invoice as unknown as Record<string, unknown>).subscription;
          const subscriptionId = typeof rawSub === 'string' ? rawSub : (rawSub as { id: string } | null)?.id;
          if (subscriptionId) {
            try {
              const sub = await stripe.subscriptions.retrieve(subscriptionId);
              const plan = sub.metadata?.plan;
              const userId = sub.metadata?.app_user_id;
              if (userId && plan && (plan === 'starter' || plan === 'pro' || plan === 'autonomous')) {
                await recordReferralConversion({
                  referredUserId: userId,
                  plan: plan as 'starter' | 'pro' | 'autonomous',
                  stripeEventId: event.id,
                });
              }
            } catch (refError) {
              logServerEvent('warn', 'stripe.webhook.referral_conversion_failed', {
                eventId: event.id,
                error: refError instanceof Error ? refError.message : String(refError),
              });
            }
          }
        }
      } catch (subError) {
        logServerEvent('error', 'stripe.webhook.subscription_event_failed', {
          eventId: event.id,
          eventType: event.type,
          error: subError instanceof Error ? subError.message : String(subError),
        });
      }
    }

    if (event.type === 'payment_method.detached') {
      const paymentMethod = event.data.object as Stripe.PaymentMethod;
      const affectedUsers = await markPaymentMethodRemovedByStripeIdWithUsers(paymentMethod.id);
      for (const userId of affectedUsers) {
        await markStripeDisconnectedFromExternalDetach({
          userId,
          reason: 'Stripe payment method detached',
        });
      }

      logServerEvent('info', 'stripe.webhook.payment_method_detached', {
        paymentMethodId: paymentMethod.id,
        affectedUsers: affectedUsers.length,
      });
    }

    await markWebhookProcessed(event.id);
    logServerEvent('info', 'stripe.webhook.completed', { eventId: event.id, eventType: event.type });
    return NextResponse.json({ received: true });
  } catch (error) {
    logServerEvent('error', 'stripe.webhook.failed', {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      apiError('STRIPE_FAILURE', 'Webhook processing failed', true),
      { status: 500 },
    );
  }
}
