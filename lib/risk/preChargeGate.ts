import { z } from 'zod';
import {
  PreChargeFactorWeightSchema,
  PreChargeScoringInputSchema,
  computePreChargeScore,
  type PreChargeFactorScore,
  type PreChargeFactorWeights,
  type PreChargeScoringInput,
  type RiskBand,
} from './scoring.ts';

export const PRE_CHARGE_GATE_ENGINE_VERSION = 'pre-charge-gate@2026.03.10';

export const PreChargeDecisionSchema = z.enum([
  'allow',
  'allow_with_reserve_only',
  'deny',
  'deny_with_reason',
]);

export type PreChargeDecision = z.infer<typeof PreChargeDecisionSchema>;

export const PreChargeExecutionPathSchema = z.enum([
  'CAPTURE_ALLOWED',
  'RESERVE_ONLY',
  'BLOCKED',
]);

export const PreChargeHardStopCodeSchema = z.enum([
  'AUTOMATION_UNSAFE',
  'HUMAN_VERIFICATION_REQUIRED',
  'ACTIVATION_VERIFICATION_UNAVAILABLE',
  'CRITICAL_ANTI_BOT_RISK',
  'RESERVE_NOT_SUPPORTED',
]);

export const PreChargeThresholdsSchema = z.object({
  allowMinScore: z.number().min(0).max(100).default(78),
  reserveOnlyMinScore: z.number().min(0).max(100).default(58),
  denyBelowScore: z.number().min(0).max(100).default(42),
}).superRefine((value, ctx) => {
  if (value.allowMinScore < value.reserveOnlyMinScore) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'allowMinScore must be greater than or equal to reserveOnlyMinScore',
      path: ['allowMinScore'],
    });
  }
  if (value.reserveOnlyMinScore < value.denyBelowScore) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reserveOnlyMinScore must be greater than or equal to denyBelowScore',
      path: ['reserveOnlyMinScore'],
    });
  }
});

export const PreChargeGatePolicySchema = z.object({
  thresholds: PreChargeThresholdsSchema.default({
    allowMinScore: 78,
    reserveOnlyMinScore: 58,
    denyBelowScore: 42,
  }),
  weights: PreChargeFactorWeightSchema.partial().default({}),
  denyOnAutomationUnsafe: z.boolean().default(true),
  denyOnHumanVerificationRequired: z.boolean().default(true),
  denyOnActivationUnavailable: z.boolean().default(true),
  denyOnCriticalAntiBot: z.boolean().default(true),
  enforceReserveWhenActivationRequired: z.boolean().default(true),
  enforceReserveWhenRefundRiskHigh: z.boolean().default(true),
  enforceReserveWhenAntiBotMediumOrHigher: z.boolean().default(false),
});

export type PreChargeGatePolicy = z.infer<typeof PreChargeGatePolicySchema>;

export const PreChargeGateInputSchema = PreChargeScoringInputSchema.extend({
  reserveOnlySupported: z.boolean().default(true),
  compatibilityBlockedReasons: z.array(z.string()).default([]),
});

export type PreChargeGateInput = z.infer<typeof PreChargeGateInputSchema>;

export const PreChargeHardStopSchema = z.object({
  code: PreChargeHardStopCodeSchema,
  reason: z.string().min(1),
});

export type PreChargeHardStop = z.infer<typeof PreChargeHardStopSchema>;

