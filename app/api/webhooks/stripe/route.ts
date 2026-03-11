import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { z } from 'zod';
import { hasWebhookBeenProcessed, markWebhookProcessed } from '@/lib/server/ledger';
import { getStripeWebhookSecret } from '@/lib/server/env';
import { getStripeClient } from '@/lib/server/stripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { createPostgresTwoPhaseStore } from '@/lib/payments/ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function paymentIntentIdFromEvent(event: Stripe.Event): string | null {
  if (
    event.type === 'payment_intent.amount_capturable_updated'
    || event.type === 'payment_intent.succeeded'
    || event.type === 'payment_intent.payment_failed'
    || event.type === 'payment_intent.canceled'
  ) {
    const pi = event.data.object as Stripe.PaymentIntent;
    return pi.id;
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    return typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  }

  return null;
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Missing stripe-signature header', false),
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    const payload = await req.text();
    event = getStripeClient().webhooks.constructEvent(
      payload,
      signature,
      getStripeWebhookSecret(),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logServerEvent('error', 'payments.webhook.signature_invalid', { message });
    return NextResponse.json(
      apiError('VALIDATION_ERROR', `Webhook signature verification failed: ${message}`, false),
      { status: 400 },
    );
  }

  const store = createPostgresTwoPhaseStore();

  try {
    const seen = await hasWebhookBeenProcessed(event.id);
    if (seen) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const paymentIntentId = paymentIntentIdFromEvent(event);
    if (!paymentIntentId) {
      await markWebhookProcessed(event.id);
      return NextResponse.json({ received: true, ignored: true });
    }

    const flow = await store.findByStripePaymentIntentId(paymentIntentId);
    if (!flow) {
      await markWebhookProcessed(event.id);
      return NextResponse.json({ received: true, ignored: true, reason: 'payment_flow_not_found' });
    }

    if (event.type === 'payment_intent.amount_capturable_updated') {
      await store.appendEvent({
        paymentFlowId: flow.id,
        userId: flow.userId,
        eventType: 'authorized',
        amount: flow.amount,
        currency: flow.currency,
        idempotencyKey: event.id,
        details: {
          source: 'stripe_webhook',
          paymentIntentId,
          eventType: event.type,
        },
      });

      if (flow.status === 'authorization_pending') {
        await store.updateFlow(flow.userId, flow.id, {
          status: 'activation_pending',
          authorizedAt: new Date().toISOString(),
        });
      }
    } else if (event.type === 'payment_intent.succeeded') {
      await store.appendEvent({
        paymentFlowId: flow.id,
        userId: flow.userId,
        eventType: 'captured',
        amount: flow.amount,
        currency: flow.currency,
        idempotencyKey: event.id,
        details: {
          source: 'stripe_webhook',
          paymentIntentId,
          eventType: event.type,
        },
      });
      if (flow.status !== 'captured') {
        await store.updateFlow(flow.userId, flow.id, {
          status: 'captured',
          capturedAt: new Date().toISOString(),
        });
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const lastErrorCode = pi.last_payment_error?.code || null;
      const lastErrorMessage = pi.last_payment_error?.message || null;

      await store.appendEvent({
        paymentFlowId: flow.id,
        userId: flow.userId,
        eventType: 'activation_failed',
        amount: flow.amount,
        currency: flow.currency,
        idempotencyKey: event.id,
        reason: lastErrorMessage || 'Stripe payment failed',
        details: {
          source: 'stripe_webhook',
          paymentIntentId,
          eventType: event.type,
          lastErrorCode,
        },
      });

      await store.updateFlow(flow.userId, flow.id, {
        status: 'failed',
      });
    } else if (event.type === 'payment_intent.canceled' || event.type === 'charge.refunded') {
      await store.appendEvent({
        paymentFlowId: flow.id,
        userId: flow.userId,
        eventType: 'refunded',
        amount: flow.amount,
        currency: flow.currency,
        idempotencyKey: event.id,
        details: {
          source: 'stripe_webhook',
          paymentIntentId,
          eventType: event.type,
        },
      });

      if (flow.status !== 'refunded') {
        await store.updateFlow(flow.userId, flow.id, {
          status: 'refunded',
          refundedAt: new Date().toISOString(),
        });
      }
    }

    await markWebhookProcessed(event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to process stripe webhook';
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'payments.webhook.failed', {
      eventId: event.id,
      eventType: event.type,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
