import { z } from 'zod';
import { callClaudeMessagesApi } from '@/lib/server/claude';
import { deriveVendorCandidatesFromContext, sanitizeVendorTargets } from '@/lib/server/vendorTargeting';
import { getSecretFromAny } from '@/security/secretsManager';
import { sanitizeAiText } from '@/security/aiSanitizer';
import { assertPromptSafe } from '@/security/promptGuard';

const INTENT_VALUES = [
  'send_money',
  'compare_and_buy',
  'signup_and_prepare_checkout',
  'procurement_task',
  'candidate_sourcing_task',
  'fund_wallet',
  'review_spend',
  'cancel_subscription',
] as const;

const DELIVERY_METHOD_VALUES = [
  'cash_app',
  'stripe_connected',
  'bank',
] as const;

const PROFILE_FIELD_VALUES = [
  'full_name',
  'email',
  'phone',
  'company_name',
  'billing_name',
  'address_line1',
  'address_line2',
  'city',
  'state_region',
  'postal_code',
  'country',
] as const;

const AgentIntentSchema = z.object({
  intent: z.enum(INTENT_VALUES),
  amount: z.number().nonnegative().nullable(),
  currency: z.literal('USD'),
  normalized_goal: z.string().trim().min(1).nullable().optional(),
  category: z.string().trim().min(1).nullable().optional(),
  scope_locked: z.boolean().default(false),
  candidate_vendors: z.array(z.string().trim().min(1)).max(12).default([]),
  recipient_name: z.string().trim().min(1).nullable(),
  delivery_method: z.enum(DELIVERY_METHOD_VALUES).nullable().optional(),
  recipient_stripe_account_id: z.string().trim().regex(/^acct_[A-Za-z0-9]+$/).nullable().optional(),
  cash_app_cashtag: z.string().trim().regex(/^\$[A-Za-z][A-Za-z0-9_]{1,}$/).nullable().optional(),
  bank_reference: z.string().trim().min(2).nullable().optional(),
  funding_source: z.string().trim().min(1).nullable().optional(),
  merchant: z.string().trim().min(1).nullable(),
  description: z.string().trim().min(1),
  budget_limit: z.number().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
  missing_fields: z.array(z.string().trim().min(1)).max(8),
  required_profile_fields: z.array(z.enum(PROFILE_FIELD_VALUES)).max(12).default([]),
  profile_updates: z.object({
    full_name: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(4).optional(),
    company_name: z.string().trim().min(1).optional(),
    billing_name: z.string().trim().min(1).optional(),
    address_line1: z.string().trim().min(1).optional(),
    address_line2: z.string().trim().min(1).optional(),
    city: z.string().trim().min(1).optional(),
    state_region: z.string().trim().min(1).optional(),
    postal_code: z.string().trim().min(1).optional(),
    country: z.string().trim().min(1).optional(),
  }).optional(),
});

export type AgentIntent = z.infer<typeof AgentIntentSchema>;

