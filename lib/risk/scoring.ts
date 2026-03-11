import { z } from 'zod';
import {
  MerchantCompatibilityTierSchema,
  MerchantRefundRiskLevelSchema,
  type MerchantCompatibilityTier,
  type MerchantRefundRiskLevel,
} from '../schemas/merchant.ts';

export const RiskBandSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type RiskBand = z.infer<typeof RiskBandSchema>;

export const AntiBotRiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type AntiBotRisk = z.infer<typeof AntiBotRiskSchema>;

export const KnownRefundReliabilitySchema = z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
export type KnownRefundReliability = z.infer<typeof KnownRefundReliabilitySchema>;

export const AccountStatusSchema = z.enum(['EXISTS', 'NOT_FOUND', 'UNKNOWN']);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const ActivationVerificationMethodSchema = z.enum([
  'WEBHOOK_CONFIRMATION',
  'EMAIL_RECEIPT_PARSING',
  'MERCHANT_API_CHECK',
  'POST_PURCHASE_ACCOUNT_STATE_CHECK',
  'TIMEOUT_CLASSIFICATION',
]);
export type ActivationVerificationMethod = z.infer<typeof ActivationVerificationMethodSchema>;

export const PreChargeFactorWeightSchema = z.object({
  merchantCompatibility: z.number().min(0),
  activationVerificationAvailability: z.number().min(0),
  knownRefundReliability: z.number().min(0),
  antiBotRisk: z.number().min(0),
  accountCreationDependency: z.number().min(0),
  serviceProvisioningConfidence: z.number().min(0),
});

export type PreChargeFactorWeights = z.infer<typeof PreChargeFactorWeightSchema>;

export const DEFAULT_PRE_CHARGE_FACTOR_WEIGHTS: PreChargeFactorWeights = {
  merchantCompatibility: 0.3,
  activationVerificationAvailability: 0.2,
  knownRefundReliability: 0.15,
  antiBotRisk: 0.15,
  accountCreationDependency: 0.08,
  serviceProvisioningConfidence: 0.12,
};

export const PreChargeScoringInputSchema = z.object({
  merchant: z.string().min(1),
  compatibilityTier: MerchantCompatibilityTierSchema,
  refundRiskLevel: MerchantRefundRiskLevelSchema,
  requiresActivationVerification: z.boolean(),
  activationSignals: z.object({
    verificationAvailable: z.boolean(),
    availableMethods: z.array(ActivationVerificationMethodSchema).default([]),
  }),
  knownRefundReliability: KnownRefundReliabilitySchema.default('UNKNOWN'),
  antiBotRisk: AntiBotRiskSchema,
  accountCreation: z.object({
    required: z.boolean(),
    accountStatus: AccountStatusSchema.default('UNKNOWN'),
  }),
  serviceProvisioningConfidence: z.number().min(0).max(1),
});

export type PreChargeScoringInput = z.infer<typeof PreChargeScoringInputSchema>;

export type PreChargeFactorName =
  | 'merchant_compatibility'
  | 'activation_verification_availability'
  | 'known_refund_reliability'
  | 'anti_bot_risk'
  | 'account_creation_dependency'
  | 'service_provisioning_confidence';

export interface PreChargeFactorScore {
  factor: PreChargeFactorName;
  weight: number;
  rawScore: number;
  weightedScore: number;
  rationale: string;
  signals: Record<string, unknown>;
}

export interface PreChargeScore {
  merchant: string;
  overallScore: number;
  riskBand: RiskBand;
  factors: PreChargeFactorScore[];
  normalizedWeights: PreChargeFactorWeights;
}

function clamp0To100(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeWeights(input?: Partial<PreChargeFactorWeights>): PreChargeFactorWeights {
  const merged = PreChargeFactorWeightSchema.parse({
    ...DEFAULT_PRE_CHARGE_FACTOR_WEIGHTS,
    ...(input || {}),
  });

  const total = Object.values(merged).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    throw new Error('Pre-charge factor weights must sum to a positive value');
  }

  return {
    merchantCompatibility: merged.merchantCompatibility / total,
    activationVerificationAvailability: merged.activationVerificationAvailability / total,
    knownRefundReliability: merged.knownRefundReliability / total,
    antiBotRisk: merged.antiBotRisk / total,
    accountCreationDependency: merged.accountCreationDependency / total,
    serviceProvisioningConfidence: merged.serviceProvisioningConfidence / total,
  };
}

function mapMerchantCompatibilityScore(tier: MerchantCompatibilityTier): number {
  switch (tier) {
    case 'API_NATIVE': return 95;
    case 'CHECKOUT_NATIVE': return 78;
    case 'PARTNER_ONLY': return 60;
    case 'AUTOMATION_UNSAFE': return 10;
    case 'HUMAN_VERIFICATION_REQUIRED': return 20;
    default: return 40;
  }
}

function mapActivationAvailabilityScore(input: PreChargeScoringInput): number {
  if (!input.requiresActivationVerification) {
    return input.activationSignals.verificationAvailable ? 90 : 82;
  }

  if (!input.activationSignals.verificationAvailable) {
    return 0;
  }

  const methodCount = Math.min(input.activationSignals.availableMethods.length, 4);
  return clamp0To100(65 + (methodCount * 8));
}

function mapKnownRefundReliabilityScore(
  reliability: KnownRefundReliability,
  refundRiskLevel: MerchantRefundRiskLevel,
): number {
  const base = (() => {
    switch (reliability) {
      case 'HIGH': return 92;
      case 'MEDIUM': return 72;
      case 'LOW': return 38;
      case 'UNKNOWN': return 55;
      default: return 55;
    }
  })();

  const penalty = (() => {
    switch (refundRiskLevel) {
      case 'LOW': return -5;
      case 'MEDIUM': return 0;
      case 'HIGH': return 18;
      case 'CRITICAL': return 32;
      default: return 0;
    }
  })();

  return clamp0To100(base - penalty);
}

