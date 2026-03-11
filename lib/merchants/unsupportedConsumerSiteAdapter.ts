import { z } from 'zod';
import { classifyMerchantCompatibility } from '../merchantCompatibility.ts';
import {
  MerchantAdapter,
  MerchantAdapterConfigSchema,
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

export const UnsupportedConsumerSiteAdapterConfigSchema = MerchantAdapterConfigSchema.extend({
  provider: z.literal('unsupported_consumer_site').default('unsupported_consumer_site'),
  blockedReason: z.string().min(12).default('Unsupported consumer checkout flow with anti-automation defenses.'),
  merchantAliases: z.array(z.string().min(1)).default([]),
});

export type UnsupportedConsumerSiteAdapterConfig = z.infer<typeof UnsupportedConsumerSiteAdapterConfigSchema>;

export class UnsupportedConsumerSiteAdapter extends MerchantAdapter<UnsupportedConsumerSiteAdapterConfig> {
  constructor(config: z.input<typeof UnsupportedConsumerSiteAdapterConfigSchema>) {
    super(UnsupportedConsumerSiteAdapterConfigSchema.parse(config));
  }

  protected async doClassifyMerchant(input: ClassifyMerchantInput): Promise<ClassifyMerchantResult> {
    const decision = classifyMerchantCompatibility(input.request);
    return {
      supported: false,
      decision,
      reason: this.config.blockedReason,
    };
  }

  protected async doPrepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    return {
      status: 'blocked',
      blockedReason: `${this.config.blockedReason} (${input.merchant})`,
      requiresUserInteraction: true,
      metadata: {
        reason: 'unsupported_checkout_path',
      },
    };
  }

  protected async doAuthorizePayment(_input: AuthorizePaymentInput): Promise<AuthorizePaymentResult> {
    throw new MerchantAdapterUnsupportedError(
      'authorizePayment',
      this.config.blockedReason,
    );
  }

  protected async doAttemptProvision(_input: AttemptProvisionInput): Promise<AttemptProvisionResult> {
    throw new MerchantAdapterUnsupportedError(
      'attemptProvision',
      this.config.blockedReason,
    );
  }

  protected async doVerifyActivation(_input: VerifyActivationInput): Promise<VerifyActivationResult> {
    throw new MerchantAdapterUnsupportedError(
      'verifyActivation',
      this.config.blockedReason,
    );
  }

  protected async doCapturePayment(_input: CapturePaymentInput): Promise<CapturePaymentResult> {
    throw new MerchantAdapterUnsupportedError(
      'capturePayment',
      this.config.blockedReason,
    );
  }

  protected async doVoidOrRefund(input: VoidOrRefundInput): Promise<VoidOrRefundResult> {
    return {
      status: 'failed',
      message: `No direct refund path for unsupported merchant ${input.merchant}.`,
      metadata: {
        reason: 'unsupported_checkout_path',
      },
    };
  }

  protected async doGetSupportEvidence(input: SupportEvidenceInput): Promise<SupportEvidenceResult> {
    return {
      evidence: {
        merchant: input.merchant,
        adapterId: this.config.adapterId,
        transactionReferences: [],
        timeline: [
          {
            timestamp: this.nowIso(),
            stage: 'getSupportEvidence',
            summary: 'Unsupported merchant flow evidence generated.',
            details: {
              blockerCode: 'unsupported_checkout_path',
              reason: this.config.blockedReason,
            },
          },
        ],
        notes: [
          'Merchant flow is unsupported for autonomous processing.',
          'Escalate to human verification or alternate supported merchant path.',
        ],
      },
    };
  }
}