export const PreChargeGateResultSchema = z.object({
  merchant: z.string().min(1),
  decision: PreChargeDecisionSchema,
  allowedExecutionPath: PreChargeExecutionPathSchema,
  reserveRequired: z.boolean(),
  denyReason: z.string().nullable(),
  blockedReasons: z.array(z.string()),
  hardStops: z.array(PreChargeHardStopSchema),
  score: z.object({
    overallScore: z.number().min(0).max(100),
    riskBand: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    factors: z.array(z.object({
      factor: z.string().min(1),
      weight: z.number().min(0),
      rawScore: z.number().min(0).max(100),
      weightedScore: z.number().min(0).max(100),
      rationale: z.string().min(1),
      signals: z.record(z.unknown()),
    })),
  }),
  merchantContext: z.object({
    compatibilityTier: PreChargeScoringInputSchema.shape.compatibilityTier,
    refundRiskLevel: PreChargeScoringInputSchema.shape.refundRiskLevel,
    requiresActivationVerification: z.boolean(),
  }),
  policyApplied: z.object({
    thresholds: PreChargeThresholdsSchema,
    weights: PreChargeFactorWeightSchema,
  }),
  explanation: z.object({
    summary: z.string().min(1),
    explainableJson: z.record(z.unknown()),
  }),
  decisionId: z.string().min(1),
  engineVersion: z.string().min(1),
});

export type PreChargeGateResult = z.infer<typeof PreChargeGateResultSchema>;

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function stableHash(input: string): string {
  // FNV-1a 32-bit keeps deterministic ids stable in browser/node runtimes.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildHardStops(input: PreChargeScoringInput, policy: PreChargeGatePolicy): PreChargeHardStop[] {
  const hardStops: PreChargeHardStop[] = [];

  if (policy.denyOnAutomationUnsafe && input.compatibilityTier === 'AUTOMATION_UNSAFE') {
    hardStops.push({
      code: 'AUTOMATION_UNSAFE',
      reason: 'Merchant is classified as AUTOMATION_UNSAFE and cannot proceed to payment capture.',
    });
  }

  if (policy.denyOnHumanVerificationRequired && input.compatibilityTier === 'HUMAN_VERIFICATION_REQUIRED') {
    hardStops.push({
      code: 'HUMAN_VERIFICATION_REQUIRED',
      reason: 'Merchant requires human verification before any capture step.',
    });
  }

  if (
    policy.denyOnActivationUnavailable
    && input.requiresActivationVerification
    && !input.activationSignals.verificationAvailable
  ) {
    hardStops.push({
      code: 'ACTIVATION_VERIFICATION_UNAVAILABLE',
      reason: 'Activation verification is required but no verification method is available.',
    });
  }

  if (policy.denyOnCriticalAntiBot && input.antiBotRisk === 'CRITICAL') {
    hardStops.push({
      code: 'CRITICAL_ANTI_BOT_RISK',
      reason: 'Critical anti-bot risk indicates checkout automation is unlikely to complete safely.',
    });
  }

  return hardStops;
}

function shouldRequireReserve(
  input: PreChargeScoringInput,
  policy: PreChargeGatePolicy,
  overallScore: number,
): boolean {
  if (input.compatibilityTier === 'PARTNER_ONLY') return true;
  if (policy.enforceReserveWhenActivationRequired && input.requiresActivationVerification) return true;
  if (policy.enforceReserveWhenRefundRiskHigh && (input.refundRiskLevel === 'HIGH' || input.refundRiskLevel === 'CRITICAL')) return true;
  if (policy.enforceReserveWhenAntiBotMediumOrHigher && (input.antiBotRisk === 'MEDIUM' || input.antiBotRisk === 'HIGH')) return true;
  if (overallScore < policy.thresholds.allowMinScore) return true;
  return false;
}

function buildSummary(params: {
  decision: PreChargeDecision;
  merchant: string;
  score: number;
  riskBand: RiskBand;
  reserveRequired: boolean;
  hardStops: PreChargeHardStop[];
  denyReason: string | null;
}): string {
  if (params.hardStops.length > 0) {
    return `Denied ${params.merchant} due to hard-stop policy: ${params.hardStops[0].reason}`;
  }

  if (params.decision === 'allow') {
    return `Allowed capture for ${params.merchant}; score ${params.score} (${params.riskBand} risk).`;
  }

  if (params.decision === 'allow_with_reserve_only') {
    return `Allowed reserve-only path for ${params.merchant}; score ${params.score} (${params.riskBand} risk).`;
  }

  if (params.decision === 'deny_with_reason' && params.denyReason) {
    return `Denied ${params.merchant}: ${params.denyReason}`;
  }

  return `Denied ${params.merchant} due to risk score ${params.score} (${params.riskBand} risk).`;
}

