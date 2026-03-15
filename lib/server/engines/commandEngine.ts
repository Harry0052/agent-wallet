import 'server-only';

import { callClaudeMessagesApi } from '@/lib/server/claude';
import { recordEngineMetric } from '@/lib/server/engines/engineMetrics';
import { logServerEvent } from '@/lib/server/observability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandIntent =
  | 'query_spending'
  | 'query_subscription'
  | 'query_cashflow'
  | 'query_health'
  | 'affordability_check'
  | 'action_cancel_subscription'
  | 'action_move_money'
  | 'action_set_budget'
  | 'general_overview';

export interface ParsedCommand {
  intent: CommandIntent;
  entities: string[];
  amount: number | null;
  merchant: string | null;
  category: string | null;
  timeframe: { start?: string; end?: string; label?: string } | null;
  confidence: number;
  needsConfirmation: boolean;
}

// ---------------------------------------------------------------------------
// Keyword Router (Tier 1 — handles ~70 % of queries)
// ---------------------------------------------------------------------------

interface KeywordRule {
  keywords: RegExp[];
  intent: CommandIntent;
  /** Additional patterns that refine entity extraction */
  entityPatterns?: RegExp[];
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    keywords: [/cancel\b/i],
    intent: 'action_cancel_subscription',
    entityPatterns: [/cancel\s+(?:my\s+)?(.+)/i],
  },
  {
    keywords: [/\b(?:move|transfer|save)\b/i, /\$?\d+/],
    intent: 'action_move_money',
    entityPatterns: [/(?:move|transfer|save)\s+\$?(\d[\d,.]*)/i],
  },
  {
    keywords: [/\b(?:budget|set\s+budget|limit)\b/i],
    intent: 'action_set_budget',
    entityPatterns: [/budget.*?(\d[\d,.]*)/i],
  },
  {
    keywords: [/\b(?:how\s+much|spent|spending)\b/i],
    intent: 'query_spending',
  },
  {
    keywords: [/\b(?:subscription|recurring|bills?)\b/i],
    intent: 'query_subscription',
  },
  {
    keywords: [/\b(?:cash\s*flow|balance|safe\s+to\s+spend)\b/i],
    intent: 'query_cashflow',
  },
  {
    keywords: [/\b(?:afford|can\s+i\s+buy)\b/i],
    intent: 'affordability_check',
  },
  {
    keywords: [/\b(?:health|score|financial\s+health)\b/i],
    intent: 'query_health',
  },
];

const ACTION_INTENTS = new Set<CommandIntent>([
  'action_cancel_subscription',
  'action_move_money',
  'action_set_budget',
]);

