import { z } from 'zod';

export const ApiAvailabilitySchema = z.enum(['NONE', 'LIMITED', 'ROBUST']);
export const CheckoutSimplicitySchema = z.enum(['COMPLEX', 'MODERATE', 'SIMPLE']);
export const ProvisioningReliabilitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const AntiBotRiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const RefundReliabilitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const CancellationSupportSchema = z.enum(['NONE', 'LIMITED', 'FULL']);

export const DemoRecommendedTypeSchema = z.enum([
  'API_NATIVE_AUTONOMOUS_DEMO',
  'CHECKOUT_AUTONOMOUS_DEMO',
  'MONITORED_AUTONOMOUS_DEMO',
  'DO_NOT_DEMO_AUTONOMOUS_SIGNUP',
]);

export const DemoMerchantProfileSchema = z.object({
  merchant: z.string().min(1),
  apiAvailability: ApiAvailabilitySchema,
  checkoutSimplicity: CheckoutSimplicitySchema,
  provisioningReliability: ProvisioningReliabilitySchema,
  antiBotRisk: AntiBotRiskSchema,
  refundReliability: RefundReliabilitySchema,
  subscriptionCancellationSupport: CancellationSupportSchema,
  knownAutonomousSignupBlocker: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
});

export type ApiAvailability = z.infer<typeof ApiAvailabilitySchema>;
export type CheckoutSimplicity = z.infer<typeof CheckoutSimplicitySchema>;
export type ProvisioningReliability = z.infer<typeof ProvisioningReliabilitySchema>;
export type AntiBotRisk = z.infer<typeof AntiBotRiskSchema>;
export type RefundReliability = z.infer<typeof RefundReliabilitySchema>;
export type CancellationSupport = z.infer<typeof CancellationSupportSchema>;
export type DemoRecommendedType = z.infer<typeof DemoRecommendedTypeSchema>;
export type DemoMerchantProfile = z.infer<typeof DemoMerchantProfileSchema>;

export interface DemoScoreWeights {
  apiAvailability: number;
  checkoutSimplicity: number;
  provisioningReliability: number;
  antiBotRisk: number;
  refundReliability: number;
  subscriptionCancellationSupport: number;
}

export const DEFAULT_DEMO_SCORE_WEIGHTS: DemoScoreWeights = {
  apiAvailability: 24,
  checkoutSimplicity: 14,
  provisioningReliability: 24,
  antiBotRisk: 18,
  refundReliability: 12,
  subscriptionCancellationSupport: 8,
};

export interface DemoSafetyRuleEngineConfig {
  safeThreshold: number;
  disallowAntiBotRiskAtOrAbove: AntiBotRisk;
  disallowProvisioningReliabilityAtOrBelow: ProvisioningReliability;
  requireCancellationSupportAtLeast: CancellationSupport;
  weights: DemoScoreWeights;
}

export const DEFAULT_DEMO_SAFETY_CONFIG: DemoSafetyRuleEngineConfig = {
  safeThreshold: 72,
  disallowAntiBotRiskAtOrAbove: 'HIGH',
  disallowProvisioningReliabilityAtOrBelow: 'LOW',
  requireCancellationSupportAtLeast: 'LIMITED',
  weights: DEFAULT_DEMO_SCORE_WEIGHTS,
};

