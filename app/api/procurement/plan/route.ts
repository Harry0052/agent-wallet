import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { ProcurementPlan } from '@/lib/types';
import { getWalletUserId } from '@/lib/server/ledger';
import { createProcurementTask, updateProcurementTask } from '@/lib/server/procurement';
import { apiError, classifyTaskError, logServerEvent, type TaskErrorCode } from '@/lib/server/observability';

export const runtime = 'nodejs';

const WalletInputSchema = z.object({
  balance: z.number().optional(),
  settings: z.object({
    maxTransaction: z.number().optional(),
    dailyLimit: z.number().optional(),
    monthlyBudget: z.number().optional(),
    approvalThreshold: z.number().optional(),
    allowedMerchants: z.array(z.string()).optional(),
    blockedMerchants: z.array(z.string()).optional(),
  }).optional(),
}).optional();

const RequestSchema = z.object({
  userMessage: z.string().trim().min(1, 'userMessage is required'),
  wallet: WalletInputSchema,
});

const PlanSchema = z.object({
  normalizedGoal: z.string().trim().min(1),
  category: z.string().trim().min(1),
  targetVendorCandidates: z.array(z.string().trim().min(1)).max(12),
  budgetConstraint: z.object({
    amount: z.number().nonnegative().nullable(),
    currency: z.literal('USD'),
    period: z.enum(['monthly', 'yearly', 'one_time', 'unknown']),
    rawText: z.string().optional(),
  }),
  mustHaveFeatures: z.array(z.string().trim().min(1)).max(12),
  comparisonCriteria: z.array(z.string().trim().min(1)).max(12),
  clarificationNeeded: z.boolean(),
  followUpQuestions: z.array(z.string().trim().min(1)).max(3),
}).superRefine((value, ctx) => {
  if (value.clarificationNeeded && value.followUpQuestions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'followUpQuestions is required when clarificationNeeded is true',
      path: ['followUpQuestions'],
    });
  }
});

function emptyPlan(goal: string): ProcurementPlan {
  return {
    normalizedGoal: goal,
    category: 'general',
    targetVendorCandidates: [],
    budgetConstraint: {
      amount: null,
      currency: 'USD',
      period: 'unknown',
      rawText: '',
    },
    mustHaveFeatures: [],
    comparisonCriteria: [],
    clarificationNeeded: true,
    followUpQuestions: [],
  };
}

function planningPrompt(userMessage: string, wallet?: z.infer<typeof WalletInputSchema>): string {
  const constraints = {
    balance: wallet?.balance ?? 0,
    maxTransaction: wallet?.settings?.maxTransaction ?? null,
    dailyLimit: wallet?.settings?.dailyLimit ?? null,
    monthlyBudget: wallet?.settings?.monthlyBudget ?? null,
    approvalThreshold: wallet?.settings?.approvalThreshold ?? null,
    allowedMerchants: wallet?.settings?.allowedMerchants ?? [],
    blockedMerchants: wallet?.settings?.blockedMerchants ?? [],
  };

  return [
    'You are the procurement planning layer for Agent Wallet.',
    'Return structured planning JSON only.',
    'Rules:',
    '- OpenAI is for reasoning only; do not fabricate vendor prices, discounts, plan facts, feature claims, or availability facts.',
    '- You may suggest vendor candidates by name, but do not include any price facts or assertions about those vendors.',
    '- Normalize the user goal and extract budget constraints if clearly stated.',
    '- If key inputs are missing, set clarificationNeeded=true and provide concise follow-up questions.',
    '- Keep comparisonCriteria and mustHaveFeatures concise and decision-ready.',
    `Wallet constraints context: ${JSON.stringify(constraints)}`,
    `User request: ${userMessage}`,
  ].join('\n');
}

function responseJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      normalizedGoal: { type: 'string' },
      category: { type: 'string' },
      targetVendorCandidates: {
        type: 'array',
        items: { type: 'string' },
      },
      budgetConstraint: {
        type: 'object',
        additionalProperties: false,
        properties: {
          amount: { type: ['number', 'null'] },
          currency: { type: 'string', enum: ['USD'] },
          period: { type: 'string', enum: ['monthly', 'yearly', 'one_time', 'unknown'] },
          rawText: { type: 'string' },
        },
        required: ['amount', 'currency', 'period', 'rawText'],
      },
      mustHaveFeatures: {
        type: 'array',
        items: { type: 'string' },
      },
      comparisonCriteria: {
        type: 'array',
        items: { type: 'string' },
      },
      clarificationNeeded: { type: 'boolean' },
      followUpQuestions: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: [
      'normalizedGoal',
      'category',
      'targetVendorCandidates',
      'budgetConstraint',
      'mustHaveFeatures',
      'comparisonCriteria',
      'clarificationNeeded',
      'followUpQuestions',
    ],
  };
}

