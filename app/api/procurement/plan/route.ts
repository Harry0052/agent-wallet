import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { ProcurementPlan } from '@/lib/types';
import { getWalletUserId } from '@/lib/server/ledger';
import { createProcurementTask, updateProcurementTask } from '@/lib/server/procurement';
import { apiError, classifyTaskError, logServerEvent, type TaskErrorCode } from '@/lib/server/observability';
import { callClaudeMessagesApi } from '@/lib/server/claude';

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
  targetVendorCandidates: z.array(z.string().trim().min(1)).max(25),
  budgetConstraint: z.object({
    amount: z.number().nonnegative().nullable(),
    currency: z.literal('USD'),
    period: z.enum(['monthly', 'yearly', 'one_time', 'unknown']),
    rawText: z.string().optional(),
  }),
  mustHaveFeatures: z.array(z.string().trim().min(1)).max(25),
  comparisonCriteria: z.array(z.string().trim().min(1)).max(25),
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
    '- Claude is for reasoning only; do not fabricate vendor prices, discounts, plan facts, feature claims, or availability facts.',
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return Array.from(new Set(items)).slice(0, max);
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function normalizeBudgetPeriod(value: unknown): 'monthly' | 'yearly' | 'one_time' | 'unknown' {
  if (typeof value !== 'string') return 'unknown';
  if (value === 'monthly' || value === 'yearly' || value === 'one_time' || value === 'unknown') {
    return value;
  }
  return 'unknown';
}

function normalizeProcurementPlan(rawPlan: unknown, userMessage: string): ProcurementPlan {
  const raw = asRecord(rawPlan);
  const budgetRaw = asRecord(raw.budgetConstraint);
  const followUpQuestions = toStringArray(raw.followUpQuestions, 3);
  const clarificationNeeded = typeof raw.clarificationNeeded === 'boolean'
    ? raw.clarificationNeeded
    : followUpQuestions.length > 0;

  return {
    normalizedGoal: typeof raw.normalizedGoal === 'string' && raw.normalizedGoal.trim().length > 0
      ? raw.normalizedGoal.trim()
      : userMessage,
    category: typeof raw.category === 'string' && raw.category.trim().length > 0
      ? raw.category.trim()
      : 'general',
    targetVendorCandidates: toStringArray(raw.targetVendorCandidates, 25),
    budgetConstraint: {
      amount: toNumberOrNull(budgetRaw.amount),
      currency: 'USD',
      period: normalizeBudgetPeriod(budgetRaw.period),
      rawText: typeof budgetRaw.rawText === 'string' ? budgetRaw.rawText : '',
    },
    mustHaveFeatures: toStringArray(raw.mustHaveFeatures, 25),
    comparisonCriteria: toStringArray(raw.comparisonCriteria, 25),
    clarificationNeeded,
    followUpQuestions: clarificationNeeded
      ? (followUpQuestions.length > 0 ? followUpQuestions : ['What are your must-have features and deal-breakers?'])
      : followUpQuestions,
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

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error('CLAUDE_API_KEY is not configured (set ANTHROPIC_API_KEY or CLAUDE_API_KEY)');
    }

    const { raw: completionText } = await callClaudeMessagesApi({
      apiKey,
      operation: 'planning request',
      maxTokens: 1200,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            'You are a procurement reasoning planner that outputs only valid JSON matching this schema:',
            JSON.stringify(responseJsonSchema()),
            planningPrompt(userMessage, input.wallet),
          ].join('\n'),
        },
      ],
    });

    let parsedCompletion: { content?: Array<{ type?: string; text?: string }> };
    try {
      parsedCompletion = JSON.parse(completionText) as { content?: Array<{ type?: string; text?: string }> };
    } catch {
      throw new Error('Claude returned a non-JSON payload for procurement planning');
    }

    const content = parsedCompletion.content
      ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text as string)
      .join('\n')
      .trim();
    if (!content) {
      throw new Error('Claude returned empty procurement planning content');
    }

    let rawPlan: unknown;
    try {
      const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const jsonText = fenced?.[1]?.trim() || content;
      rawPlan = JSON.parse(jsonText);
    } catch {
      throw new Error('Claude planning content was not valid JSON');
    }

    const plan = PlanSchema.parse(normalizeProcurementPlan(rawPlan, userMessage));
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
        || message.includes('Claude')
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
