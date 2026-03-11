import type {
  ActivationProbeResult,
  ActivationVerificationContext,
  ActivationVerificationProvider,
} from './base.ts';

export type MerchantApiActivationState = 'ACTIVE' | 'PENDING' | 'FAILED' | 'UNKNOWN';

export interface MerchantApiCheckResult {
  status: MerchantApiActivationState;
  observedAt?: string;
  referenceId?: string;
  summary?: string;
  confidence?: number;
  raw?: Record<string, unknown>;
}

export function createApiCheckProvider(params: {
  check: (context: ActivationVerificationContext) => Promise<MerchantApiCheckResult>;
  providerId?: string;
  priority?: number;
}): ActivationVerificationProvider {
  return {
    id: params.providerId || 'merchant-api-check',
    method: 'merchant_api_check',
    priority: params.priority ?? 30,
    supports() {
      return true;
    },
    async verify(context): Promise<ActivationProbeResult> {
      const result = await params.check(context);
      const observedAt = result.observedAt || context.now || new Date().toISOString();
      const status = result.status;

      const summary = result.summary || (
        status === 'ACTIVE'
          ? 'Merchant API reports service is active.'
          : status === 'FAILED'
            ? 'Merchant API reports activation failed.'
            : status === 'PENDING'
              ? 'Merchant API reports activation still pending.'
              : 'Merchant API returned unknown activation state.'
      );

      return {
        status,
        evidence: {
          provider: params.providerId || 'merchant-api-check',
          method: 'merchant_api_check',
          status,
          observedAt,
          summary,
          referenceId: result.referenceId || null,
          confidence: result.confidence ?? 0.85,
          raw: result.raw || null,
        },
      };
    },
  };
}
