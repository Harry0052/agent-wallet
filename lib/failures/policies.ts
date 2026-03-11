import { z } from 'zod';
import {
  FailureSeverity,
  WalletFailureCode,
  WalletFailureCodeSchema,
} from './codes.ts';

export enum RetryStrategy {
  NONE = 'none',
  IMMEDIATE = 'immediate',
  EXPONENTIAL_BACKOFF = 'exponential_backoff',
  MANUAL_ONLY = 'manual_only',
}

export enum RefundAction {
  NONE = 'none',
  HOLD_AND_VERIFY = 'hold_and_verify',
  AUTO_REFUND = 'auto_refund',
  PREPARE_DISPUTE_PACKET = 'prepare_dispute_packet',
}

export enum LoggingLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export const RetryPolicySchema = z.object({
  strategy: z.nativeEnum(RetryStrategy),
  maxAttempts: z.number().int().min(0),
  baseDelayMs: z.number().int().min(0),
  requiresHumanApprovalAfterExhaustion: z.boolean(),
});

export const RefundPolicySchema = z.object({
  action: z.nativeEnum(RefundAction),
  allowAutomaticRefund: z.boolean(),
  requireActivationProofBeforeRefund: z.boolean(),
  requireDisputePacket: z.boolean(),
});

export const LoggingPolicySchema = z.object({
  level: z.nativeEnum(LoggingLevel),
  alertOps: z.boolean(),
  includeRawError: z.boolean(),
  redactPii: z.boolean(),
});

export const FailurePolicySchema = z.object({
  code: WalletFailureCodeSchema,
  severity: z.nativeEnum(FailureSeverity),
  title: z.string().min(1),
  userMessage: z.string().min(1),
  nextActionLabel: z.string().min(1),
  retry: RetryPolicySchema,
  refund: RefundPolicySchema,
  logging: LoggingPolicySchema,
});

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
export type RefundPolicy = z.infer<typeof RefundPolicySchema>;
export type LoggingPolicy = z.infer<typeof LoggingPolicySchema>;
export type FailurePolicy = z.infer<typeof FailurePolicySchema>;