const AMOUNT_PATTERN = /\$?([\d,]+(?:\.\d{1,2})?)/;
const MERCHANT_PATTERN =
  /(?:at|from|for|on|with|cancel(?:\s+my)?)\s+([A-Z][\w\s&'-]+)/i;
const CATEGORY_PATTERN =
  /(?:on|for|in)\s+(food|groceries|dining|entertainment|travel|gas|shopping|utilities|clothing|health)/i;
const TIMEFRAME_LABELS: Record<string, { label: string }> = {
  'this month': { label: 'this_month' },
  'last month': { label: 'last_month' },
  'this week': { label: 'this_week' },
  'last week': { label: 'last_week' },
  today: { label: 'today' },
  yesterday: { label: 'yesterday' },
  'this year': { label: 'this_year' },
  'last year': { label: 'last_year' },
};

function extractAmount(input: string): number | null {
  const match = input.match(AMOUNT_PATTERN);
  if (!match) return null;
  const parsed = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMerchant(input: string): string | null {
  const match = input.match(MERCHANT_PATTERN);
  return match ? match[1].trim() : null;
}

function extractCategory(input: string): string | null {
  const match = input.match(CATEGORY_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

function extractTimeframe(
  input: string,
): ParsedCommand['timeframe'] {
  const lower = input.toLowerCase();
  for (const [phrase, meta] of Object.entries(TIMEFRAME_LABELS)) {
    if (lower.includes(phrase)) {
      return { label: meta.label };
    }
  }
  return null;
}

function extractEntities(input: string, rule: KeywordRule): string[] {
  const entities: string[] = [];
  if (rule.entityPatterns) {
    for (const pattern of rule.entityPatterns) {
      const match = input.match(pattern);
      if (match?.[1]) entities.push(match[1].trim());
    }
  }
  return entities;
}

function keywordRoute(input: string): ParsedCommand | null {
  const lower = input.toLowerCase();

  for (const rule of KEYWORD_RULES) {
    const allMatch = rule.keywords.every((kw) => kw.test(lower));
    if (!allMatch) continue;

    const intent = rule.intent;
    const entities = extractEntities(input, rule);

    return {
      intent,
      entities,
      amount: extractAmount(input),
      merchant: extractMerchant(input),
      category: extractCategory(input),
      timeframe: extractTimeframe(input),
      confidence: 0.85,
      needsConfirmation: ACTION_INTENTS.has(intent),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// LLM Fallback (Tier 2 — when keyword confidence < 0.7)
// ---------------------------------------------------------------------------

const LLM_SYSTEM_PROMPT = [
  'You are a financial command parser for Calico, a personal finance app.',
  'Parse the user message into a structured command. Respond ONLY with valid JSON matching this schema:',
  '{',
  '  "intent": one of "query_spending","query_subscription","query_cashflow","query_health","affordability_check","action_cancel_subscription","action_move_money","action_set_budget","general_overview",',
  '  "entities": string[],',
  '  "amount": number | null,',
  '  "merchant": string | null,',
  '  "category": string | null,',
  '  "timeframe": { "start"?: string, "end"?: string, "label"?: string } | null,',
  '  "confidence": number between 0 and 1',
  '}',
  'Do not include any text outside the JSON object.',
].join('\n');

async function llmParse(input: string): Promise<ParsedCommand> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logServerEvent('error', 'engine.command.llm.no_api_key', {});
    return buildFallbackOverview(input);
  }

  const { raw } = await callClaudeMessagesApi({
    apiKey,
    operation: 'command_parse',
    maxTokens: 512,
    temperature: 0,
    messages: [
      { role: 'user', content: `${LLM_SYSTEM_PROMPT}\n\nUser message: ${input}` },
    ],
  });

  try {
    const outer = JSON.parse(raw);
    const text: string =
      outer?.content?.[0]?.text ?? outer?.content?.[0]?.value ?? raw;
    const parsed = JSON.parse(text);

    const intent: CommandIntent =
      typeof parsed.intent === 'string' &&
      isValidIntent(parsed.intent)
        ? (parsed.intent as CommandIntent)
        : 'general_overview';

    return {
      intent,
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      amount: typeof parsed.amount === 'number' ? parsed.amount : null,
      merchant: typeof parsed.merchant === 'string' ? parsed.merchant : null,
      category: typeof parsed.category === 'string' ? parsed.category : null,
      timeframe: parsed.timeframe ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.6,
      needsConfirmation: ACTION_INTENTS.has(intent),
    };
  } catch {
    logServerEvent('warn', 'engine.command.llm.parse_failed', { raw: raw.slice(0, 300) });
    return buildFallbackOverview(input);
  }
}

const VALID_INTENTS = new Set<string>([
  'query_spending',
  'query_subscription',
  'query_cashflow',
  'query_health',
  'affordability_check',
  'action_cancel_subscription',
  'action_move_money',
  'action_set_budget',
  'general_overview',
]);

function isValidIntent(value: string): boolean {
  return VALID_INTENTS.has(value);
}

function buildFallbackOverview(input: string): ParsedCommand {
  return {
    intent: 'general_overview',
    entities: [],
    amount: extractAmount(input),
    merchant: extractMerchant(input),
    category: extractCategory(input),
    timeframe: extractTimeframe(input),
    confidence: 0.4,
    needsConfirmation: false,
  };
}

// ---------------------------------------------------------------------------
// Dispatch — query intents call the appropriate engine
// ---------------------------------------------------------------------------

async function dispatchQueryIntent(
  userId: string,
  parsed: ParsedCommand,
): Promise<unknown> {
  switch (parsed.intent) {
    case 'query_spending': {
      const { analyzeSpending } = await import(
        '@/ai_spend_intelligence/spendAnalyzer'
      );
      const { listNormalizedTransactions } = await import(
        '@/transactions/transactionRepository'
      );
      const { buildSafeSpendingDataset } = await import(
        '@/security/aiSanitizer'
      );
      const transactions = await listNormalizedTransactions({ userId, limit: 500 });
      const safe = buildSafeSpendingDataset(
        transactions.map((tx) => ({
          merchant_name: tx.merchant_name,
          normalized_merchant: tx.normalized_merchant,
          amount: tx.amount,
          category: tx.category,
          pending: tx.pending,
          occurred_at: tx.occurred_at,
        })),
      );
      return analyzeSpending(safe.normalizedTransactions, { topMerchantLimit: 10 });
    }

    case 'query_subscription': {
      const { listSubscriptions } = await import(
        '@/subscription_intelligence/subscriptionService'
      );
      return listSubscriptions({ userId });
    }

    case 'query_cashflow': {
      try {
        const { predictCashFlow } = await import(
          '@/lib/server/engines/cashFlowEngine'
        );
        return predictCashFlow(userId);
      } catch {
        return { status: 'unavailable', reason: 'Cash flow engine not yet available' };
      }
    }

    case 'query_health': {
      try {
        const { computeHealthScore } = await import(
          '@/lib/server/engines/healthScoreEngine'
        );
        return computeHealthScore(userId);
      } catch {
        return { status: 'unavailable', reason: 'Health score engine not yet available' };
      }
    }

    case 'affordability_check': {
      try {
        const { predictCashFlow } = await import(
          '@/lib/server/engines/cashFlowEngine'
        );
        const cashflow = await predictCashFlow(userId);
        return {
          canAfford: parsed.amount != null
            ? (cashflow?.data?.safeToSpendToday ?? 0) >= parsed.amount
            : null,
          safeToSpendToday: cashflow?.data?.safeToSpendToday ?? null,
          requestedAmount: parsed.amount,
        };
      } catch {
        return { status: 'unavailable', reason: 'Cash flow engine not yet available' };
      }
    }

    case 'general_overview': {
      const { buildSmartHomePayload } = await import('@/lib/server/smartHome');
      const home = await buildSmartHomePayload(userId);
      return {
        summary: home.summary,
        insightCards: home.insightCards.map((c) => ({
          id: c.id,
          title: c.title,
          summary: c.summary,
        })),
        quickIntents: home.quickIntents,
      };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Dispatch — action intents create pending tasks (NEVER execute directly)
// ---------------------------------------------------------------------------

async function dispatchActionIntent(
  userId: string,
  parsed: ParsedCommand,
): Promise<unknown> {
  try {
    const { generateTasks } = await import('@/lib/server/engines/taskEngine');
    const task = await generateTasks(userId);
    return { pendingTask: task, needsConfirmation: true };
  } catch {
    return {
      pendingTask: {
        intent: parsed.intent,
        merchant: parsed.merchant,
        amount: parsed.amount,
        status: 'pending',
        message: 'Task engine not yet available. Action recorded for manual review.',
      },
      needsConfirmation: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function processCommand(
  userId: string,
  input: string,
): Promise<{ parsed: ParsedCommand; result: unknown }> {
  const startMs = Date.now();
  let parseSource: 'keyword' | 'llm' = 'keyword';

  // Tier 1: keyword routing
  let parsed = keywordRoute(input);

  // Tier 2: LLM fallback when keyword router did not match
  if (!parsed) {
    parseSource = 'llm';
    parsed = await llmParse(input);
  }

  recordEngineMetric({
    engine: 'command',
    event: parseSource === 'keyword' ? 'parse.success' : 'parse.fallback',
    userId,
    latencyMs: Date.now() - startMs,
  });

  // Dispatch
  const isAction = ACTION_INTENTS.has(parsed.intent);
  const result = isAction
    ? await dispatchActionIntent(userId, parsed)
    : await dispatchQueryIntent(userId, parsed);

  recordEngineMetric({
    engine: 'command',
    event: 'dispatch',
    userId,
    latencyMs: Date.now() - startMs,
  });

  return { parsed, result };
}
