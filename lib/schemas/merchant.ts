import { z } from 'zod';

export const MerchantCompatibilityTierSchema = z.enum([
  'API_NATIVE',
  'CHECKOUT_NATIVE',
  'PARTNER_ONLY',
  'AUTOMATION_UNSAFE',
  'HUMAN_VERIFICATION_REQUIRED',
]);

export const MerchantRecommendedPathSchema = z.enum([
  'API_DIRECT',
  'CHECKOUT_AUTOMATION',
  'PARTNER_CONNECTOR',
  'MANUAL_REVIEW',
  'BLOCKED',
]);

export const MerchantRefundRiskLevelSchema = z.enum([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const MerchantExecutionActionSchema = z.enum([
  'RESEARCH',
  'PREPARE_CHECKOUT',
  'CAPTURE_PAYMENT',
  'ACTIVATE_SERVICE',
  'CANCEL',
  'REFUND',
  'EXECUTE_VIA_PARTNER',
  'ESCALATE_TO_HUMAN',
]);

export const MerchantRequestedActionSchema = z.enum([
  'SUBSCRIBE',
  'BUY',
  'RENEW',
  'CANCEL',
]);

export const MerchantRuleMatcherSchema = z.object({
  exact: z.array(z.string().min(1)).default([]),
  contains: z.array(z.string().min(1)).default([]),
  regex: z.array(z.string().min(1)).default([]),
});

export const MerchantRuleSchema = z.object({
  id: z.string().min(3),
  priority: z.number().int().min(0).default(100),
  tier: MerchantCompatibilityTierSchema,
  matcher: MerchantRuleMatcherSchema,
  allowedActions: z.array(MerchantExecutionActionSchema).min(1),
  blockedReasons: z.array(z.string()).default([]),
  recommendedPath: MerchantRecommendedPathSchema,
  requiresActivationVerification: z.boolean().default(false),
  refundRiskLevel: MerchantRefundRiskLevelSchema,
  rationale: z.string().min(8),
});

export const MerchantCompatibilityRequestSchema = z.object({
  merchant: z.string().min(1),
  requestedAction: MerchantRequestedActionSchema,
  countryCode: z.string().trim().length(2).optional(),
  currency: z.string().trim().length(3).optional(),
});

export const MerchantCompatibilityExplanationSchema = z.object({
  engineVersion: z.string().min(1),
  ruleId: z.string().min(1),
  matchedOn: z.enum(['exact', 'contains', 'regex', 'fallback']),
  rationale: z.string().min(1),
  hardStopBeforePayment: z.boolean(),
});

export const MerchantCompatibilityDecisionSchema = z.object({
  merchant: z.string().min(1),
  compatibilityTier: MerchantCompatibilityTierSchema,
  allowedActions: z.array(MerchantExecutionActionSchema),
  blockedReasons: z.array(z.string()),
  recommendedPath: MerchantRecommendedPathSchema,
  requiresActivationVerification: z.boolean(),
  refundRiskLevel: MerchantRefundRiskLevelSchema,
  decisionId: z.string().min(1),
  explanation: MerchantCompatibilityExplanationSchema,
});

export type MerchantCompatibilityTier = z.infer<typeof MerchantCompatibilityTierSchema>;
export type MerchantRecommendedPath = z.infer<typeof MerchantRecommendedPathSchema>;
export type MerchantRefundRiskLevel = z.infer<typeof MerchantRefundRiskLevelSchema>;
export type MerchantExecutionAction = z.infer<typeof MerchantExecutionActionSchema>;
export type MerchantRequestedAction = z.infer<typeof MerchantRequestedActionSchema>;
export type MerchantRuleMatcher = z.infer<typeof MerchantRuleMatcherSchema>;
export type MerchantRule = z.infer<typeof MerchantRuleSchema>;
export type MerchantCompatibilityRequest = z.infer<typeof MerchantCompatibilityRequestSchema>;
export type MerchantCompatibilityExplanation = z.infer<typeof MerchantCompatibilityExplanationSchema>;
export type MerchantCompatibilityDecision = z.infer<typeof MerchantCompatibilityDecisionSchema>;
