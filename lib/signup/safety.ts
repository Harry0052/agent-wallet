import { classifyMerchantCompatibility } from '../merchantCompatibility.ts';
import type { MerchantCompatibilityDecision } from '../schemas/merchant.ts';
import { evaluatePreChargeRisk, type PreChargeGateResult } from '../risk/preChargeGate.ts';
import type {
  ActivationVerificationMethod,
  AntiBotRisk,
  KnownRefundReliability,
  AccountStatus,
} from '../risk/scoring.ts';
import { WalletFailureCode } from '../failures/codes.ts';
import { getFailurePolicy } from '../failures/policies.ts';

export type SignupBlockStage = 'compatibility' | 'pre_charge_risk';

export interface SignupFlowBlocker {
  code: WalletFailureCode;
  stage: SignupBlockStage;
  message: string;
  userMessage: string;
  blockedReasons: string[];
  recoverable: boolean;
  details: Record<string, unknown>;
}

export interface SignupSafetyInput {
  merchant: string;
  countryCode?: string;
  currency?: string;
  antiBotRisk: AntiBotRisk;
  knownRefundReliability: KnownRefundReliability;
  accountStatus: AccountStatus;
  accountCreationRequired: boolean;
  serviceProvisioningConfidence: number;
  activationVerificationMethods: ActivationVerificationMethod[];
  reserveOnlySupported?: boolean;
}

export interface SignupSafetyEvaluation {
  compatibility: MerchantCompatibilityDecision;
  risk: PreChargeGateResult;
  allowed: boolean;
  blocker: SignupFlowBlocker | null;
}

function buildBlocker(input: {
  code: WalletFailureCode;
  stage: SignupBlockStage;
  message: string;
  blockedReasons: string[];
  details: Record<string, unknown>;
}): SignupFlowBlocker {
  const policy = getFailurePolicy(input.code);
  return {
    code: input.code,
    stage: input.stage,
    message: input.message,
    userMessage: policy.userMessage,
    blockedReasons: input.blockedReasons,
    recoverable: policy.retry.maxAttempts > 0 && policy.retry.strategy !== 'none',
    details: input.details,
  };
}

function compatibilityBlocker(decision: MerchantCompatibilityDecision): SignupFlowBlocker | null {
  if (decision.compatibilityTier === 'AUTOMATION_UNSAFE') {
    return buildBlocker({
      code: WalletFailureCode.POLICY_BLOCKED,
      stage: 'compatibility',
      message: 'Merchant is classified as automation unsafe.',
      blockedReasons: decision.blockedReasons,
      details: {
        decisionId: decision.decisionId,
        compatibilityTier: decision.compatibilityTier,
        recommendedPath: decision.recommendedPath,
      },
    });
  }

  if (decision.compatibilityTier === 'HUMAN_VERIFICATION_REQUIRED') {
    return buildBlocker({
      code: WalletFailureCode.MERCHANT_REQUIRES_HUMAN_VERIFICATION,
      stage: 'compatibility',
      message: 'Merchant requires human verification before autonomous execution.',
      blockedReasons: decision.blockedReasons,
      details: {
        decisionId: decision.decisionId,
        compatibilityTier: decision.compatibilityTier,
        recommendedPath: decision.recommendedPath,
      },
    });
  }

  if (decision.compatibilityTier === 'PARTNER_ONLY') {
    return buildBlocker({
      code: WalletFailureCode.UNSUPPORTED_CHECKOUT_PATH,
      stage: 'compatibility',
      message: 'Merchant requires a partner connector path not available in this flow.',
      blockedReasons: decision.blockedReasons,
      details: {
        decisionId: decision.decisionId,
        compatibilityTier: decision.compatibilityTier,
        recommendedPath: decision.recommendedPath,
      },
    });
  }

  if (
    decision.recommendedPath === 'BLOCKED'
    || decision.recommendedPath === 'MANUAL_REVIEW'
  ) {
    return buildBlocker({
      code: WalletFailureCode.POLICY_BLOCKED,
      stage: 'compatibility',
      message: 'Merchant policy recommends blocking autonomous payment execution.',
      blockedReasons: decision.blockedReasons,
      details: {
        decisionId: decision.decisionId,
        compatibilityTier: decision.compatibilityTier,
        recommendedPath: decision.recommendedPath,
      },
    });
  }

  if (
    !decision.allowedActions.includes('PREPARE_CHECKOUT')
    || !decision.allowedActions.includes('CAPTURE_PAYMENT')
  ) {
    return buildBlocker({
      code: WalletFailureCode.POLICY_BLOCKED,
      stage: 'compatibility',
      message: 'Compatibility policy does not allow checkout preparation/capture.',
      blockedReasons: decision.blockedReasons,
      details: {
        decisionId: decision.decisionId,
        compatibilityTier: decision.compatibilityTier,
        allowedActions: decision.allowedActions,
      },
    });
  }

  return null;
}