function parserPrompt(message: string, context?: string): string {
  return [
    'You are the intent parser for Agent Wallet.',
    'Return valid JSON only. No prose.',
    '',
    'INTENTS:',
    '- send_money: pay/send/transfer money to a person or recipient',
    '- compare_and_buy: compare/rank/pick-best then buy',
    '- signup_and_prepare_checkout: explicit sign-up/form-fill/checkout-prep',
    '- procurement_task: buy/compare/find products/services/subscriptions',
    '- candidate_sourcing_task: source candidates (e.g., Indeed/LinkedIn), shortlist talent, export results',
    '- fund_wallet: add/deposit money to the user wallet',
    '- review_spend: balance/history/budget/spend review',
    '- cancel_subscription: cancel/downgrade an existing SaaS subscription',
    '',
    'Intent routing rules:',
    '- "send liz five dollars", "pay my fiancee a dollar", "transfer 10 to bob" → send_money',
    '  send_money is ONLY for peer-to-peer transfers to a named person/recipient.',
    '- "add $25", "top up my wallet", "fund my account" → fund_wallet',
    '- "buy me coffee", "buy notion under 15/mo", "find me a CRM", "order lunch under $15", "get me a parking pass" → procurement_task',
    '  procurement_task is for buying products/services/goods. "buy me X" = procurement, NOT send_money.',
    '- "find a streaming service with Top Gun Maverick", "compare CRMs" → compare_and_buy',
    '- "sign in to indeed, find 3 senior software engineers, shortlist and export to google sheets" → candidate_sourcing_task',
    '- "sign up for Notion Pro" → signup_and_prepare_checkout',
    '- "log into Stripe", "reconnect Netflix", "use my saved Netflix login" → signup_and_prepare_checkout',
    '- "cancel my grammarly subscription" → cancel_subscription',
    '- "what did I spend today", "balance" → review_spend',
    '',
    'Entity extraction rules:',
    '- For send_money: extract the person/nickname/relationship as recipient_name exactly as stated.',
    '  "pay my fiancee" → recipient_name: "my fiancee"',
    '  "send liz five" → recipient_name: "liz"',
    '  Extract delivery_method if present: cash_app, stripe_connected, bank.',
    '  Extract cash_app_cashtag if provided (starts with $ and includes letters).',
    '  Extract bank_reference if user provides a bank reference/account hint.',
    '  Natural language amounts: "a dollar" → 1, "five" → 5, "twenty" → 20, "a hundred" → 100.',
    '- For procurement_task: extract budget from "under $X/mo" or similar as budget_limit.',
    '- For candidate_sourcing_task: capture normalized_goal, category=\"candidate_sourcing\", and any location/skill constraints in description.',
    '  merchant = the specific product/service name if mentioned.',
    '- For signup_and_prepare_checkout: when user asks to log in/reconnect/use saved login, merchant is the service name (Stripe, Netflix, Notion, Gmail, etc.).',
    '- For compare_and_buy/procurement_task: include normalized_goal, category, and candidate_vendors when possible.',
    '- If the user explicitly names vendors (e.g. "between X and Y" or "X vs Y"), set scope_locked=true and keep candidate_vendors limited to those vendors.',
    '- Never fabricate recipient accounts, vendor pricing, completion state, or balances.',
    '- If message contains a Stripe connected account id (acct_...), place it in recipient_stripe_account_id.',
    '- required_profile_fields should include only fields needed to continue sign-up/checkout prep.',
    '- profile_updates should include any profile fields explicitly provided by the user message.',
    '- If context indicates pending clarification, interpret the message as clarification for that pending task.',
    '- missing_fields must include only actionable blockers (amount, recipient_name, recipient_delivery_method, cash_app_cashtag, bank_reference, recipient_stripe_account_id, merchant).',
    '- currency must always be USD.',
    '- confidence must be between 0 and 1.',
    '',
    context ? `Conversation context: ${context}` : '',
    `User message: ${message}`,
  ].filter(Boolean).join('\n');
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error('Claude returned no JSON object for intent parsing');
}

const INTENT_SET = new Set<string>(INTENT_VALUES);
const PROFILE_FIELD_SET = new Set<string>(PROFILE_FIELD_VALUES);

const NUMBER_WORD_VALUES: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pickValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  return toTrimmedString(pickValue(record, keys));
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numeric = Number(value.replace(/[$,\s]/g, ''));
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  return toNumber(pickValue(record, keys));
}

function readStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  const value = pickValue(record, keys);
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => toTrimmedString(item))
    .filter((item): item is string => Boolean(item));
}