const POLICY_TABLE: Record<WalletFailureCode, FailurePolicy> = {
  [WalletFailureCode.SIGNUP_BLOCKED]: {
    code: WalletFailureCode.SIGNUP_BLOCKED,
    severity: FailureSeverity.HIGH,
    title: 'Signup Blocked',
    userMessage: 'The merchant blocked automated signup. No payment will be captured until this is resolved.',
    nextActionLabel: 'Use manual signup verification',
    retry: {
      strategy: RetryStrategy.MANUAL_ONLY,
      maxAttempts: 0,
      baseDelayMs: 0,
      requiresHumanApprovalAfterExhaustion: true,
    },
    refund: {
      action: RefundAction.NONE,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: false,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.WARN,
      alertOps: false,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.MERCHANT_REQUIRES_HUMAN_VERIFICATION]: {
    code: WalletFailureCode.MERCHANT_REQUIRES_HUMAN_VERIFICATION,
    severity: FailureSeverity.HIGH,
    title: 'Human Verification Required',
    userMessage: 'The merchant requires a human verification step before service can continue.',
    nextActionLabel: 'Complete merchant verification manually',
    retry: {
      strategy: RetryStrategy.MANUAL_ONLY,
      maxAttempts: 0,
      baseDelayMs: 0,
      requiresHumanApprovalAfterExhaustion: true,
    },
    refund: {
      action: RefundAction.HOLD_AND_VERIFY,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: true,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.WARN,
      alertOps: false,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.CAPTCHA_OR_BOT_CHALLENGE]: {
    code: WalletFailureCode.CAPTCHA_OR_BOT_CHALLENGE,
    severity: FailureSeverity.HIGH,
    title: 'Bot Challenge Detected',
    userMessage: 'The merchant presented a CAPTCHA or bot challenge. Automated checkout is paused.',
    nextActionLabel: 'Require user-assisted completion',
    retry: {
      strategy: RetryStrategy.MANUAL_ONLY,
      maxAttempts: 0,
      baseDelayMs: 0,
      requiresHumanApprovalAfterExhaustion: true,
    },
    refund: {
      action: RefundAction.NONE,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: false,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.WARN,
      alertOps: false,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.PLAN_SELECTION_FAILED]: {
    code: WalletFailureCode.PLAN_SELECTION_FAILED,
    severity: FailureSeverity.MEDIUM,
    title: 'Plan Selection Failed',
    userMessage: 'The requested plan could not be selected. Payment was not finalized.',
    nextActionLabel: 'Retry with explicit plan details',
    retry: {
      strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
      maxAttempts: 2,
      baseDelayMs: 1000,
      requiresHumanApprovalAfterExhaustion: false,
    },
    refund: {
      action: RefundAction.NONE,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: false,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.INFO,
      alertOps: false,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.PAYMENT_AUTHORIZATION_FAILED]: {
    code: WalletFailureCode.PAYMENT_AUTHORIZATION_FAILED,
    severity: FailureSeverity.HIGH,
    title: 'Payment Authorization Failed',
    userMessage: 'Payment authorization failed, so funds were not captured.',
    nextActionLabel: 'Use another payment method or re-authorize',
    retry: {
      strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
      maxAttempts: 1,
      baseDelayMs: 2000,
      requiresHumanApprovalAfterExhaustion: false,
    },
    refund: {
      action: RefundAction.NONE,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: false,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.ERROR,
      alertOps: false,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.PAYMENT_CAPTURED_ACTIVATION_FAILED]: {
    code: WalletFailureCode.PAYMENT_CAPTURED_ACTIVATION_FAILED,
    severity: FailureSeverity.CRITICAL,
    title: 'Captured But Not Activated',
    userMessage: 'Payment was captured, but the merchant did not activate the service.',
    nextActionLabel: 'Start automatic refund flow',
    retry: {
      strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
      maxAttempts: 2,
      baseDelayMs: 3000,
      requiresHumanApprovalAfterExhaustion: true,
    },
    refund: {
      action: RefundAction.AUTO_REFUND,
      allowAutomaticRefund: true,
      requireActivationProofBeforeRefund: true,
      requireDisputePacket: true,
    },
    logging: {
      level: LoggingLevel.CRITICAL,
      alertOps: true,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.ACTIVATION_UNVERIFIED]: {
    code: WalletFailureCode.ACTIVATION_UNVERIFIED,
    severity: FailureSeverity.HIGH,
    title: 'Activation Unverified',
    userMessage: 'Activation could not be verified yet. Task will not be marked complete.',
    nextActionLabel: 'Continue verification and hold settlement',
    retry: {
      strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
      maxAttempts: 3,
      baseDelayMs: 2000,
      requiresHumanApprovalAfterExhaustion: true,
    },
    refund: {
      action: RefundAction.HOLD_AND_VERIFY,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: true,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.WARN,
      alertOps: false,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.MERCHANT_SITE_ERROR]: {
    code: WalletFailureCode.MERCHANT_SITE_ERROR,
    severity: FailureSeverity.MEDIUM,
    title: 'Merchant Site Error',
    userMessage: 'The merchant site returned an error. The wallet paused to avoid unsafe behavior.',
    nextActionLabel: 'Retry when merchant service recovers',
    retry: {
      strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
      maxAttempts: 3,
      baseDelayMs: 1500,
      requiresHumanApprovalAfterExhaustion: false,
    },
    refund: {
      action: RefundAction.HOLD_AND_VERIFY,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: false,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.ERROR,
      alertOps: false,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.DUPLICATE_ACCOUNT_DETECTED]: {
    code: WalletFailureCode.DUPLICATE_ACCOUNT_DETECTED,
    severity: FailureSeverity.MEDIUM,
    title: 'Duplicate Account Detected',
    userMessage: 'A duplicate account was detected for this merchant.',
    nextActionLabel: 'Link existing account and retry safely',
    retry: {
      strategy: RetryStrategy.MANUAL_ONLY,
      maxAttempts: 0,
      baseDelayMs: 0,
      requiresHumanApprovalAfterExhaustion: true,
    },
    refund: {
      action: RefundAction.HOLD_AND_VERIFY,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: true,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.WARN,
      alertOps: false,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.UNSUPPORTED_CHECKOUT_PATH]: {
    code: WalletFailureCode.UNSUPPORTED_CHECKOUT_PATH,
    severity: FailureSeverity.HIGH,
    title: 'Unsupported Checkout Path',
    userMessage: 'The merchant checkout path is not safely automatable.',
    nextActionLabel: 'Escalate to human checkout',
    retry: {
      strategy: RetryStrategy.MANUAL_ONLY,
      maxAttempts: 0,
      baseDelayMs: 0,
      requiresHumanApprovalAfterExhaustion: true,
    },
    refund: {
      action: RefundAction.NONE,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: false,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.WARN,
      alertOps: false,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.POLICY_BLOCKED]: {
    code: WalletFailureCode.POLICY_BLOCKED,
    severity: FailureSeverity.HIGH,
    title: 'Policy Blocked',
    userMessage: 'This action is blocked by wallet policy and no funds were moved.',
    nextActionLabel: 'Review policy exception requirements',
    retry: {
      strategy: RetryStrategy.NONE,
      maxAttempts: 0,
      baseDelayMs: 0,
      requiresHumanApprovalAfterExhaustion: true,
    },
    refund: {
      action: RefundAction.NONE,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: false,
      requireDisputePacket: false,
    },
    logging: {
      level: LoggingLevel.WARN,
      alertOps: true,
      includeRawError: true,
      redactPii: true,
    },
  },
  [WalletFailureCode.HIGH_REFUND_RISK]: {
    code: WalletFailureCode.HIGH_REFUND_RISK,
    severity: FailureSeverity.CRITICAL,
    title: 'High Refund Risk',
    userMessage: 'This merchant flow has high refund risk, so autonomous capture is blocked.',
    nextActionLabel: 'Require human approval before payment',
    retry: {
      strategy: RetryStrategy.MANUAL_ONLY,
      maxAttempts: 0,
      baseDelayMs: 0,
      requiresHumanApprovalAfterExhaustion: true,
    },
    refund: {
      action: RefundAction.HOLD_AND_VERIFY,
      allowAutomaticRefund: false,
      requireActivationProofBeforeRefund: true,
      requireDisputePacket: true,
    },
    logging: {
      level: LoggingLevel.CRITICAL,
      alertOps: true,
      includeRawError: true,
      redactPii: true,
    },
  },
};

export const FAILURE_POLICY_TABLE: Record<WalletFailureCode, FailurePolicy> = POLICY_TABLE;

export function getFailurePolicy(code: WalletFailureCode): FailurePolicy {
  return FAILURE_POLICY_TABLE[code];
}

export function getUiCopyForFailure(code: WalletFailureCode): Pick<FailurePolicy, 'title' | 'userMessage' | 'nextActionLabel'> {
  const policy = getFailurePolicy(code);
  return {
    title: policy.title,
    userMessage: policy.userMessage,
    nextActionLabel: policy.nextActionLabel,
  };
}

export function assertAllPoliciesValid(): void {
  const codes = Object.values(WalletFailureCode) as WalletFailureCode[];
  for (const code of codes) {
    FailurePolicySchema.parse(FAILURE_POLICY_TABLE[code]);
  }
}
