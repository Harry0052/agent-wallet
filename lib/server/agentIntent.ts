import { z } from 'zod';

const AgentIntentSchema = z.object({
  intent: z.enum([
    'send_money',
    'compare_and_buy',
    'signup_and_prepare_checkout',
    'procurement_task',
    'fund_wallet',
    'review_spend',
    'cancel_subscription',
  ]),
  amount: z.number().nonnegative().nullable(),
  currency: z.literal('USD'),
  recipient_name: z.string().trim().min(1).nullable(),
  recipient_stripe_account_id: z.string().trim().regex(/^acct_[A-Za-z0-9]+$/).nullable().optional(),
  merchant: z.string().trim().min(1).nullable(),
  description: z.string().trim().min(1),
  budget_limit: z.number().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
  missing_fields: z.array(z.string().trim().min(1)).max(8),
  required_profile_fields: z.array(z.enum([
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
  ])).max(12).default([]),
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
    '- fund_wallet: add/deposit money to the user wallet',
    '- review_spend: balance/history/budget/spend review',
    '- cancel_subscription: cancel/downgrade an existing SaaS subscription',
    '',
    'Intent routing rules:',
    '- "send liz five dollars", "pay my fiancee a dollar", "transfer 10 to bob" → send_money',
    '- "add $25", "top up my wallet", "fund my account" → fund_wallet',
    '- "buy notion under 15/mo", "find me a CRM" → procurement_task',
    '- "find a streaming service with Top Gun Maverick" → compare_and_buy',
    '- "sign up for Notion Pro" → signup_and_prepare_checkout',
    '- "cancel my grammarly subscription" → cancel_subscription',
    '- "what did I spend today", "balance" → review_spend',
    '',
    'Entity extraction rules:',
    '- For send_money: extract the person/nickname/relationship as recipient_name exactly as stated.',
    '  "pay my fiancee" → recipient_name: "my fiancee"',
    '  "send liz five" → recipient_name: "liz"',
    '  Natural language amounts: "a dollar" → 1, "five" → 5, "twenty" → 20, "a hundred" → 100.',
    '- For procurement_task: extract budget from "under $X/mo" or similar as budget_limit.',
    '  merchant = the specific product/service name if mentioned.',
    '- Never fabricate recipient accounts, vendor pricing, completion state, or balances.',
    '- If message contains a Stripe connected account id (acct_...), place it in recipient_stripe_account_id.',
    '- required_profile_fields should include only fields needed to continue sign-up/checkout prep.',
    '- profile_updates should include any profile fields explicitly provided by the user message.',
    '- If context indicates pending clarification, interpret the message as clarification for that pending task.',
    '- missing_fields must include actionable blockers (amount, recipient_name, recipient_account, merchant).',
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

export async function parseAgentIntent(
  message: string,
  options?: { context?: string },
): Promise<AgentIntent> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY is not configured (set ANTHROPIC_API_KEY or CLAUDE_API_KEY)');
  }

  const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest';
  const completion = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: parserPrompt(message, options?.context),
        },
      ],
    }),
    cache: 'no-store',
  });

  const raw = await completion.text();
  if (!completion.ok) {
    throw new Error(`Claude intent parsing failed (${completion.status}): ${raw.slice(0, 280)}`);
  }

  let parsedResponse: { content?: Array<{ type?: string; text?: string }> };
  try {
    parsedResponse = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
  } catch {
    throw new Error('Claude returned a non-JSON response envelope');
  }

  const text = parsedResponse.content
    ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Claude returned empty intent payload');
  }

  let parsedIntent: unknown;
  try {
    parsedIntent = JSON.parse(extractJsonText(text));
  } catch {
    throw new Error('Claude intent payload was not valid JSON');
  }

  return AgentIntentSchema.parse(parsedIntent);
}