function clampConfidence(value: number | null): number {
  if (value === null) return 0.6;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseWordAmount(word: string): number | null {
  const normalized = word.trim().toLowerCase();
  const mapped = NUMBER_WORD_VALUES[normalized];
  return typeof mapped === 'number' ? mapped : null;
}

function extractAmountFromMessage(message: string): number | null {
  const lower = message.toLowerCase();
  const numberMatch = lower.match(/\$?\s*(\d+(?:\.\d+)?)\s*(?:usd|dollars?|bucks?)?\b/);
  if (numberMatch?.[1]) {
    const parsed = Number(numberMatch[1]);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  const wordMatch = lower.match(
    /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/,
  );
  if (wordMatch?.[1]) {
    const parsed = parseWordAmount(wordMatch[1]);
    if (parsed !== null && parsed >= 0) return parsed;
  }

  return null;
}

function extractBudgetFromMessage(message: string): number | null {
  const lower = message.toLowerCase();
  if (/\bfree\b/.test(lower)) return 0;

  const budgetMatch = lower.match(/(?:under|below|less than|at most|up to|max(?:imum)?(?:\s+of)?)\s*\$?\s*(\d+(?:\.\d+)?)/);
  if (budgetMatch?.[1]) {
    const parsed = Number(budgetMatch[1]);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  return null;
}

function extractRecipientFromMessage(message: string): string | null {
  const directWithAmount = message.match(
    /\b(?:send|pay|transfer)\s+(.+?)\s+(?:\$?\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|hundred)\b/i,
  );
  if (directWithAmount?.[1]) {
    return directWithAmount[1].trim().replace(/[.,!?]+$/, '');
  }

  const toMatch = message.match(/\bto\s+([A-Za-z][A-Za-z0-9'._-]*(?:\s+[A-Za-z][A-Za-z0-9'._-]*){0,2})\b/i);
  if (toMatch?.[1]) {
    return toMatch[1].trim().replace(/[.,!?]+$/, '');
  }

  const directMatch = message.match(/\b(?:send|pay|transfer)\s+([A-Za-z][A-Za-z0-9'._-]*(?:\s+[A-Za-z][A-Za-z0-9'._-]*){0,2})\b/i);
  if (directMatch?.[1]) {
    return directMatch[1].trim().replace(/[.,!?]+$/, '');
  }

  return null;
}

function normalizeDeliveryMethod(value: string | null): AgentIntent['delivery_method'] {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'cashapp' || normalized === 'cash_app') return 'cash_app';
  if (normalized === 'stripe' || normalized === 'stripe_connected' || normalized === 'stripe_recipient') return 'stripe_connected';
  if (normalized === 'bank' || normalized === 'ach' || normalized === 'wire') return 'bank';
  return null;
}

function extractDeliveryMethodFromMessage(message: string): AgentIntent['delivery_method'] {
  const lower = message.toLowerCase();
  if (/\bcash\s*app\b|\bcashtag\b/.test(lower)) return 'cash_app';
  if (/\bacct_[a-z0-9]+\b/.test(lower)) return 'stripe_connected';
  if (/\bstripe\b/.test(lower) && /\b(recipient|account|connected)\b/.test(lower)) return 'stripe_connected';
  if (/\b(bank|ach|wire)\b/.test(lower)) return 'bank';
  return null;
}

function extractCashAppCashtagFromMessage(message: string): string | null {
  const cashtagMatch = message.match(/\$[A-Za-z][A-Za-z0-9_]{1,}/);
  return cashtagMatch?.[0] || null;
}

