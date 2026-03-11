import { z } from 'zod';
import { classifyMerchantCompatibility } from '../merchantCompatibility.ts';
import {
  MerchantAdapter,
  MerchantAdapterConfigSchema,
  type MerchantAdapterLogger,
  MerchantAdapterUnsupportedError,
  type AuthorizePaymentInput,
  type AuthorizePaymentResult,
  type CapturePaymentInput,
  type CapturePaymentResult,
  type ClassifyMerchantInput,
  type ClassifyMerchantResult,
  type PrepareCheckoutInput,
  type PrepareCheckoutResult,
  type SupportEvidenceInput,
  type SupportEvidenceResult,
  type AttemptProvisionInput,
  type AttemptProvisionResult,
  type VerifyActivationInput,
  type VerifyActivationResult,
  type VoidOrRefundInput,
  type VoidOrRefundResult,
} from './baseAdapter.ts';

export const StripeCheckoutAdapterConfigSchema = MerchantAdapterConfigSchema.extend({
  provider: z.literal('stripe_checkout_saas').default('stripe_checkout_saas'),
  defaultSuccessUrl: z.string().url(),
  defaultCancelUrl: z.string().url(),
  supportedMerchants: z.array(z.string().min(1)).default([]),
  planPriceLookup: z.record(z.string().min(1)).default({}),
  activationMode: z.enum(['webhook', 'polling']).default('webhook'),
});

export type StripeCheckoutAdapterConfig = z.infer<typeof StripeCheckoutAdapterConfigSchema>;