export async function POST(req: NextRequest) {
  let taskId: string | undefined;
  let requestedGoal = '';

  try {
    const input = RequestSchema.parse(await req.json());
    const userId = getWalletUserId();
    const userMessage = input.userMessage;
    requestedGoal = userMessage;

    logServerEvent('info', 'procurement.plan.started', {
      userId,
      goalPreview: userMessage.slice(0, 120),
    });

    taskId = await createProcurementTask({
      userId,
      goal: userMessage,
      taskType: 'procurement_plan',
      planningOutputSeed: {
        request: userMessage,
        state: 'planning',
      },
    });

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
        temperature: 0.1,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'procurement_planning_output',
            strict: true,
            schema: responseJsonSchema(),
          },
        },
        messages: [
          {
            role: 'system',
            content: 'You are a procurement reasoning planner that outputs only valid JSON matching the given schema.',
          },
          {
            role: 'user',
            content: planningPrompt(userMessage, input.wallet),
          },
        ],
      }),
      cache: 'no-store',
    });

    const completionText = await completion.text();
    if (!completion.ok) {
      throw new Error(`OpenAI planning request failed (${completion.status}): ${completionText.slice(0, 280)}`);
    }

    let parsedCompletion: { choices?: Array<{ message?: { content?: string } }> };
    try {
      parsedCompletion = JSON.parse(completionText) as { choices?: Array<{ message?: { content?: string } }> };
    } catch {
      throw new Error('OpenAI returned a non-JSON payload for procurement planning');
    }

    const content = parsedCompletion.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned empty procurement planning content');
    }

    let rawPlan: unknown;
    try {
      rawPlan = JSON.parse(content);
    } catch {
      throw new Error('OpenAI planning content was not valid JSON');
    }

    const plan = PlanSchema.parse(rawPlan);
    const status: 'planned' | 'needs_clarification' = plan.clarificationNeeded ? 'needs_clarification' : 'planned';

    const task = await updateProcurementTask({
      taskId,
      userId,
      status,
      goal: plan.normalizedGoal,
      budgetLimit: plan.budgetConstraint.amount,
      category: plan.category,
      targetVendors: plan.targetVendorCandidates,
      comparisonCriteria: plan.comparisonCriteria,
      mustHaveFeatures: plan.mustHaveFeatures,
      findings: null,
      recommendation: null,
      planningOutput: plan,
    });

    return NextResponse.json({
      ok: true,
      task,
      planning: task.planningOutput,
    });
  } catch (error) {
    let errorCode: TaskErrorCode = 'UNKNOWN_FAILURE';
    if (taskId) {
      try {
        const userId = getWalletUserId();
        const fallbackGoal = requestedGoal || (error instanceof Error ? error.message : 'planning failed');

        await updateProcurementTask({
          taskId,
          userId,
          status: 'failed',
          goal: fallbackGoal,
          budgetLimit: null,
          category: null,
          targetVendors: [],
          comparisonCriteria: [],
          mustHaveFeatures: [],
          findings: null,
          recommendation: null,
          planningOutput: emptyPlan(fallbackGoal),
          error: error instanceof Error ? error.message : 'Procurement planning failed',
        });
      } catch (persistError) {
        logServerEvent('error', 'procurement.plan.persist_failure', {
          taskId,
          error: persistError instanceof Error ? persistError.message : String(persistError),
        });
      }
    }

    const message = error instanceof z.ZodError
      ? `Procurement planning validation failed: ${error.issues.map((issue) => issue.message).join('; ')}`
      : error instanceof Error
        ? error.message
        : 'Procurement planning failed';

    const status = error instanceof z.ZodError
      ? (taskId ? 502 : 400)
      : message.includes('OpenAI')
        ? 502
        : 500;

    errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'procurement.plan.failed', {
      taskId,
      status,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
