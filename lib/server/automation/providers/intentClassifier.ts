import type { AutomationActionType } from '@/lib/types';
import type { ExecutionRiskLevel } from './types';

// ── Intent Classification ───────────────────────────────────────────────────
// Maps natural-language requests to structured action intents.
// This is the first layer: classify → plan → execute.

export interface ClassifiedIntent {
  actionType: AutomationActionType;
  targetService: string | null;
  confidence: number;
  riskLevel: ExecutionRiskLevel;
  missingInfo: string[];
  normalizedIntent: string;
}

export interface IntentClassificationResult {
  classified: boolean;
  intent: ClassifiedIntent | null;
  unsupportedReason?: string;
}

interface IntentRule {
  patterns: RegExp[];
  actionType: AutomationActionType;
  riskLevel: ExecutionRiskLevel;
  normalizedIntent: string;
}

// ── Keyword-based intent rules (Tier 1: fast, deterministic) ────────────────

const INTENT_RULES: IntentRule[] = [
  {
    patterns: [
      /cancel\s+(my\s+)?(.+?)\s*(subscription|membership|account|service|plan)?$/i,
      /unsubscribe\s+(from\s+)?(.+)/i,
      /stop\s+(paying|charging)\s+(for\s+)?(.+)/i,
      /get\s+rid\s+of\s+(.+)/i,
    ],
    actionType: 'subscription_cancel',
    riskLevel: 'high',
    normalizedIntent: 'cancel_subscription',
  },
  {
    patterns: [
      /lower\s+(my\s+)?(.+?)\s*(bill|cost|price|payment|charge)/i,
      /negotiate\s+(my\s+)?(.+)/i,
      /reduce\s+(my\s+)?(.+?)\s*(bill|cost|payment)/i,
      /get\s+a\s+(better|lower)\s+(deal|rate|price)\s+(on|for|from)\s+(.+)/i,
      /cheaper\s+(plan|option)\s+(for|from|on)\s+(.+)/i,
    ],
    actionType: 'subscription_negotiate',
    riskLevel: 'medium',
    normalizedIntent: 'negotiate_bill',
  },
  {
    patterns: [
      /review\s+(my\s+)?(recurring|subscriptions?|charges?|bills?)/i,
      /check\s+(my\s+)?(recurring|subscriptions?)/i,
      /what\s+(am\s+i|are\s+my)\s+(paying|subscri)/i,
      /find\s+(recurring|unused|unnecessary)\s+(charges?|subscriptions?)/i,
      /audit\s+(my\s+)?(subscriptions?|bills?|recurring)/i,
    ],
    actionType: 'recurring_review',
    riskLevel: 'low',
    normalizedIntent: 'review_recurring',
  },
  {
    patterns: [
      /fix\s+(the\s+)?(category|categoriz)/i,
      /recategorize/i,
      /(wrong|incorrect|bad)\s+category/i,
      /move\s+(this\s+)?(charge|transaction)\s+to/i,
      /miscategorized/i,
    ],
    actionType: 'expense_categorization',
    riskLevel: 'low',
    normalizedIntent: 'fix_category',
  },
  {
    patterns: [
      /(free\s+)?trial\s+(ending|expir|convert)/i,
      /check\s+(if|whether)\s+(any|my)\s+(free\s+)?trial/i,
      /about\s+to\s+(be\s+)?charged\s+for/i,
    ],
    actionType: 'trial_conversion_review',
    riskLevel: 'medium',
    normalizedIntent: 'review_trial',
  },
  {
    patterns: [
      /move\s+(money\s+)?(to\s+)?savings/i,
      /save\s+(some|extra|\$?\d+)/i,
      /transfer\s+(to\s+)?savings/i,
      /put\s+(money\s+)?(in|into)\s+savings/i,
    ],
    actionType: 'savings_transfer',
    riskLevel: 'high',
    normalizedIntent: 'transfer_savings',
  },
  {
    patterns: [
      /pay\s+(my\s+)?(.+?)\s*bill/i,
      /pay\s+off\s+(.+)/i,
      /make\s+a\s+payment\s+(on|for|to)\s+(.+)/i,
    ],
    actionType: 'bill_pay',
    riskLevel: 'critical',
    normalizedIntent: 'pay_bill',
  },
  {
    patterns: [
      /optimi(z|s)e\s+(my\s+)?debt/i,
      /pay\s+down\s+debt\s+faster/i,
      /(snowball|avalanche)\s+(my\s+)?debt/i,
    ],
    actionType: 'debt_optimize',
    riskLevel: 'high',
    normalizedIntent: 'optimize_debt',
  },
  {
    patterns: [
      /split\s+(the\s+)?(bill|expense|charge|cost)/i,
      /share\s+(the\s+)?(cost|expense)/i,
    ],
    actionType: 'bill_split',
    riskLevel: 'medium',
    normalizedIntent: 'split_expense',
  },
  {
    patterns: [
      /refund\s+(my\s+)?budget/i,
      /put\s+(the\s+)?refund\s+(back|into)/i,
      /reallocate\s+(the\s+)?refund/i,
    ],
    actionType: 'refund_budget',
    riskLevel: 'low',
    normalizedIntent: 'budget_refund',
  },
];