export interface StripeCheckoutGateway {
  createCheckoutSession(input: {
    merchant: string;
    planId?: string;
    amount: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{
    id: string;
    url: string;
  }>;
  authorizePayment(input: {
    merchant: string;
    amount: number;
    currency: string;
    paymentId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{
    id: string;
    status: 'authorized' | 'pending' | 'failed';
    message?: string;
  }>;
  capturePayment(input: {
    authorizationReference?: string;
    paymentId?: string;
    idempotencyKey?: string;
    amount: number;
    currency: string;
  }): Promise<{
    id: string;
    status: 'captured' | 'pending' | 'failed';
    message?: string;
  }>;
  voidOrRefund(input: {
    authorizationReference?: string;
    paymentId?: string;
    idempotencyKey?: string;
    amount: number;
    currency: string;
    reason: string;
  }): Promise<{
    id: string;
    status: 'voided' | 'refunded' | 'pending' | 'failed';
    message?: string;
  }>;
}

export class StripeCheckoutSaasAdapter extends MerchantAdapter<StripeCheckoutAdapterConfig> {
  private readonly gateway: StripeCheckoutGateway;

  constructor(config: z.input<typeof StripeCheckoutAdapterConfigSchema>, deps: {
    gateway: StripeCheckoutGateway;
    logger?: MerchantAdapterLogger;
  }) {
    super(StripeCheckoutAdapterConfigSchema.parse(config), { logger: deps.logger });
    this.gateway = deps.gateway;
  }

  protected async doClassifyMerchant(input: ClassifyMerchantInput): Promise<ClassifyMerchantResult> {
    const decision = classifyMerchantCompatibility(input.request);
    const merchant = input.request.merchant.trim().toLowerCase();
    const aliasHit = this.config.supportedMerchants
      .some((entry) => merchant.includes(entry.toLowerCase()) || entry.toLowerCase().includes(merchant));

    const supported = aliasHit
      && (decision.compatibilityTier === 'CHECKOUT_NATIVE' || decision.compatibilityTier === 'API_NATIVE');

    return {
      supported,
      decision,
      reason: supported ? undefined : 'Merchant is not in Stripe Checkout adapter support matrix.',
    };
  }

  protected async doPrepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    const session = await this.gateway.createCheckoutSession({
      merchant: input.merchant,
      planId: input.planId,
      amount: input.amount,
      currency: input.currency,
      successUrl: this.config.defaultSuccessUrl,
      cancelUrl: this.config.defaultCancelUrl,
      metadata: {
        ...(input.context.metadata || {}),
        wallet_adapter: this.config.adapterId,
        wallet_task_id: input.context.taskId || null,
      },
    });

    return {
      status: 'ready',
      checkoutUrl: session.url,
      checkoutReference: session.id,
      requiresUserInteraction: false,
      metadata: {
        checkoutSessionId: session.id,
        planId: input.planId || null,
      },
    };
  }

  protected async doAuthorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentResult> {
    const result = await this.gateway.authorizePayment({
      merchant: input.merchant,
      amount: input.amount,
      currency: input.currency,
      paymentId: input.context.paymentId,
      idempotencyKey: input.context.idempotencyKey,
      metadata: input.context.metadata || null,
    });

    return {
      status: result.status,
      authorizationReference: result.id,
      message: result.message,
      metadata: {
        provider: 'stripe_checkout',
      },
    };
  }

  protected async doAttemptProvision(input: AttemptProvisionInput): Promise<AttemptProvisionResult> {
    if (this.config.activationMode === 'webhook') {
      return {
        status: 'pending',
        message: 'Provisioning pending webhook confirmation from merchant service.',
        metadata: {
          planId: input.planId || null,
          mode: 'webhook',
        },
      };
    }

    return {
      status: 'pending',
      message: 'Provisioning queued; polling activation signal.',
      metadata: {
        planId: input.planId || null,
        mode: 'polling',
      },
    };
  }

  protected async doVerifyActivation(input: VerifyActivationInput): Promise<VerifyActivationResult> {
    const activation = typeof input.context.metadata?.activation_status === 'string'
      ? String(input.context.metadata?.activation_status).toUpperCase()
      : null;

    if (activation === 'ACTIVE') {
      return {
        activationStatus: 'ACTIVE',
        verifiedAt: this.nowIso(),
        settlementRecommendation: 'CAPTURE_SETTLEMENT',
        message: 'Activation confirmed from Stripe/merchant webhook signal.',
        evidence: [{
          provider: 'stripe-checkout-adapter',
          method: 'webhook_confirmation',
          status: 'ACTIVE',
          observedAt: this.nowIso(),
          summary: 'Received active entitlement signal for checkout session.',
          raw: {
            paymentId: input.context.paymentId,
          },
        }],
      };
    }

    return {
      activationStatus: 'PENDING',
      verifiedAt: null,
      settlementRecommendation: 'HOLD_SETTLEMENT',
      message: 'Activation not yet confirmed by webhook signal.',
      evidence: [{
        provider: 'stripe-checkout-adapter',
        method: 'webhook_confirmation',
        status: 'PENDING',
        observedAt: this.nowIso(),
        summary: 'Waiting for entitlement activation signal.',
        raw: {
          paymentId: input.context.paymentId,
        },
      }],
    };
  }

  protected async doCapturePayment(input: CapturePaymentInput): Promise<CapturePaymentResult> {
    const result = await this.gateway.capturePayment({
      authorizationReference: typeof input.context.metadata?.authorizationReference === 'string'
        ? input.context.metadata.authorizationReference
        : undefined,
      paymentId: input.context.paymentId,
      idempotencyKey: input.context.idempotencyKey,
      amount: input.amount,
      currency: input.currency,
    });

    return {
      status: result.status,
      captureReference: result.id,
      message: result.message,
      metadata: {
        provider: 'stripe_checkout',
      },
    };
  }

  protected async doVoidOrRefund(input: VoidOrRefundInput): Promise<VoidOrRefundResult> {
    const result = await this.gateway.voidOrRefund({
      authorizationReference: typeof input.context.metadata?.authorizationReference === 'string'
        ? input.context.metadata.authorizationReference
        : undefined,
      paymentId: input.context.paymentId,
      idempotencyKey: input.context.idempotencyKey,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
    });

    return {
      status: result.status,
      referenceId: result.id,
      message: result.message,
      metadata: {
        provider: 'stripe_checkout',
      },
    };
  }

  protected async doGetSupportEvidence(input: SupportEvidenceInput): Promise<SupportEvidenceResult> {
    return {
      evidence: {
        merchant: input.merchant,
        adapterId: this.config.adapterId,
        transactionReferences: [
          typeof input.context.metadata?.authorizationReference === 'string' ? input.context.metadata.authorizationReference : '',
          typeof input.context.metadata?.captureReference === 'string' ? input.context.metadata.captureReference : '',
          typeof input.context.metadata?.refundReference === 'string' ? input.context.metadata.refundReference : '',
        ].filter(Boolean),
        timeline: [
          {
            timestamp: this.nowIso(),
            stage: 'getSupportEvidence',
            summary: 'Support evidence generated by Stripe Checkout adapter.',
            details: {
              paymentId: input.context.paymentId || null,
              taskId: input.context.taskId || null,
            },
          },
        ],
        notes: [
          'Stripe Checkout adapter evidence package.',
          'Includes references captured during authorize/capture/refund stages.',
        ],
        raw: {
          metadata: input.context.metadata || null,
        },
      },
    };
  }
}

export class NoopStripeCheckoutGateway implements StripeCheckoutGateway {
  async createCheckoutSession(input: {
    merchant: string;
    planId?: string;
    amount: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string }> {
    const id = `cs_${Math.random().toString(36).slice(2, 10)}`;
    return {
      id,
      url: `${input.successUrl}?session_id=${id}&merchant=${encodeURIComponent(input.merchant)}`,
    };
  }

  async authorizePayment(_input: {
    merchant: string;
    amount: number;
    currency: string;
    paymentId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ id: string; status: 'authorized'; message: string }> {
    return {
      id: `auth_${Math.random().toString(36).slice(2, 10)}`,
      status: 'authorized',
      message: 'Authorized in noop Stripe gateway.',
    };
  }

  async capturePayment(_input: {
    authorizationReference?: string;
    paymentId?: string;
    idempotencyKey?: string;
    amount: number;
    currency: string;
  }): Promise<{ id: string; status: 'captured'; message: string }> {
    return {
      id: `cap_${Math.random().toString(36).slice(2, 10)}`,
      status: 'captured',
      message: 'Captured in noop Stripe gateway.',
    };
  }

  async voidOrRefund(_input: {
    authorizationReference?: string;
    paymentId?: string;
    idempotencyKey?: string;
    amount: number;
    currency: string;
    reason: string;
  }): Promise<{ id: string; status: 'refunded'; message: string }> {
    return {
      id: `rf_${Math.random().toString(36).slice(2, 10)}`,
      status: 'refunded',
      message: 'Refunded in noop Stripe gateway.',
    };
  }
}

export function assertStripeCheckoutSupported(supported: boolean, merchant: string): void {
  if (!supported) {
    throw new MerchantAdapterUnsupportedError(
      'classifyMerchant',
      `Stripe checkout adapter does not support merchant ${merchant}`,
    );
  }
}
