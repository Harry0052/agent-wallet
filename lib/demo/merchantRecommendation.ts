import { z } from 'zod';
import {
  ApiAvailabilitySchema,
  AntiBotRiskSchema,
  CancellationSupportSchema,
  CheckoutSimplicitySchema,
  DEFAULT_DEMO_SAFETY_CONFIG,
  DemoMerchantProfileSchema,
  DemoRecommendedTypeSchema,
  ProvisioningReliabilitySchema,
  RefundReliabilitySchema,
  SAMPLE_DEMO_MERCHANTS,
  type DemoMerchantProfile,
  type DemoRecommendedType,
  type DemoSafetyRuleEngineConfig,
} from './merchantRules.ts';

const DemoRecommendationSchema = z.object({
  merchant: z.string().min(1),
  demoSafe: z.boolean(),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()).default([]),
  riskNotes: z.array(z.string()).default([]),
  recommendedDemoType: DemoRecommendedTypeSchema,
});

export type DemoRecommendation = z.infer<typeof DemoRecommendationSchema>;

const antiBotRank: Record<z.infer<typeof AntiBotRiskSchema>, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

const provisioningRank: Record<z.infer<typeof ProvisioningReliabilitySchema>, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

const cancellationRank: Record<z.infer<typeof CancellationSupportSchema>, number> = {
  NONE: 0,
  LIMITED: 1,
  FULL: 2,
};

const apiScore: Record<z.infer<typeof ApiAvailabilitySchema>, number> = {
  NONE: 10,
  LIMITED: 60,
  ROBUST: 100,
};

const checkoutScore: Record<z.infer<typeof CheckoutSimplicitySchema>, number> = {
  COMPLEX: 20,
  MODERATE: 65,
  SIMPLE: 100,
};

const provisioningScore: Record<z.infer<typeof ProvisioningReliabilitySchema>, number> = {
  LOW: 20,
  MEDIUM: 65,
  HIGH: 100,
};

const antiBotScore: Record<z.infer<typeof AntiBotRiskSchema>, number> = {
  LOW: 100,
  MEDIUM: 65,
  HIGH: 20,
  CRITICAL: 0,
};

const refundScore: Record<z.infer<typeof RefundReliabilitySchema>, number> = {
  LOW: 25,
  MEDIUM: 65,
  HIGH: 100,
};

const cancellationScore: Record<z.infer<typeof CancellationSupportSchema>, number> = {
  NONE: 0,
  LIMITED: 65,
  FULL: 100,
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeScore(merchant: DemoMerchantProfile, config: DemoSafetyRuleEngineConfig): number {
  const weights = config.weights;
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) {
    throw new Error('Demo score weights must sum to a positive number');
  }

  const weighted = (
    apiScore[merchant.apiAvailability] * weights.apiAvailability
    + checkoutScore[merchant.checkoutSimplicity] * weights.checkoutSimplicity
    + provisioningScore[merchant.provisioningReliability] * weights.provisioningReliability
    + antiBotScore[merchant.antiBotRisk] * weights.antiBotRisk
    + refundScore[merchant.refundReliability] * weights.refundReliability
    + cancellationScore[merchant.subscriptionCancellationSupport] * weights.subscriptionCancellationSupport
  ) / totalWeight;

  return round(weighted);
}

function blockedByHardRule(merchant: DemoMerchantProfile, config: DemoSafetyRuleEngineConfig): string[] {
  const reasons: string[] = [];

  if (merchant.knownAutonomousSignupBlocker) {
    reasons.push('Merchant is marked as a common autonomous-signup blocker.');
  }

  if (antiBotRank[merchant.antiBotRisk] >= antiBotRank[config.disallowAntiBotRiskAtOrAbove]) {
    reasons.push(`Anti-bot risk is ${merchant.antiBotRisk}, which is above demo-safe policy.`);
  }

  if (provisioningRank[merchant.provisioningReliability] <= provisioningRank[config.disallowProvisioningReliabilityAtOrBelow]) {
    reasons.push(`Provisioning reliability is ${merchant.provisioningReliability}, below required demo threshold.`);
  }

  if (cancellationRank[merchant.subscriptionCancellationSupport] < cancellationRank[config.requireCancellationSupportAtLeast]) {
    reasons.push(
      `Cancellation support is ${merchant.subscriptionCancellationSupport}; policy requires ${config.requireCancellationSupportAtLeast} or better.`,
    );
  }

  return reasons;
}

