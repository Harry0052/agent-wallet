import { z } from 'zod';
import { classifyMerchantCompatibility } from '../merchantCompatibility.ts';
import {
  MerchantAdapter,
  MerchantAdapterConfigSchema,
  type MerchantAdapterLogger,
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

export const ApiSubscriptionAdapterConfigSchema = MerchantAdapterConfigSchema.extend({
  provider: z.literal('api_subscription_service').default('api_subscription_service'),
  apiBaseUrl: z.string().url(),
  merchantAliases: z.array(z.string().min(1)).default([]),
  activationTimeoutMs: z.number().int().positive().default(15 * 60 * 1000),
});

export type ApiSubscriptionAdapterConfig = z.infer<typeof ApiSubscriptionAdapterConfigSchema>;

export interface ApiSubscriptionClient {
  createCheckoutDraft(input: {
    merchant: string;
    planId?: string;
    amount: number;
    currency: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{
    draftId: string;
    redirectUrl?: string;
  }>;
  authorize(input: {
    merchant: string;
    amount: number;
    currency: string;
    idempotencyKey?: string;
    paymentId?: string;
  }): Promise<{
    authorizationId: string;
    status: 'authorized' | 'pending' | 'failed';
    message?: string;
  }>;
  provision(input: {
    merchant: string;
    planId?: string;
    authorizationId?: string;
    taskId?: string | null;
  }): Promise<{
    provisionId: string;
    status: 'provisioned' | 'pending' | 'failed';
    message?: string;
  }>;
  verify(input: {
    merchant: string;
    provisionId?: string;
    paymentId?: string;
    authorizedAt: string;
  }): Promise<{
    activationStatus: 'PENDING' | 'ACTIVE' | 'FAILED' | 'UNKNOWN';
    message?: string;
    observedAt?: string;
    referenceId?: string;
  }>;
  capture(input: {
    authorizationId?: string;
    paymentId?: string;
    idempotencyKey?: string;
    amount: number;
    currency: string;
  }): Promise<{
    captureId: string;
    status: 'captured' | 'pending' | 'failed';
    message?: string;
  }>;
  voidOrRefund(input: {
    authorizationId?: string;
    paymentId?: string;
    idempotencyKey?: string;
    amount: number;
    currency: string;
    reason: string;
  }): Promise<{
    referenceId: string;
    status: 'voided' | 'refunded' | 'pending' | 'failed';
    message?: string;
  }>;
}

export class ApiSubscriptionServiceAdapter extends MerchantAdapter<ApiSubscriptionAdapterConfig> {
  private readonly client: ApiSubscriptionClient;

  constructor(config: z.input<typeof ApiSubscriptionAdapterConfigSchema>, deps: {
    client: ApiSubscriptionClient;
    logger?: MerchantAdapterLogger;
  }) {
    super(ApiSubscriptionAdapterConfigSchema.parse(config), { logger: deps.logger });
    this.client = deps.client;
  }

  protected async doClassifyMerchant(input: ClassifyMerchantInput): Promise<ClassifyMerchantResult> {
    const decision = classifyMerchantCompatibility(input.request);
    const normalized = input.request.merchant.trim().toLowerCase();
    const aliasHit = this.config.merchantAliases
      .some((alias) => normalized.includes(alias.toLowerCase()) || alias.toLowerCase().includes(normalized));

    const supported = aliasHit
      && decision.compatibilityTier === 'API_NATIVE';

    return {
      supported,
      decision,
      reason: supported ? undefined : 'Merchant is not API_NATIVE for this adapter.',
    };
  }

  protected async doPrepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    const draft = await this.client.createCheckoutDraft({
      merchant: input.merchant,
      planId: input.planId,
      amount: input.amount,
      currency: input.currency,
      metadata: {
        ...(input.context.metadata || {}),
        taskId: input.context.taskId || null,
      },
    });

    return {
      status: 'ready',
      checkoutReference: draft.draftId,
      checkoutUrl: draft.redirectUrl,
      requiresUserInteraction: false,
      metadata: {
        draftId: draft.draftId,
      },
    };
  }

  protected async doAuthorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentResult> {
    const result = await this.client.authorize({
      merchant: input.merchant,
      amount: input.amount,
      currency: input.currency,
      idempotencyKey: input.context.idempotencyKey,
      paymentId: input.context.paymentId,
    });

    return {
      status: result.status,
      authorizationReference: result.authorizationId,
      message: result.message,
      metadata: {
        authorizationId: result.authorizationId,
      },
    };
  }

  protected async doAttemptProvision(input: AttemptProvisionInput): Promise<AttemptProvisionResult> {
    const result = await this.client.provision({
      merchant: input.merchant,
      planId: input.planId,
      authorizationId: typeof input.context.metadata?.authorizationId === 'string'
        ? input.context.metadata.authorizationId
        : undefined,
      taskId: input.context.taskId || null,
    });

    return {
      status: result.status,
      provisionReference: result.provisionId,
      message: result.message,
      metadata: {
        provisionId: result.provisionId,
      },
    };
  }

  protected async doVerifyActivation(input: VerifyActivationInput): Promise<VerifyActivationResult> {
    const result = await this.client.verify({
      merchant: input.merchant,
      provisionId: typeof input.context.metadata?.provisionId === 'string'
        ? input.context.metadata.provisionId
        : undefined,
      paymentId: input.context.paymentId,
      authorizedAt: input.context.authorizedAt,
    });

    const observedAt = result.observedAt || this.nowIso();
    const evidence = [{
      provider: 'api-subscription-adapter',
      method: 'merchant_api_check' as const,
      status: result.activationStatus,
      observedAt,
      summary: result.message || 'Activation verification received from merchant API.',
      referenceId: result.referenceId || null,
      raw: {
        paymentId: input.context.paymentId || null,
      },
    }];

    if (result.activationStatus === 'ACTIVE') {
      return {
        activationStatus: 'ACTIVE',
        evidence,
        verifiedAt: observedAt,
        settlementRecommendation: 'CAPTURE_SETTLEMENT',
        message: result.message,
      };
    }

    if (result.activationStatus === 'FAILED') {
      return {
        activationStatus: 'FAILED',
        evidence,
        verifiedAt: observedAt,
        settlementRecommendation: 'VOID_OR_REFUND',
        message: result.message,
      };
    }

    return {
      activationStatus: result.activationStatus,
      evidence,
      verifiedAt: null,
      settlementRecommendation: 'HOLD_SETTLEMENT',
      message: result.message,
    };
  }

  protected async doCapturePayment(input: CapturePaymentInput): Promise<CapturePaymentResult> {
    const result = await this.client.capture({
      authorizationId: typeof input.context.metadata?.authorizationId === 'string'
        ? input.context.metadata.authorizationId
        : undefined,
      paymentId: input.context.paymentId,
      idempotencyKey: input.context.idempotencyKey,
      amount: input.amount,
      currency: input.currency,
    });

    return {
      status: result.status,
      captureReference: result.captureId,
      message: result.message,
      metadata: {
        captureId: result.captureId,
      },
    };
  }

  protected async doVoidOrRefund(input: VoidOrRefundInput): Promise<VoidOrRefundResult> {
    const result = await this.client.voidOrRefund({
      authorizationId: typeof input.context.metadata?.authorizationId === 'string'
        ? input.context.metadata.authorizationId
        : undefined,
      paymentId: input.context.paymentId,
      idempotencyKey: input.context.idempotencyKey,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
    });

    return {
      status: result.status,
      referenceId: result.referenceId,
      message: result.message,
      metadata: {
        referenceId: result.referenceId,
      },
    };
  }

  protected async doGetSupportEvidence(input: SupportEvidenceInput): Promise<SupportEvidenceResult> {
    return {
      evidence: {
        merchant: input.merchant,
        adapterId: this.config.adapterId,
        transactionReferences: [
          typeof input.context.metadata?.authorizationId === 'string' ? input.context.metadata.authorizationId : '',
          typeof input.context.metadata?.captureId === 'string' ? input.context.metadata.captureId : '',
          typeof input.context.metadata?.referenceId === 'string' ? input.context.metadata.referenceId : '',
        ].filter(Boolean),
        timeline: [
          {
            timestamp: this.nowIso(),
            stage: 'getSupportEvidence',
            summary: 'Support evidence generated from API subscription adapter.',
            details: {
              endpoint: this.config.apiBaseUrl,
              paymentId: input.context.paymentId || null,
            },
          },
        ],
        notes: [
          'API-native subscription support evidence.',
          'Use transaction references for dispute/reconciliation workflows.',
        ],
        raw: {
          metadata: input.context.metadata || null,
        },
      },
    };
  }
}

export class NoopApiSubscriptionClient implements ApiSubscriptionClient {
  async createCheckoutDraft(_input: {
    merchant: string;
    planId?: string;
    amount: number;
    currency: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ draftId: string }> {
    return {
      draftId: `draft_${Math.random().toString(36).slice(2, 10)}`,
    };
  }

  async authorize(_input: {
    merchant: string;
    amount: number;
    currency: string;
    idempotencyKey?: string;
    paymentId?: string;
  }): Promise<{ authorizationId: string; status: 'authorized' }> {
    return {
      authorizationId: `auth_${Math.random().toString(36).slice(2, 10)}`,
      status: 'authorized',
    };
  }

  async provision(_input: {
    merchant: string;
    planId?: string;
    authorizationId?: string;
    taskId?: string | null;
  }): Promise<{ provisionId: string; status: 'provisioned' }> {
    return {
      provisionId: `prov_${Math.random().toString(36).slice(2, 10)}`,
      status: 'provisioned',
    };
  }

  async verify(_input: {
    merchant: string;
    provisionId?: string;
    paymentId?: string;
    authorizedAt: string;
  }): Promise<{ activationStatus: 'ACTIVE'; observedAt: string }> {
    return {
      activationStatus: 'ACTIVE',
      observedAt: new Date().toISOString(),
    };
  }

  async capture(_input: {
    authorizationId?: string;
    paymentId?: string;
    idempotencyKey?: string;
    amount: number;
    currency: string;
  }): Promise<{ captureId: string; status: 'captured' }> {
    return {
      captureId: `cap_${Math.random().toString(36).slice(2, 10)}`,
      status: 'captured',
    };
  }

  async voidOrRefund(_input: {
    authorizationId?: string;
    paymentId?: string;
    idempotencyKey?: string;
    amount: number;
    currency: string;
    reason: string;
  }): Promise<{ referenceId: string; status: 'refunded' }> {
    return {
      referenceId: `refund_${Math.random().toString(36).slice(2, 10)}`,
      status: 'refunded',
    };
  }
}