function extractBankReferenceFromMessage(message: string): string | null {
  const explicit = message.match(
    /\b(?:bank(?:\s+reference)?|bank\s+account|ach|wire)\b[^A-Za-z0-9]*(?:is|:)?\s*([A-Za-z0-9._#*-]{3,})/i,
  );
  if (explicit?.[1]) {
    return explicit[1];
  }

  const ending = message.match(/\baccount\s*(?:ending|ends?)\s*(?:in|with)?\s*([0-9]{3,6})\b/i);
  if (ending?.[1]) {
    return `ending ${ending[1]}`;
  }

  return null;
}

function extractFundingSourceFromMessage(message: string): string | null {
  const lower = message.toLowerCase();
  if (/\bfrom\s+my\s+wallet\b/.test(lower)) return 'wallet_balance';
  if (/\bfrom\s+(?:my\s+)?(?:card|debit|credit)\b/.test(lower)) return 'card';
  if (/\bfrom\s+(?:my\s+)?bank\b/.test(lower)) return 'bank';
  return null;
}

function extractMerchantFromMessage(intent: AgentIntent['intent'], message: string): string | null {
  if (intent === 'cancel_subscription') {
    const matched = message.match(/\bcancel(?:\s+my)?\s+(.+?)(?:\s+subscription)?$/i);
    if (matched?.[1]) {
      return matched[1].trim().replace(/[.,!?]+$/, '');
    }
  }

  if (intent === 'signup_and_prepare_checkout') {
    const matched = message.match(/\b(?:sign\s*up|signup|register)(?:\s+for)?\s+(.+)$/i);
    if (matched?.[1]) {
      return matched[1].trim().replace(/[.,!?]+$/, '');
    }

    const loginMatched = message.match(/\b(?:log\s*into|log\s*in|login|sign\s*into|sign\s*in)(?:\s+to)?\s+(.+)$/i);
    if (loginMatched?.[1]) {
      return loginMatched[1].trim().replace(/[.,!?]+$/, '');
    }

    const reconnectMatched = message.match(/\breconnect\s+(.+)$/i);
    if (reconnectMatched?.[1]) {
      return reconnectMatched[1].trim().replace(/[.,!?]+$/, '');
    }

    const savedLoginMatched = message.match(/\buse\s+my\s+saved\s+(.+?)\s+login\b/i);
    if (savedLoginMatched?.[1]) {
      return savedLoginMatched[1].trim().replace(/[.,!?]+$/, '');
    }
  }

  return null;
}

function inferIntent(message: string, candidate: string | null): AgentIntent['intent'] {
  if (candidate && INTENT_SET.has(candidate)) {
    return candidate as AgentIntent['intent'];
  }

  const lower = message.toLowerCase();
  const comparisonLanguage = /\b(compare|versus|vs\.?|which is better|what is better|better for|choose between|best)\b/.test(lower);
  const researchEntityLanguage = /\b(app|tool|software|platform|service|vendor|solution|crm|note[\s-]?taking|outreach|email|subscription)\b/.test(lower);
  const sourcingLanguage = /\b(indeed|linkedin|candidate|candidates|recruit|recruiting|hire|hiring|shortlist|talent|software engineer profile)\b/.test(lower);
  if (sourcingLanguage) return 'candidate_sourcing_task';
  if (comparisonLanguage && researchEntityLanguage) return 'compare_and_buy';
  if (/\b(cash\s*app|cashtag|acct_[a-z0-9]+|stripe\s+recipient)\b/.test(lower) || /\$[a-z][a-z0-9_]{1,}/i.test(message)) {
    return 'send_money';
  }
  if (/\b(log\s*into|log\s*in|login|sign\s*into|sign\s*in|reconnect|saved\s+login|use\s+my\s+saved)\b/.test(lower)) {
    return 'signup_and_prepare_checkout';
  }
  if (/\b(subscribe\s+to|sign\s*up\s+for|signup\s+for|register\s+for|enroll\s+in)\b/.test(lower)) {
    return 'signup_and_prepare_checkout';
  }
  // "buy me X" / "order X" / "get me X" → procurement (must be checked BEFORE send_money)
  if (/\b(buy\s+me|order\s+me|get\s+me|buy\s+a|order\s+a|find\s+me)\b/.test(lower)) return 'procurement_task';
  if (/\b(send|pay|transfer)\b/.test(lower)) return 'send_money';
  if (/\b(top\s*up|topup|fund|deposit)\b/.test(lower)) return 'fund_wallet';
  if (/\b(cancel|unsubscribe|downgrade)\b/.test(lower)) return 'cancel_subscription';
  if (/\b(balance|spent|spend|history|transactions?)\b/.test(lower)) return 'review_spend';
  if (/\b(sign\s*up|signup|register|checkout|subscribe)\b/.test(lower)) return 'signup_and_prepare_checkout';
  if (/\b(compare|rank|pick|best)\b/.test(lower)) return 'compare_and_buy';
  if (/\b(buy|purchase|order|get)\b/.test(lower)) return 'procurement_task';
  return 'procurement_task';
}

function inferProcurementCategory(message: string): string | null {
  const lower = message.toLowerCase();
  if (/\bnote[\s-]?taking|notes?|knowledge\s*base\b/.test(lower)) return 'note_taking';
  if (/\bcrm|pipeline\s*management|sales\s*pipeline\b/.test(lower)) return 'crm';
  if (/\bemail\s*outreach|cold\s*email|sales\s*engagement|outreach\b/.test(lower)) return 'email_outreach';
  return null;
}

function extractCandidateVendorsFromMessage(message: string): string[] {
  const candidates: string[] = [];

  const versus = message.match(/\b([A-Za-z][A-Za-z0-9.+_-]{1,24})\s+(?:vs\.?|versus)\s+([A-Za-z][A-Za-z0-9.+_-]{1,24})\b/i);
  if (versus?.[1] && versus?.[2]) {
    candidates.push(versus[1], versus[2]);
  }

  const between = message.match(/\bchoose\s+between\s+(.+?)\s+and\s+(.+?)(?:\s+for|\s+under|\s+with|$)/i);
  if (between?.[1] && between?.[2]) {
    candidates.push(between[1], between[2]);
  }

  const genericBetween = message.match(/\bbetween\s+(.+?)\s+and\s+(.+?)(?:\s+for|\s+under|\s+with|$)/i);
  if (genericBetween?.[1] && genericBetween?.[2]) {
    candidates.push(genericBetween[1], genericBetween[2]);
  }

  return sanitizeVendorTargets(candidates.map((value) => value.trim()), 8);
}

function normalizeProfileUpdates(raw: Record<string, unknown>): AgentIntent['profile_updates'] {
  const value = pickValue(raw, ['profile_updates', 'profileUpdates']);
  const source = asRecord(value);

  const keyMap: Record<string, AgentIntent['required_profile_fields'][number]> = {
    full_name: 'full_name',
    fullName: 'full_name',
    email: 'email',
    phone: 'phone',
    company_name: 'company_name',
    companyName: 'company_name',
    billing_name: 'billing_name',
    billingName: 'billing_name',
    address_line1: 'address_line1',
    addressLine1: 'address_line1',
    address_line2: 'address_line2',
    addressLine2: 'address_line2',
    city: 'city',
    state_region: 'state_region',
    stateRegion: 'state_region',
    postal_code: 'postal_code',
    postalCode: 'postal_code',
    country: 'country',
  };

  const normalized: Partial<NonNullable<AgentIntent['profile_updates']>> = {};
  for (const [key, valueAtKey] of Object.entries(source)) {
    const mappedKey = keyMap[key];
    if (!mappedKey) continue;
    const trimmed = toTrimmedString(valueAtKey);
    if (!trimmed) continue;
    normalized[mappedKey] = trimmed;
  }

  return Object.keys(normalized).length > 0
    ? (normalized as AgentIntent['profile_updates'])
    : undefined;
}

function normalizeRequiredProfileFields(raw: Record<string, unknown>): AgentIntent['required_profile_fields'] {
  const candidates = readStringArray(raw, ['required_profile_fields', 'requiredProfileFields']);
  const aliasMap: Record<string, AgentIntent['required_profile_fields'][number]> = {
    fullName: 'full_name',
    companyName: 'company_name',
    billingName: 'billing_name',
    addressLine1: 'address_line1',
    addressLine2: 'address_line2',
    stateRegion: 'state_region',
    postalCode: 'postal_code',
  };

  const unique = new Set<AgentIntent['required_profile_fields'][number]>();
  candidates.forEach((field) => {
    const normalized = aliasMap[field] || field;
    if (PROFILE_FIELD_SET.has(normalized)) {
      unique.add(normalized as AgentIntent['required_profile_fields'][number]);
    }
  });

  return Array.from(unique).slice(0, 12);
}

function normalizeMissingFields(
  raw: Record<string, unknown>,
  intent: AgentIntent['intent'],
  amount: number | null,
  recipientName: string | null,
  deliveryMethod: AgentIntent['delivery_method'],
  recipientStripeAccountId: string | null,
  cashAppCashtag: string | null,
  bankReference: string | null,
  merchant: string | null,
): string[] {
  if (intent === 'compare_and_buy' || intent === 'procurement_task' || intent === 'candidate_sourcing_task') {
    // Ephemeral reasoning tasks can proceed using discovery from natural language.
    return [];
  }

  const explicit = readStringArray(raw, ['missing_fields', 'missingFields']);
  const aliasMap: Record<string, string> = {
    recipient_account: 'recipient_delivery_method',
    recipient_method: 'recipient_delivery_method',
    payment_method: 'recipient_delivery_method',
    recipient_account_id: 'recipient_stripe_account_id',
    cashtag: 'cash_app_cashtag',
  };
  const list = explicit.length > 0 ? explicit : [];
  const normalized = list.map((field) => aliasMap[field] || field);

  if (intent === 'send_money') {
    if (amount === null || amount <= 0) normalized.push('amount');
    if (!recipientName) normalized.push('recipient_name');
    if (!deliveryMethod) {
      normalized.push('recipient_delivery_method');
    } else if (deliveryMethod === 'cash_app' && !cashAppCashtag) {
      normalized.push('cash_app_cashtag');
    } else if (deliveryMethod === 'stripe_connected' && !recipientStripeAccountId) {
      normalized.push('recipient_stripe_account_id');
    } else if (deliveryMethod === 'bank' && !bankReference) {
      normalized.push('bank_reference');
    }
  } else if (intent === 'fund_wallet') {
    if (amount === null || amount <= 0) normalized.push('amount');
  } else if ((intent === 'cancel_subscription' || intent === 'signup_and_prepare_checkout') && !merchant) {
    normalized.push('merchant');
  }

  return Array.from(new Set(normalized)).slice(0, 8);
}

function normalizeIntentPayload(parsedIntent: unknown, message: string): AgentIntent {
  const raw = asRecord(parsedIntent);
  const intent = inferIntent(message, readString(raw, ['intent', 'task', 'type']));

  const amountCandidate = readNumber(raw, ['amount', 'amount_usd', 'value']);
  const amountFallback = (intent === 'send_money' || intent === 'fund_wallet')
    ? extractAmountFromMessage(message)
    : null;
  const amount = amountCandidate ?? amountFallback;

  const budgetCandidate = readNumber(raw, ['budget_limit', 'budgetLimit', 'budget']);
  const budgetLimit = budgetCandidate ?? (intent === 'procurement_task' || intent === 'compare_and_buy'
    ? extractBudgetFromMessage(message)
    : null);
  const normalizedGoal = readString(raw, ['normalized_goal', 'normalizedGoal', 'goal', 'query'])
    || ((intent === 'procurement_task' || intent === 'compare_and_buy' || intent === 'candidate_sourcing_task') ? message.trim() : null);
  const category = readString(raw, ['category'])
    || (intent === 'candidate_sourcing_task'
      ? 'candidate_sourcing'
      : ((intent === 'procurement_task' || intent === 'compare_and_buy') ? inferProcurementCategory(message) : null));
  const candidateVendorRaw = readStringArray(raw, ['candidate_vendors', 'candidateVendors', 'targetVendorCandidates'])
    .slice(0, 12);
  const explicitCandidates = (intent === 'procurement_task' || intent === 'compare_and_buy')
    ? extractCandidateVendorsFromMessage(message)
    : [];
  const rawScopeLocked = pickValue(raw, ['scope_locked', 'scopeLocked']) === true;
  const scopeLocked = (intent === 'procurement_task' || intent === 'compare_and_buy')
    ? (rawScopeLocked || explicitCandidates.length > 0)
    : false;
  const inferredCandidates = (intent === 'procurement_task' || intent === 'compare_and_buy') && !scopeLocked
    ? deriveVendorCandidatesFromContext({
      goal: normalizedGoal || message,
      category,
      maxCandidates: 8,
    })
    : [];
  const lockedCandidates = explicitCandidates.length > 0 ? explicitCandidates : candidateVendorRaw;
  const candidateVendors = sanitizeVendorTargets(
    scopeLocked
      ? lockedCandidates
      : [...candidateVendorRaw, ...explicitCandidates, ...inferredCandidates],
    8,
  );

  const recipientName = readString(raw, ['recipient_name', 'recipientName', 'recipient', 'payee'])
    || (intent === 'send_money' ? extractRecipientFromMessage(message) : null);

  const deliveryMethodCandidate = readString(raw, [
    'delivery_method',
    'deliveryMethod',
    'send_method',
    'sendMethod',
    'recipient_delivery_method',
    'recipientDeliveryMethod',
  ]);
  const deliveryMethod = normalizeDeliveryMethod(deliveryMethodCandidate)
    || (intent === 'send_money' ? extractDeliveryMethodFromMessage(message) : null);

  const merchant = readString(raw, ['merchant', 'vendor', 'service'])
    || extractMerchantFromMessage(intent, message);

  const recipientStripeAccountId = readString(raw, ['recipient_stripe_account_id', 'recipientStripeAccountId']);
  const validStripeAccountId = recipientStripeAccountId && /^acct_[A-Za-z0-9]+$/.test(recipientStripeAccountId)
    ? recipientStripeAccountId
    : null;
  const cashAppCashtag = readString(raw, ['cash_app_cashtag', 'cashAppCashtag'])
    || (intent === 'send_money' ? extractCashAppCashtagFromMessage(message) : null);
  const bankReference = readString(raw, ['bank_reference', 'bankReference'])
    || (intent === 'send_money' ? extractBankReferenceFromMessage(message) : null);
  const fundingSource = readString(raw, ['funding_source', 'fundingSource'])
    || extractFundingSourceFromMessage(message);

  const confidence = clampConfidence(readNumber(raw, ['confidence']));
  const requiredProfileFields = normalizeRequiredProfileFields(raw);
  const profileUpdates = normalizeProfileUpdates(raw);
  const missingFields = normalizeMissingFields(
    raw,
    intent,
    amount,
    recipientName,
    deliveryMethod,
    validStripeAccountId,
    cashAppCashtag,
    bankReference,
    merchant,
  );

  return AgentIntentSchema.parse({
    intent,
    amount: amount !== null && amount >= 0 ? amount : null,
    currency: 'USD',
    normalized_goal: normalizedGoal,
    category,
    scope_locked: scopeLocked,
    candidate_vendors: candidateVendors,
    recipient_name: recipientName,
    delivery_method: deliveryMethod,
    recipient_stripe_account_id: validStripeAccountId,
    cash_app_cashtag: cashAppCashtag,
    bank_reference: bankReference,
    funding_source: fundingSource,
    merchant,
    description: readString(raw, ['description', 'summary']) || message.trim(),
    budget_limit: budgetLimit !== null && budgetLimit >= 0 ? budgetLimit : null,
    confidence,
    missing_fields: missingFields,
    required_profile_fields: requiredProfileFields,
    profile_updates: profileUpdates,
  });
}

export async function parseAgentIntent(
  message: string,
  options?: { context?: string },
): Promise<AgentIntent> {
  assertPromptSafe(message, 'lib.server.agentIntent.message');
  if (options?.context) {
    assertPromptSafe(options.context, 'lib.server.agentIntent.context');
  }

  const safeMessage = sanitizeAiText(message);
  const safeContext = options?.context ? sanitizeAiText(options.context) : undefined;
  const apiKey = getSecretFromAny(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);

  let parsedIntent: unknown = null;

  try {
    const { raw } = await callClaudeMessagesApi({
      apiKey,
      operation: 'intent parsing',
      maxTokens: 700,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: parserPrompt(safeMessage, safeContext),
        },
      ],
    });

    const parsedResponse = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
    const text = parsedResponse.content
      ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text as string)
      .join('\n')
      .trim();

    if (text) {
      parsedIntent = JSON.parse(extractJsonText(text));
    }
  } catch {
    parsedIntent = null;
  }

  return normalizeIntentPayload(parsedIntent, safeMessage);
}