/** Extract target service name from the user prompt */
function extractTargetService(prompt: string): string | null {
  // Known services — expandable
  const KNOWN_SERVICES = [
    'netflix', 'spotify', 'hulu', 'disney+', 'disney plus', 'hbo max', 'hbo',
    'apple tv', 'apple music', 'amazon prime', 'prime video', 'youtube premium',
    'youtube tv', 'peacock', 'paramount+', 'paramount plus', 'crunchyroll',
    'xbox game pass', 'playstation plus', 'nintendo online',
    'adobe', 'dropbox', 'google one', 'icloud', 'onedrive',
    'gym', 'planet fitness', 'la fitness', 'peloton', 'classpass',
    'att', 'at&t', 'verizon', 't-mobile', 'tmobile', 'xfinity', 'comcast', 'spectrum',
    'geico', 'state farm', 'progressive', 'allstate',
    'grammarly', 'notion', 'slack', 'zoom', 'chatgpt', 'openai',
    'nordvpn', 'expressvpn', 'surfshark',
    'audible', 'kindle unlimited', 'scribd',
    'doordash', 'uber eats', 'grubhub', 'instacart',
    'blue apron', 'hello fresh', 'hellofresh',
  ];

  const lower = prompt.toLowerCase();
  for (const service of KNOWN_SERVICES) {
    if (lower.includes(service)) {
      return service.charAt(0).toUpperCase() + service.slice(1);
    }
  }

  // Try to extract a proper noun after "cancel my" / "lower my" etc.
  const nounMatch = prompt.match(/(?:cancel|lower|negotiate|review|check)\s+(?:my\s+)?([A-Z][a-zA-Z\s+]+?)(?:\s+subscription|\s+bill|\s+account|\s+plan|\s+membership|$)/);
  if (nounMatch?.[1]) {
    const candidate = nounMatch[1].trim();
    if (candidate.length >= 2 && candidate.length <= 40) return candidate;
  }

  return null;
}

/** Determine what information is still missing for execution */
function detectMissingInfo(
  actionType: AutomationActionType,
  targetService: string | null,
): string[] {
  const missing: string[] = [];

  // Most actions need a target
  const needsTarget = new Set<AutomationActionType>([
    'subscription_cancel',
    'subscription_negotiate',
    'trial_conversion_review',
    'bill_pay',
  ]);

  if (needsTarget.has(actionType) && !targetService) {
    missing.push('Which service or subscription?');
  }

  return missing;
}

/**
 * Classify a user prompt into a structured action intent.
 * Tier 1: keyword-based matching (fast, deterministic).
 */
export function classifyIntent(prompt: string): IntentClassificationResult {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { classified: false, intent: null, unsupportedReason: 'Empty request.' };
  }

  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        const targetService = extractTargetService(trimmed);
        const missingInfo = detectMissingInfo(rule.actionType, targetService);

        return {
          classified: true,
          intent: {
            actionType: rule.actionType,
            targetService,
            confidence: 0.85,
            riskLevel: rule.riskLevel,
            missingInfo,
            normalizedIntent: rule.normalizedIntent,
          },
        };
      }
    }
  }

  return {
    classified: false,
    intent: null,
    unsupportedReason: 'Agent Wallet couldn\'t match this to a supported action. Try something like "Cancel my Netflix" or "Lower my phone bill."',
  };
}