function canonicalizeFactors(factors: PreChargeFactorScore[]): Array<Record<string, unknown>> {
  return factors
    .map((factor) => ({
      factor: factor.factor,
      rawScore: roundToTwo(factor.rawScore),
      weight: roundToTwo(factor.weight),
      weightedScore: roundToTwo(factor.weightedScore),
      rationale: factor.rationale,
      signals: factor.signals,
    }));
}

function computeDecisionId(input: PreChargeGateInput, resultSeed: {
  decision: PreChargeDecision;
  overallScore: number;
  reserveRequired: boolean;
  hardStopCodes: string[];
  denyReason: string | null;
  thresholds: z.infer<typeof PreChargeThresholdsSchema>;
  weights: PreChargeFactorWeights;
}): string {
  const canonical = {
    merchant: input.merchant.trim().toLowerCase(),
    compatibilityTier: input.compatibilityTier,
    refundRiskLevel: input.refundRiskLevel,
    requiresActivationVerification: input.requiresActivationVerification,
    activationSignals: {
      verificationAvailable: input.activationSignals.verificationAvailable,
      availableMethods: [...input.activationSignals.availableMethods].sort(),
    },
    knownRefundReliability: input.knownRefundReliability,
    antiBotRisk: input.antiBotRisk,
    accountCreation: {
      required: input.accountCreation.required,
      accountStatus: input.accountCreation.accountStatus,
    },
    serviceProvisioningConfidence: input.serviceProvisioningConfidence,
    reserveOnlySupported: input.reserveOnlySupported,
    compatibilityBlockedReasons: [...input.compatibilityBlockedReasons].sort(),
    result: resultSeed,
    engineVersion: PRE_CHARGE_GATE_ENGINE_VERSION,
  };

  return `pcg_${stableHash(JSON.stringify(canonical))}`;
}

