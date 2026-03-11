import { MERCHANT_COMPATIBILITY_RULES, MERCHANT_RULES_VERSION } from './merchantRules.ts';
import {
  MerchantCompatibilityDecisionSchema,
  MerchantCompatibilityRequestSchema,
  type MerchantCompatibilityDecision,
  type MerchantCompatibilityRequest,
  type MerchantExecutionAction,
  type MerchantRule,
} from './schemas/merchant.ts';

export const MERCHANT_COMPATIBILITY_ENGINE_VERSION = `merchant-compatibility@${MERCHANT_RULES_VERSION}`;

type MatchType = 'exact' | 'contains' | 'regex' | 'fallback';

const HARD_STOP_TIERS = new Set<string>([
  'AUTOMATION_UNSAFE',
  'HUMAN_VERIFICATION_REQUIRED',
]);

const REQUEST_TO_REQUIRED_ACTIONS: Record<
  MerchantCompatibilityRequest['requestedAction'],
  MerchantExecutionAction[]
> = {
  SUBSCRIBE: ['PREPARE_CHECKOUT', 'CAPTURE_PAYMENT', 'ACTIVATE_SERVICE'],
  BUY: ['PREPARE_CHECKOUT', 'CAPTURE_PAYMENT'],
  RENEW: ['CAPTURE_PAYMENT', 'ACTIVATE_SERVICE'],
  CANCEL: ['CANCEL'],
};

function normalizeToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeMerchant(input: string): string {
  return input.trim().toLowerCase();
}

function stableHash(input: string): string {
  // FNV-1a 32-bit for deterministic idempotency keys in both client/server runtimes.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function matchRule(rule: MerchantRule, rawMerchant: string): MatchType | null {
  const normalizedMerchant = normalizeToken(rawMerchant);

  const exactHit = rule.matcher.exact.some((value) => normalizeToken(value) === normalizedMerchant);
  if (exactHit) return 'exact';

  const regexHit = rule.matcher.regex.some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(rawMerchant);
    } catch {
      return false;
    }
  });
  if (regexHit) return 'regex';

  const containsHit = rule.matcher.contains.some((value) => {
    const norm = normalizeToken(value);
    if (!norm) return false;
    return normalizedMerchant.includes(norm) || norm.includes(normalizedMerchant);
  });
  if (containsHit) return 'contains';

  return null;
}

function rankMatchType(matchType: MatchType): number {
  if (matchType === 'exact') return 3;
  if (matchType === 'regex') return 2;
  if (matchType === 'contains') return 1;
  return 0;
}

function selectRule(merchant: string): { rule: MerchantRule | null; matchType: MatchType } {
  const candidates = MERCHANT_COMPATIBILITY_RULES
    .map((rule) => {
      const matchType = matchRule(rule, merchant);
      return { rule, matchType };
    })
    .filter((entry): entry is { rule: MerchantRule; matchType: MatchType } => Boolean(entry.matchType))
    .sort((a, b) => {
      const matchDelta = rankMatchType(b.matchType) - rankMatchType(a.matchType);
      if (matchDelta !== 0) return matchDelta;
      const priorityDelta = b.rule.priority - a.rule.priority;
      if (priorityDelta !== 0) return priorityDelta;
      return a.rule.id.localeCompare(b.rule.id);
    });

  if (candidates.length === 0) {
    return { rule: null, matchType: 'fallback' };
  }

  return candidates[0];
}

function uniqueActions(actions: MerchantExecutionAction[]): MerchantExecutionAction[] {
  return [...new Set(actions)];
}

function buildFallbackDecision(parsed: MerchantCompatibilityRequest): MerchantCompatibilityDecision {
  const merchant = parsed.merchant.trim();
  const blockedReasons = [
    'Merchant is not in compatibility catalog.',
    'Human verification is required before any payment capture.',
  ];

  const allowedActions: MerchantExecutionAction[] = [
    'RESEARCH',
    'PREPARE_CHECKOUT',
    'ESCALATE_TO_HUMAN',
  ];

  const decisionId = `mc_${stableHash([
    MERCHANT_COMPATIBILITY_ENGINE_VERSION,
    merchant.toLowerCase(),
    parsed.requestedAction,
    parsed.countryCode || '',
    'fallback',
  ].join('|'))}`;

  return MerchantCompatibilityDecisionSchema.parse({
    merchant,
    compatibilityTier: 'HUMAN_VERIFICATION_REQUIRED',
    allowedActions,
    blockedReasons,
    recommendedPath: 'MANUAL_REVIEW',
    requiresActivationVerification: true,
    refundRiskLevel: 'HIGH',
    decisionId,
    explanation: {
      engineVersion: MERCHANT_COMPATIBILITY_ENGINE_VERSION,
      ruleId: 'fallback_unknown_merchant',
      matchedOn: 'fallback',
      rationale: 'Unknown merchants default to human verification to prevent unsafe captures.',
      hardStopBeforePayment: true,
    },
  });
}

export function classifyMerchantCompatibility(input: MerchantCompatibilityRequest): MerchantCompatibilityDecision {
  const parsed = MerchantCompatibilityRequestSchema.parse(input);
  const merchant = normalizeMerchant(parsed.merchant);
  const selected = selectRule(merchant);

  if (!selected.rule) {
    return buildFallbackDecision(parsed);
  }

  const rule = selected.rule;
  const blockedReasons = [...rule.blockedReasons];
  const hardStopBeforePayment = HARD_STOP_TIERS.has(rule.tier);

  let allowedActions = uniqueActions(rule.allowedActions);
  if (hardStopBeforePayment) {
    allowedActions = allowedActions.filter((action) => (
      action !== 'CAPTURE_PAYMENT' && action !== 'ACTIVATE_SERVICE'
    ));
  }

  const requiredActions = REQUEST_TO_REQUIRED_ACTIONS[parsed.requestedAction];
  const missingRequired = requiredActions.filter((action) => !allowedActions.includes(action));
  if (missingRequired.length > 0) {
    blockedReasons.push(
      `Requested action ${parsed.requestedAction} is blocked; missing permissions: ${missingRequired.join(', ')}.`,
    );
  }

  if (hardStopBeforePayment) {
    blockedReasons.push('Hard stop enforced before payment capture by compatibility policy.');
  }

  const recommendedPath = rule.tier === 'AUTOMATION_UNSAFE'
    ? 'BLOCKED'
    : rule.tier === 'HUMAN_VERIFICATION_REQUIRED'
      ? 'MANUAL_REVIEW'
      : rule.recommendedPath;

  const decisionId = `mc_${stableHash([
    MERCHANT_COMPATIBILITY_ENGINE_VERSION,
    merchant,
    parsed.requestedAction,
    parsed.countryCode || '',
    rule.id,
    recommendedPath,
    [...new Set(blockedReasons)].join('||'),
  ].join('|'))}`;

  return MerchantCompatibilityDecisionSchema.parse({
    merchant: parsed.merchant.trim(),
    compatibilityTier: rule.tier,
    allowedActions,
    blockedReasons: [...new Set(blockedReasons)],
    recommendedPath,
    requiresActivationVerification: rule.requiresActivationVerification,
    refundRiskLevel: rule.refundRiskLevel,
    decisionId,
    explanation: {
      engineVersion: MERCHANT_COMPATIBILITY_ENGINE_VERSION,
      ruleId: rule.id,
      matchedOn: selected.matchType,
      rationale: rule.rationale,
      hardStopBeforePayment,
    },
  });
}
