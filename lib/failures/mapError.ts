import { z } from 'zod';
import {
  FailureRecordSchema,
  FailureSeverity,
  FailureSource,
  WalletFailureCode,
} from './codes.ts';
import { getFailurePolicy } from './policies.ts';

export const MapFailureInputSchema = z.object({
  message: z.string().trim().optional(),
  source: z.nativeEnum(FailureSource).optional(),
  merchant: z.string().trim().optional(),
  httpStatus: z.number().int().optional(),
  stage: z.string().trim().optional(),
  paymentStatus: z.string().trim().optional(),
  activationStatus: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MappedFailureSchema = FailureRecordSchema.extend({
  confidence: z.number().min(0).max(1),
  detectionReason: z.string().min(1),
});

export type MapFailureInput = z.infer<typeof MapFailureInputSchema>;
export type MappedFailure = z.infer<typeof MappedFailureSchema>;

function normalize(input: string | undefined): string {
  return (input || '').toLowerCase();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function detectCode(input: MapFailureInput): {
  code: WalletFailureCode;
  confidence: number;
  reason: string;
} {
  const msg = normalize(input.message);
  const stage = normalize(input.stage);
  const paymentStatus = normalize(input.paymentStatus);
  const activationStatus = normalize(input.activationStatus);
  const httpStatus = input.httpStatus || 0;
  const metadataRisk = typeof input.metadata?.refund_risk === 'string'
    ? normalize(String(input.metadata.refund_risk))
    : '';

  if (includesAny(msg, ['policy blocked', 'blocked by policy', 'guardrail', 'policy_failure'])) {
    return { code: WalletFailureCode.POLICY_BLOCKED, confidence: 0.98, reason: 'Policy keywords detected' };
  }

  if (includesAny(msg, ['high refund risk', 'refund risk too high']) || metadataRisk === 'high' || metadataRisk === 'critical') {
    return { code: WalletFailureCode.HIGH_REFUND_RISK, confidence: 0.96, reason: 'Explicit refund-risk signal detected' };
  }

  if (
    (paymentStatus === 'captured' || includesAny(msg, ['payment captured', 'charge succeeded']))
    && (activationStatus === 'failed' || includesAny(msg, ['activation failed', 'not activated', 'service not provisioned']))
  ) {
    return {
      code: WalletFailureCode.PAYMENT_CAPTURED_ACTIVATION_FAILED,
      confidence: 0.97,
      reason: 'Captured payment combined with activation failure evidence',
    };
  }

  if (
    (paymentStatus === 'captured' || includesAny(msg, ['payment captured', 'charge succeeded']))
    && (activationStatus === 'pending' || activationStatus === 'unknown' || includesAny(msg, ['activation unverified', 'activation pending', 'not yet verified']))
  ) {
    return {
      code: WalletFailureCode.ACTIVATION_UNVERIFIED,
      confidence: 0.93,
      reason: 'Captured payment with unresolved activation status',
    };
  }

  if (includesAny(msg, ['captcha', 'bot challenge', 'cloudflare challenge'])) {
    return {
      code: WalletFailureCode.CAPTCHA_OR_BOT_CHALLENGE,
      confidence: 0.95,
      reason: 'Bot/CAPTCHA challenge detected',
    };
  }

  if (includesAny(msg, ['duplicate account', 'already have an account', 'account exists'])) {
    return {
      code: WalletFailureCode.DUPLICATE_ACCOUNT_DETECTED,
      confidence: 0.92,
      reason: 'Duplicate account indicator detected',
    };
  }

  if (includesAny(msg, ['unsupported checkout', 'checkout path unsupported', 'cannot automate checkout'])) {
    return {
      code: WalletFailureCode.UNSUPPORTED_CHECKOUT_PATH,
      confidence: 0.94,
      reason: 'Unsupported checkout path indicator detected',
    };
  }

  if (includesAny(msg, ['plan selection failed', 'plan not found', 'could not select plan']) || stage === 'plan_selection') {
    return {
      code: WalletFailureCode.PLAN_SELECTION_FAILED,
      confidence: 0.88,
      reason: 'Plan selection failure indicator detected',
    };
  }

  if (
    includesAny(msg, ['authorization failed', 'payment method declined', 'insufficient funds', 'payment declined'])
    || (stage === 'payment' && includesAny(msg, ['declined', 'authorization']))
  ) {
    return {
      code: WalletFailureCode.PAYMENT_AUTHORIZATION_FAILED,
      confidence: 0.93,
      reason: 'Authorization decline indicator detected',
    };
  }

  if (
    httpStatus >= 500
    || includesAny(msg, ['internal server error', 'service unavailable', 'merchant site error', 'bad gateway', 'gateway timeout'])
  ) {
    return {
      code: WalletFailureCode.MERCHANT_SITE_ERROR,
      confidence: 0.86,
      reason: 'Merchant site/server error indicator detected',
    };
  }

  if (includesAny(msg, ['human verification required', 'manual verification required', 'verify identity'])) {
    return {
      code: WalletFailureCode.MERCHANT_REQUIRES_HUMAN_VERIFICATION,
      confidence: 0.9,
      reason: 'Human verification requirement detected',
    };
  }

  if (
    includesAny(msg, ['signup blocked', 'unable to sign up', 'registration blocked'])
    || (stage === 'signup' && includesAny(msg, ['blocked', 'failed']))
  ) {
    return {
      code: WalletFailureCode.SIGNUP_BLOCKED,
      confidence: 0.84,
      reason: 'Signup blockage detected',
    };
  }

  return {
    code: WalletFailureCode.MERCHANT_SITE_ERROR,
    confidence: 0.55,
    reason: 'Fallback classification for unknown merchant failure',
  };
}

export function mapErrorToFailure(input: MapFailureInput): MappedFailure {
  const parsed = MapFailureInputSchema.parse(input);
  const detected = detectCode(parsed);
  const policy = getFailurePolicy(detected.code);
  const message = parsed.message?.trim() || policy.title;

  return MappedFailureSchema.parse({
    code: detected.code,
    severity: policy.severity,
    source: parsed.source || FailureSource.UNKNOWN,
    message,
    userMessage: policy.userMessage,
    recoverable: policy.retry.strategy !== 'none' && policy.retry.maxAttempts > 0,
    occurredAt: new Date().toISOString(),
    context: {
      merchant: parsed.merchant,
      httpStatus: parsed.httpStatus,
      stage: parsed.stage,
      paymentStatus: parsed.paymentStatus,
      activationStatus: parsed.activationStatus,
      rawMessage: parsed.message,
      metadata: parsed.metadata,
    },
    confidence: detected.confidence,
    detectionReason: detected.reason,
  });
}

export function mapFailureCodeToSeverity(code: WalletFailureCode): FailureSeverity {
  return getFailurePolicy(code).severity;
}