export function evaluatePreChargeRisk(
  input: PreChargeGateInput,
  policyInput?: Partial<PreChargeGatePolicy>,
): PreChargeGateResult {
  const parsed = PreChargeGateInputSchema.parse(input);
  const policy = PreChargeGatePolicySchema.parse({
    ...(policyInput || {}),
    thresholds: {
      ...(policyInput?.thresholds || {}),
    },
    weights: {
      ...(policyInput?.weights || {}),
    },
  });

  const score = computePreChargeScore(parsed, { weights: policy.weights });
  const hardStops = buildHardStops(parsed, policy);

  const reserveRequired = shouldRequireReserve(parsed, policy, score.overallScore);
  const blockedReasons = [...parsed.compatibilityBlockedReasons];
  let decision: PreChargeDecision;
  let allowedExecutionPath: z.infer<typeof PreChargeExecutionPathSchema>;
  let denyReason: string | null = null;

  if (hardStops.length > 0) {
    decision = 'deny_with_reason';
    allowedExecutionPath = 'BLOCKED';
    denyReason = hardStops[0].reason;
    blockedReasons.push(...hardStops.map((stop) => stop.reason));
  } else if (score.overallScore < policy.thresholds.denyBelowScore) {
    decision = 'deny';
    allowedExecutionPath = 'BLOCKED';
    blockedReasons.push(
      `Risk score ${score.overallScore} is below deny threshold ${policy.thresholds.denyBelowScore}.`,
    );
  } else if (reserveRequired) {
    if (parsed.reserveOnlySupported) {
      decision = 'allow_with_reserve_only';
      allowedExecutionPath = 'RESERVE_ONLY';
      blockedReasons.push('Reserve-only policy required before capture for this merchant flow.');
    } else {
      decision = 'deny_with_reason';
      allowedExecutionPath = 'BLOCKED';
      denyReason = 'Reserve-only execution is required, but reserve support is unavailable.';
      blockedReasons.push(denyReason);
      hardStops.push({
        code: 'RESERVE_NOT_SUPPORTED',
        reason: denyReason,
      });
    }
  } else if (score.overallScore >= policy.thresholds.allowMinScore) {
    decision = 'allow';
    allowedExecutionPath = 'CAPTURE_ALLOWED';
  } else if (score.overallScore >= policy.thresholds.reserveOnlyMinScore) {
    if (parsed.reserveOnlySupported) {
      decision = 'allow_with_reserve_only';
      allowedExecutionPath = 'RESERVE_ONLY';
      blockedReasons.push('Score is below direct-capture threshold; reserve-only mode required.');
    } else {
      decision = 'deny_with_reason';
      allowedExecutionPath = 'BLOCKED';
      denyReason = 'Score requires reserve-only handling, but reserve mode is unavailable.';
      blockedReasons.push(denyReason);
    }
  } else {
    decision = 'deny';
    allowedExecutionPath = 'BLOCKED';
    blockedReasons.push(
      `Risk score ${score.overallScore} is below reserve-only threshold ${policy.thresholds.reserveOnlyMinScore}.`,
    );
  }

  const summary = buildSummary({
    decision,
    merchant: parsed.merchant,
    score: score.overallScore,
    riskBand: score.riskBand,
    reserveRequired,
    hardStops,
    denyReason,
  });

  const normalizedWeights = PreChargeFactorWeightSchema.parse({
    merchantCompatibility: score.normalizedWeights.merchantCompatibility,
    activationVerificationAvailability: score.normalizedWeights.activationVerificationAvailability,
    knownRefundReliability: score.normalizedWeights.knownRefundReliability,
    antiBotRisk: score.normalizedWeights.antiBotRisk,
    accountCreationDependency: score.normalizedWeights.accountCreationDependency,
    serviceProvisioningConfidence: score.normalizedWeights.serviceProvisioningConfidence,
  });

  const decisionId = computeDecisionId(parsed, {
    decision,
    overallScore: score.overallScore,
    reserveRequired,
    hardStopCodes: hardStops.map((stop) => stop.code),
    denyReason,
    thresholds: policy.thresholds,
    weights: normalizedWeights,
  });

  const explainableJson = {
    merchant: parsed.merchant,
    decision,
    allowedExecutionPath,
    reserveRequired,
    denyReason,
    blockedReasons,
    hardStops,
    score: {
      overallScore: score.overallScore,
      riskBand: score.riskBand,
      factors: canonicalizeFactors(score.factors),
    },
    policy: {
      thresholds: policy.thresholds,
      weights: normalizedWeights,
      flags: {
        denyOnAutomationUnsafe: policy.denyOnAutomationUnsafe,
        denyOnHumanVerificationRequired: policy.denyOnHumanVerificationRequired,
        denyOnActivationUnavailable: policy.denyOnActivationUnavailable,
        denyOnCriticalAntiBot: policy.denyOnCriticalAntiBot,
        enforceReserveWhenActivationRequired: policy.enforceReserveWhenActivationRequired,
        enforceReserveWhenRefundRiskHigh: policy.enforceReserveWhenRefundRiskHigh,
        enforceReserveWhenAntiBotMediumOrHigher: policy.enforceReserveWhenAntiBotMediumOrHigher,
      },
    },
  } as const;

  return PreChargeGateResultSchema.parse({
    merchant: parsed.merchant,
    decision,
    allowedExecutionPath,
    reserveRequired,
    denyReason,
    blockedReasons: [...new Set(blockedReasons)],
    hardStops,
    score: {
      overallScore: score.overallScore,
      riskBand: score.riskBand,
      factors: canonicalizeFactors(score.factors),
    },
    merchantContext: {
      compatibilityTier: parsed.compatibilityTier,
      refundRiskLevel: parsed.refundRiskLevel,
      requiresActivationVerification: parsed.requiresActivationVerification,
    },
    policyApplied: {
      thresholds: policy.thresholds,
      weights: normalizedWeights,
    },
    explanation: {
      summary,
      explainableJson,
    },
    decisionId,
    engineVersion: PRE_CHARGE_GATE_ENGINE_VERSION,
  });
}
