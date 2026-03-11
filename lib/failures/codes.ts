import { z } from 'zod';

export enum WalletFailureCode {
  SIGNUP_BLOCKED = 'signup_blocked',
  MERCHANT_REQUIRES_HUMAN_VERIFICATION = 'merchant_requires_human_verification',
  CAPTCHA_OR_BOT_CHALLENGE = 'captcha_or_bot_challenge',
  PLAN_SELECTION_FAILED = 'plan_selection_failed',
  PAYMENT_AUTHORIZATION_FAILED = 'payment_authorization_failed',
  PAYMENT_CAPTURED_ACTIVATION_FAILED = 'payment_captured_activation_failed',
  ACTIVATION_UNVERIFIED = 'activation_unverified',
  MERCHANT_SITE_ERROR = 'merchant_site_error',
  DUPLICATE_ACCOUNT_DETECTED = 'duplicate_account_detected',
  UNSUPPORTED_CHECKOUT_PATH = 'unsupported_checkout_path',
  POLICY_BLOCKED = 'policy_blocked',
  HIGH_REFUND_RISK = 'high_refund_risk',
}

export enum FailureSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum FailureSource {
  ORCHESTRATION = 'orchestration',
  MERCHANT = 'merchant',
  PAYMENT_PROCESSOR = 'payment_processor',
  POLICY_ENGINE = 'policy_engine',
  USER_INPUT = 'user_input',
  UNKNOWN = 'unknown',
}

export const WalletFailureCodeSchema = z.nativeEnum(WalletFailureCode);
export const FailureSeveritySchema = z.nativeEnum(FailureSeverity);
export const FailureSourceSchema = z.nativeEnum(FailureSource);

export const FailureContextSchema = z.object({
  merchant: z.string().trim().optional(),
  paymentFlowId: z.string().trim().optional(),
  taskId: z.string().trim().optional(),
  httpStatus: z.number().int().optional(),
  stage: z.string().trim().optional(),
  paymentStatus: z.string().trim().optional(),
  activationStatus: z.string().trim().optional(),
  rawMessage: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const FailureRecordSchema = z.object({
  code: WalletFailureCodeSchema,
  severity: FailureSeveritySchema,
  source: FailureSourceSchema,
  message: z.string().min(1),
  userMessage: z.string().min(1),
  recoverable: z.boolean(),
  occurredAt: z.string().datetime({ offset: true }),
  context: FailureContextSchema.optional(),
});

export type FailureContext = z.infer<typeof FailureContextSchema>;
export type FailureRecord = z.infer<typeof FailureRecordSchema>;

export function assertFailureRecord(input: unknown): FailureRecord {
  return FailureRecordSchema.parse(input);
}