function mapRiskHardStopCode(hardStopCode: string): WalletFailureCode {
  if (hardStopCode === 'HUMAN_VERIFICATION_REQUIRED') {
    return WalletFailureCode.MERCHANT_REQUIRES_HUMAN_VERIFICATION;
  }
  if (hardStopCode === 'CRITICAL_ANTI_BOT_RISK') {
    return WalletFailureCode.CAPTCHA_OR_BOT_CHALLENGE;
  }
  if (hardStopCode === 'ACTIVATION_VERIFICATION_UNAVAILABLE') {
    return WalletFailureCode.ACTIVATION_UNVERIFIED;
  }
  return WalletFailureCode.POLICY_BLOCKED;
}

function riskBlocker(risk: PreChargeGateResult): SignupFlowBlocker | null {
  if (risk.decision === 'allow' || risk.decision === 'allow_with_reserve_only') {
    return null;
  }

  const firstHardStop = risk.hardStops[0];
  const code = firstHardStop
    ? mapRiskHardStopCode(firstHardStop.code)
    : risk.merchantContext.refundRiskLevel === 'HIGH' || risk.merchantContext.refundRiskLevel === 'CRITICAL'
      ? WalletFailureCode.HIGH_REFUND_RISK
      : WalletFailureCode.POLICY_BLOCKED;

  return buildBlocker({
    code,
    stage: 'pre_charge_risk',
    message: risk.denyReason || risk.explanation.summary,
    blockedReasons: risk.blockedReasons,
    details: {
      decision: risk.decision,
      allowedExecutionPath: risk.allowedExecutionPath,
      reserveRequired: risk.reserveRequired,
      score: risk.score,
      hardStops: risk.hardStops,
      decisionId: risk.decisionId,
      engineVersion: risk.engineVersion,
    },
  });
}

export function evaluateSignupSafety(input: SignupSafetyInput): SignupSafetyEvaluation {
  const compatibility = classifyMerchantCompatibility({
    merchant: input.merchant,
    requestedAction: 'SUBSCRIBE',
    countryCode: input.countryCode || 'US',
    currency: input.currency || 'USD',
  });

  const risk = evaluatePreChargeRisk({
    merchant: input.merchant,
    compatibilityTier: compatibility.compatibilityTier,
    refundRiskLevel: compatibility.refundRiskLevel,
    requiresActivationVerification: compatibility.requiresActivationVerification,
    activationSignals: {
      verificationAvailable: input.activationVerificationMethods.length > 0,
      availableMethods: input.activationVerificationMethods,
    },
    knownRefundReliability: input.knownRefundReliability,
    antiBotRisk: input.antiBotRisk,
    accountCreation: {
      required: input.accountCreationRequired,
      accountStatus: input.accountStatus,
    },
    serviceProvisioningConfidence: input.serviceProvisioningConfidence,
    reserveOnlySupported: input.reserveOnlySupported ?? true,
    compatibilityBlockedReasons: compatibility.blockedReasons,
  });

  const blocker = compatibilityBlocker(compatibility) || riskBlocker(risk);

  return {
    compatibility,
    risk,
    allowed: blocker === null,
    blocker,
  };
}

