import type {
  ActivationProbeResult,
  ActivationVerificationContext,
  ActivationVerificationProvider,
} from './base.ts';

export interface StripeReceiptSignal {
  eventType: string;
  eventId?: string;
  observedAt?: string;
  paymentIntentId?: string;
  metadata?: Record<string, unknown>;
}

const ACTIVE_EVENTS = new Set([
  'checkout.session.completed',
  'invoice.payment_succeeded',
  'payment_intent.succeeded',
]);

const FAILED_EVENTS = new Set([
  'invoice.payment_failed',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
]);

const PENDING_EVENTS = new Set([
  'checkout.session.async_payment_succeeded',
  'payment_intent.amount_capturable_updated',
]);

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

export function createStripeReceiptProvider(params: {
  getSignals: (context: ActivationVerificationContext) => Promise<StripeReceiptSignal[]>;
  priority?: number;
}): ActivationVerificationProvider {
  return {
    id: 'stripe-receipt',
    method: 'webhook_confirmation',
    priority: params.priority ?? 10,
    supports() {
      return true;
    },
    async verify(context): Promise<ActivationProbeResult> {
      const signals = await params.getSignals(context);
      const latest = signals[0];
      const observedAt = latest?.observedAt || context.now || new Date().toISOString();

      if (!signals.length) {
        return {
          status: 'UNKNOWN',
          evidence: {
            provider: 'stripe-receipt',
            method: 'webhook_confirmation',
            status: 'UNKNOWN',
            observedAt,
            summary: 'No Stripe webhook confirmation found for this payment.',
            raw: { signalCount: 0 },
          },
        };
      }

      for (const signal of signals) {
        const eventType = normalize(signal.eventType);
        if (FAILED_EVENTS.has(eventType)) {
          return {
            status: 'FAILED',
            evidence: {
              provider: 'stripe-receipt',
              method: 'webhook_confirmation',
              status: 'FAILED',
              observedAt: signal.observedAt || observedAt,
              summary: `Stripe reported failure/refund event: ${signal.eventType}`,
              referenceId: signal.eventId || signal.paymentIntentId || null,
              confidence: 0.95,
              raw: {
                eventType: signal.eventType,
                paymentIntentId: signal.paymentIntentId || null,
                metadata: signal.metadata || null,
              },
            },
          };
        }
      }

      for (const signal of signals) {
        const eventType = normalize(signal.eventType);
        if (ACTIVE_EVENTS.has(eventType)) {
          return {
            status: 'ACTIVE',
            evidence: {
              provider: 'stripe-receipt',
              method: 'webhook_confirmation',
              status: 'ACTIVE',
              observedAt: signal.observedAt || observedAt,
              summary: `Stripe confirmation received: ${signal.eventType}`,
              referenceId: signal.eventId || signal.paymentIntentId || null,
              confidence: 0.92,
              raw: {
                eventType: signal.eventType,
                paymentIntentId: signal.paymentIntentId || null,
                metadata: signal.metadata || null,
              },
            },
          };
        }
      }

      for (const signal of signals) {
        const eventType = normalize(signal.eventType);
        if (PENDING_EVENTS.has(eventType)) {
          return {
            status: 'PENDING',
            evidence: {
              provider: 'stripe-receipt',
              method: 'webhook_confirmation',
              status: 'PENDING',
              observedAt: signal.observedAt || observedAt,
              summary: `Stripe indicates payment lifecycle is still pending: ${signal.eventType}`,
              referenceId: signal.eventId || signal.paymentIntentId || null,
              confidence: 0.75,
              raw: {
                eventType: signal.eventType,
                paymentIntentId: signal.paymentIntentId || null,
                metadata: signal.metadata || null,
              },
            },
          };
        }
      }

      return {
        status: 'UNKNOWN',
        evidence: {
          provider: 'stripe-receipt',
          method: 'webhook_confirmation',
          status: 'UNKNOWN',
          observedAt,
          summary: 'Stripe events were present but none mapped to activation outcomes.',
          raw: {
            signalCount: signals.length,
            eventTypes: signals.map((signal) => signal.eventType),
          },
        },
      };
    },
  };
}