export const SAMPLE_DEMO_MERCHANTS: DemoMerchantProfile[] = DemoMerchantProfileSchema.array().parse([
  {
    merchant: 'AWS',
    apiAvailability: 'ROBUST',
    checkoutSimplicity: 'MODERATE',
    provisioningReliability: 'HIGH',
    antiBotRisk: 'LOW',
    refundReliability: 'HIGH',
    subscriptionCancellationSupport: 'FULL',
    notes: ['Strong API surface and stable provisioning for demos.'],
  },
  {
    merchant: 'DigitalOcean',
    apiAvailability: 'ROBUST',
    checkoutSimplicity: 'SIMPLE',
    provisioningReliability: 'HIGH',
    antiBotRisk: 'LOW',
    refundReliability: 'HIGH',
    subscriptionCancellationSupport: 'FULL',
    notes: ['Good balance of API automation and predictable billing controls.'],
  },
  {
    merchant: 'Twilio',
    apiAvailability: 'ROBUST',
    checkoutSimplicity: 'MODERATE',
    provisioningReliability: 'HIGH',
    antiBotRisk: 'LOW',
    refundReliability: 'MEDIUM',
    subscriptionCancellationSupport: 'FULL',
    notes: ['API-first merchant; reliable provisioning signals.'],
  },
  {
    merchant: 'OpenAI',
    apiAvailability: 'ROBUST',
    checkoutSimplicity: 'SIMPLE',
    provisioningReliability: 'HIGH',
    antiBotRisk: 'LOW',
    refundReliability: 'MEDIUM',
    subscriptionCancellationSupport: 'LIMITED',
    notes: ['Strong API and straightforward platform activation checks.'],
  },
  {
    merchant: 'Vercel',
    apiAvailability: 'ROBUST',
    checkoutSimplicity: 'SIMPLE',
    provisioningReliability: 'HIGH',
    antiBotRisk: 'LOW',
    refundReliability: 'MEDIUM',
    subscriptionCancellationSupport: 'FULL',
  },
  {
    merchant: 'Notion',
    apiAvailability: 'LIMITED',
    checkoutSimplicity: 'SIMPLE',
    provisioningReliability: 'MEDIUM',
    antiBotRisk: 'MEDIUM',
    refundReliability: 'MEDIUM',
    subscriptionCancellationSupport: 'LIMITED',
    notes: ['Demo-safe only in monitored mode; activation checks required.'],
  },
  {
    merchant: 'Canva',
    apiAvailability: 'LIMITED',
    checkoutSimplicity: 'SIMPLE',
    provisioningReliability: 'MEDIUM',
    antiBotRisk: 'MEDIUM',
    refundReliability: 'MEDIUM',
    subscriptionCancellationSupport: 'LIMITED',
  },
  {
    merchant: 'Slack',
    apiAvailability: 'LIMITED',
    checkoutSimplicity: 'MODERATE',
    provisioningReliability: 'MEDIUM',
    antiBotRisk: 'MEDIUM',
    refundReliability: 'MEDIUM',
    subscriptionCancellationSupport: 'FULL',
  },
  {
    merchant: 'Netflix',
    apiAvailability: 'NONE',
    checkoutSimplicity: 'MODERATE',
    provisioningReliability: 'MEDIUM',
    antiBotRisk: 'HIGH',
    refundReliability: 'LOW',
    subscriptionCancellationSupport: 'LIMITED',
    knownAutonomousSignupBlocker: true,
    notes: ['Common anti-bot and provisioning mismatch risk in autonomous signup demos.'],
  },
  {
    merchant: 'Hulu',
    apiAvailability: 'NONE',
    checkoutSimplicity: 'MODERATE',
    provisioningReliability: 'MEDIUM',
    antiBotRisk: 'HIGH',
    refundReliability: 'LOW',
    subscriptionCancellationSupport: 'LIMITED',
    knownAutonomousSignupBlocker: true,
  },
  {
    merchant: 'Adobe',
    apiAvailability: 'LIMITED',
    checkoutSimplicity: 'COMPLEX',
    provisioningReliability: 'MEDIUM',
    antiBotRisk: 'HIGH',
    refundReliability: 'LOW',
    subscriptionCancellationSupport: 'LIMITED',
    knownAutonomousSignupBlocker: true,
    notes: ['Complex checkout and refund friction create poor demo reliability.'],
  },
  {
    merchant: 'FanDuel',
    apiAvailability: 'NONE',
    checkoutSimplicity: 'COMPLEX',
    provisioningReliability: 'LOW',
    antiBotRisk: 'CRITICAL',
    refundReliability: 'LOW',
    subscriptionCancellationSupport: 'NONE',
    knownAutonomousSignupBlocker: true,
    notes: ['Not suitable for autonomous demo flow due to policy/risk controls.'],
  },
]);