function recommendDemoType(input: {
  merchant: DemoMerchantProfile;
  demoSafe: boolean;
  score: number;
}): DemoRecommendedType {
  if (!input.demoSafe) return 'DO_NOT_DEMO_AUTONOMOUS_SIGNUP';

  if (
    input.merchant.apiAvailability === 'ROBUST'
    && input.merchant.provisioningReliability === 'HIGH'
    && input.merchant.antiBotRisk === 'LOW'
  ) {
    return 'API_NATIVE_AUTONOMOUS_DEMO';
  }

  if (
    input.merchant.checkoutSimplicity === 'SIMPLE'
    && input.merchant.antiBotRisk !== 'HIGH'
    && input.merchant.antiBotRisk !== 'CRITICAL'
  ) {
    return 'CHECKOUT_AUTONOMOUS_DEMO';
  }

  return 'MONITORED_AUTONOMOUS_DEMO';
}

function reasonList(merchant: DemoMerchantProfile, score: number): string[] {
  return [
    `API availability: ${merchant.apiAvailability}`,
    `Checkout simplicity: ${merchant.checkoutSimplicity}`,
    `Provisioning reliability: ${merchant.provisioningReliability}`,
    `Refund reliability: ${merchant.refundReliability}`,
    `Cancellation support: ${merchant.subscriptionCancellationSupport}`,
    `Composite demo score: ${score}`,
  ];
}

function riskNotes(merchant: DemoMerchantProfile): string[] {
  const notes: string[] = [];
  if (merchant.antiBotRisk === 'MEDIUM') notes.push('Medium anti-bot risk: keep fallback handling visible in demo.');
  if (merchant.refundReliability === 'LOW') notes.push('Low refund reliability: avoid capture-first demo path.');
  if (merchant.provisioningReliability !== 'HIGH') notes.push('Provisioning is not consistently immediate; verify activation before capture.');
  if (merchant.notes.length > 0) notes.push(...merchant.notes);
  return notes;
}

export function recommendMerchantForDemo(
  input: DemoMerchantProfile,
  config: Partial<DemoSafetyRuleEngineConfig> = {},
): DemoRecommendation {
  const merchant = DemoMerchantProfileSchema.parse(input);
  const mergedConfig: DemoSafetyRuleEngineConfig = {
    ...DEFAULT_DEMO_SAFETY_CONFIG,
    ...config,
    weights: {
      ...DEFAULT_DEMO_SAFETY_CONFIG.weights,
      ...(config.weights || {}),
    },
  };

  const score = computeScore(merchant, mergedConfig);
  const hardRuleReasons = blockedByHardRule(merchant, mergedConfig);
  const thresholdSafe = score >= mergedConfig.safeThreshold;
  const demoSafe = hardRuleReasons.length === 0 && thresholdSafe;
  const reasons = demoSafe
    ? reasonList(merchant, score)
    : [...hardRuleReasons, ...reasonList(merchant, score)];
  const recommendation = recommendDemoType({
    merchant,
    demoSafe,
    score,
  });

  return DemoRecommendationSchema.parse({
    merchant: merchant.merchant,
    demoSafe,
    score,
    reasons,
    riskNotes: riskNotes(merchant),
    recommendedDemoType: recommendation,
  });
}

export function rankDemoSafeMerchants(
  merchants: DemoMerchantProfile[] = SAMPLE_DEMO_MERCHANTS,
  config: Partial<DemoSafetyRuleEngineConfig> = {},
): DemoRecommendation[] {
  const recommendations = merchants.map((merchant) => recommendMerchantForDemo(merchant, config));
  return recommendations
    .sort((a, b) => {
      if (a.demoSafe !== b.demoSafe) return a.demoSafe ? -1 : 1;
      return b.score - a.score;
    });
}

export function listDefaultDemoCandidates(): DemoRecommendation[] {
  return rankDemoSafeMerchants(SAMPLE_DEMO_MERCHANTS);
}

