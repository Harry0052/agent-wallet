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
    '- send_money',
    '- compare_and_buy',
    '- signup_and_prepare_checkout',
    '- procurement_task',
    '- fund_wallet',
    '- review_spend',
    '- cancel_subscription',
    '',
    'Rules:',
    '- Never fabricate recipient accounts, vendor pricing, completion state, or balances.',
    '- send_money means paying another person/recipient (not wallet top-up).',
    '- fund_wallet means adding money to the user wallet.',
    '- procurement_task is buying/comparing products/services/subscriptions.',
    '- compare_and_buy is explicit compare/rank/pick-best then buy intent.',
    '- signup_and_prepare_checkout is explicit sign-up/form-fill/checkout-prep intent.',
    '- cancel_subscription is cancelling/downgrading an existing SaaS subscription.',
    '- review_spend is balance/history/budget/spend review.',
    '- If message contains a Stripe connected account id, place it in recipient_stripe_account_id.',
    '- required_profile_fields should include only fields needed to continue sign-up/checkout prep.',
    '- profile_updates should include any profile fields explicitly provided by the user message.',
    '- If context indicates pending clarification, interpret the message as clarification for that pending task.',
    '- missing_fields must include actionable blockers (amount, recipient_name, recipient_account, merchant, etc.).',
    '- currency must be USD.',
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
