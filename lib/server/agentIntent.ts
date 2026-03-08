import { z } from 'zod';

const AgentIntentSchema = z.object({
  intent: z.enum([
    'send_money',
    'procurement_task',
    'fund_wallet',
    'review_spend',
    'cancel_subscription',
  ]),
  amount: z.number().nonnegative().nullable(),
  currency: z.literal('USD'),
  recipient_name: z.string().trim().min(1).nullable(),
  merchant: z.string().trim().min(1).nullable(),
  description: z.string().trim().min(1),
  budget_limit: z.number().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
  missing_fields: z.array(z.string().trim().min(1)).max(8),
});

export type AgentIntent = z.infer<typeof AgentIntentSchema>;

function responseJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: {
        type: 'string',
        enum: [
          'send_money',
          'procurement_task',
          'fund_wallet',
          'review_spend',
          'cancel_subscription',
        ],
      },
      amount: { type: ['number', 'null'] },
      currency: { type: 'string', enum: ['USD'] },
      recipient_name: { type: ['string', 'null'] },
      merchant: { type: ['string', 'null'] },
      description: { type: 'string' },
      budget_limit: { type: ['number', 'null'] },
      confidence: { type: 'number' },
      missing_fields: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: [
      'intent',
      'amount',
      'currency',
      'recipient_name',
      'merchant',
      'description',
      'budget_limit',
      'confidence',
      'missing_fields',
    ],
  };
}

function parserPrompt(message: string): string {
  return [
    'You are the intent parser for Agent Wallet.',
    'Output valid JSON only.',
    'Classify user intent and extract parameters.',
    'Rules:',
    '- Never fabricate recipient accounts, vendor pricing, or completion state.',
    '- `missing_fields` must contain required execution blockers.',
    '- For send_money, include missing_fields when amount, recipient_name, or recipient_account context is missing.',
    '- For procurement_task, map budget constraints to budget_limit when present.',
    '- For cancel_subscription, extract merchant/service name when present.',
    '- description should be concise and execution-ready.',
    `User message: ${message}`,
  ].join('\n');
}

export async function parseAgentIntent(message: string): Promise<AgentIntent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const completion = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'agent_wallet_intent',
          strict: true,
          schema: responseJsonSchema(),
        },
      },
      messages: [
        {
          role: 'system',
          content: 'You parse user intent for a fintech agent and return strict JSON.',
        },
        {
          role: 'user',
          content: parserPrompt(message),
        },
      ],
    }),
    cache: 'no-store',
  });

  const raw = await completion.text();
  if (!completion.ok) {
    throw new Error(`OpenAI intent parsing failed (${completion.status}): ${raw.slice(0, 280)}`);
  }

  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
  } catch {
    throw new Error('OpenAI returned a non-JSON payload for intent parsing');
  }

  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned empty intent payload');
  }

  let parsedIntent: unknown;
  try {
    parsedIntent = JSON.parse(content);
  } catch {
    throw new Error('OpenAI intent payload was not valid JSON');
  }

  return AgentIntentSchema.parse(parsedIntent);
}