function mapAntiBotScore(risk: AntiBotRisk): number {
  switch (risk) {
    case 'LOW': return 92;
    case 'MEDIUM': return 66;
    case 'HIGH': return 28;
    case 'CRITICAL': return 5;
    default: return 40;
  }
}

function mapAccountCreationScore(required: boolean, accountStatus: AccountStatus): number {
  if (!required) return 90;

  switch (accountStatus) {
    case 'EXISTS': return 76;
    case 'UNKNOWN': return 52;
    case 'NOT_FOUND': return 34;
    default: return 50;
  }
}

function mapServiceProvisioningScore(confidence: number): number {
  return clamp0To100(confidence * 100);
}

function scoreToRiskBand(score: number): RiskBand {
  if (score >= 80) return 'LOW';
  if (score >= 65) return 'MEDIUM';
  if (score >= 45) return 'HIGH';
  return 'CRITICAL';
}

export function computePreChargeScore(input: PreChargeScoringInput, options?: {
  weights?: Partial<PreChargeFactorWeights>;
}): PreChargeScore {
  const parsed = PreChargeScoringInputSchema.parse(input);
  const weights = normalizeWeights(options?.weights);

  const compatibilityRaw = mapMerchantCompatibilityScore(parsed.compatibilityTier);
  const activationRaw = mapActivationAvailabilityScore(parsed);
  const refundRaw = mapKnownRefundReliabilityScore(parsed.knownRefundReliability, parsed.refundRiskLevel);
  const antiBotRaw = mapAntiBotScore(parsed.antiBotRisk);
  const accountRaw = mapAccountCreationScore(parsed.accountCreation.required, parsed.accountCreation.accountStatus);
  const provisioningRaw = mapServiceProvisioningScore(parsed.serviceProvisioningConfidence);

  const factors: PreChargeFactorScore[] = [
    {
      factor: 'merchant_compatibility',
      weight: roundToTwo(weights.merchantCompatibility),
      rawScore: roundToTwo(compatibilityRaw),
      weightedScore: roundToTwo(compatibilityRaw * weights.merchantCompatibility),
      rationale: `Compatibility tier ${parsed.compatibilityTier} maps to baseline automation confidence.`,
      signals: {
        compatibilityTier: parsed.compatibilityTier,
      },
    },
    {
      factor: 'activation_verification_availability',
      weight: roundToTwo(weights.activationVerificationAvailability),
      rawScore: roundToTwo(activationRaw),
      weightedScore: roundToTwo(activationRaw * weights.activationVerificationAvailability),
      rationale: parsed.requiresActivationVerification
        ? 'Activation verification is required and scored by available verification methods.'
        : 'Activation verification is optional for this merchant flow.',
      signals: {
        requiresActivationVerification: parsed.requiresActivationVerification,
        verificationAvailable: parsed.activationSignals.verificationAvailable,
        availableMethods: parsed.activationSignals.availableMethods,
      },
    },
    {
      factor: 'known_refund_reliability',
      weight: roundToTwo(weights.knownRefundReliability),
      rawScore: roundToTwo(refundRaw),
      weightedScore: roundToTwo(refundRaw * weights.knownRefundReliability),
      rationale: 'Combines observed refund reliability with merchant refund risk profile.',
      signals: {
        knownRefundReliability: parsed.knownRefundReliability,
        refundRiskLevel: parsed.refundRiskLevel,
      },
    },
    {
      factor: 'anti_bot_risk',
      weight: roundToTwo(weights.antiBotRisk),
      rawScore: roundToTwo(antiBotRaw),
      weightedScore: roundToTwo(antiBotRaw * weights.antiBotRisk),
      rationale: 'Estimated chance that anti-bot controls interrupt checkout automation.',
      signals: {
        antiBotRisk: parsed.antiBotRisk,
      },
    },
    {
      factor: 'account_creation_dependency',
      weight: roundToTwo(weights.accountCreationDependency),
      rawScore: roundToTwo(accountRaw),
      weightedScore: roundToTwo(accountRaw * weights.accountCreationDependency),
      rationale: 'Measures risk introduced by account creation prerequisites.',
      signals: {
        required: parsed.accountCreation.required,
        accountStatus: parsed.accountCreation.accountStatus,
      },
    },
    {
      factor: 'service_provisioning_confidence',
      weight: roundToTwo(weights.serviceProvisioningConfidence),
      rawScore: roundToTwo(provisioningRaw),
      weightedScore: roundToTwo(provisioningRaw * weights.serviceProvisioningConfidence),
      rationale: 'Confidence that service provisioning completes after checkout.',
      signals: {
        serviceProvisioningConfidence: parsed.serviceProvisioningConfidence,
      },
    },
  ];

  const overallScore = roundToTwo(factors.reduce((sum, factor) => sum + factor.weightedScore, 0));

  return {
    merchant: parsed.merchant,
    overallScore,
    riskBand: scoreToRiskBand(overallScore),
    factors,
    normalizedWeights: {
      merchantCompatibility: roundToTwo(weights.merchantCompatibility),
      activationVerificationAvailability: roundToTwo(weights.activationVerificationAvailability),
      knownRefundReliability: roundToTwo(weights.knownRefundReliability),
      antiBotRisk: roundToTwo(weights.antiBotRisk),
      accountCreationDependency: roundToTwo(weights.accountCreationDependency),
      serviceProvisioningConfidence: roundToTwo(weights.serviceProvisioningConfidence),
    },
  };
}
