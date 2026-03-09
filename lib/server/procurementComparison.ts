import { z } from 'zod';
import type { ProcurementFinding, ProcurementTaskRecord } from '@/lib/types';
import { callClaudeMessagesApi } from '@/lib/server/claude';

const EvaluationSchema = z.object({
  winnerFindingId: z.string().trim().min(1).nullable(),
  alternativeFindingIds: z.array(z.string().trim().min(1)).max(15),
  winnerReasons: z.array(z.string().trim().min(1)).max(15),
  budgetAssessment: z.enum(['fits_budget', 'mixed', 'over_budget', 'unknown']),
  confidence: z.number().min(0).max(1),
  exceptions: z.array(z.string().trim().min(1)).max(15).default([]),
  noFitExplanation: z.string().trim().optional(),
});

export type ProcurementEvaluation = z.infer<typeof EvaluationSchema>;

function responseJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      winnerFindingId: { type: ['string', 'null'] },
      alternativeFindingIds: {
        type: 'array',
        items: { type: 'string' },
      },
      winnerReasons: {
        type: 'array',
        items: { type: 'string' },
      },
      budgetAssessment: {
        type: 'string',
        enum: ['fits_budget', 'mixed', 'over_budget', 'unknown'],
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      exceptions: {
        type: 'array',
        items: { type: 'string' },
      },
      noFitExplanation: { type: 'string' },
    },
    required: ['winnerFindingId', 'alternativeFindingIds', 'winnerReasons', 'budgetAssessment', 'confidence', 'exceptions'],
  };
}

function normalizedFindingPayload(findings: ProcurementFinding[]): Array<Record<string, unknown>> {
  return findings.map((finding) => ({
    findingId: finding.id,
    vendorName: finding.vendorName,
    planName: finding.planName,
    monthlyPrice: finding.monthlyPrice,
    annualPrice: finding.annualPrice,
    billingFrequency: finding.billingFrequency,
    notableFeatures: finding.notableFeatures,
    pricingPageUrl: finding.pricingPageUrl,
    extractionTimestamp: finding.extractionTimestamp,
  }));
}

function evaluationPrompt(task: ProcurementTaskRecord, findings: ProcurementFinding[]): string {
  const payload = normalizedFindingPayload(findings);

  return [
    'You are the procurement comparison engine for Agent Wallet.',
    'You must rank only the candidate findings provided below.',
    'Hard rules:',
    '- Do not invent vendor facts, pricing, plans, or features.',
    '- Use only the findingId values that exist in the provided findings list.',
    '- Rank by budget constraint, must-have features, billing structure, and category fit.',
    '- If no option fits budget, set winnerFindingId to null and explain in noFitExplanation.',
    '- winnerReasons must be concise and tied to provided finding data.',
    '- confidence must reflect evidence quality and completeness of findings.',
    '- exceptions should list caveats (missing availability, missing monthly price, blocked/failed vendors).',
    `Task goal: ${task.goal}`,
    `Category: ${task.category || task.planningOutput.category || 'unknown'}`,
    `Budget amount: ${task.budgetLimit === null ? 'not specified' : task.budgetLimit}`,
    `Must-have features: ${JSON.stringify(task.mustHaveFeatures)}`,
    `Comparison criteria: ${JSON.stringify(task.comparisonCriteria)}`,
    `Candidate findings: ${JSON.stringify(payload)}`,
  ].join('\n');
}

function normalizeSelection(
  evaluation: ProcurementEvaluation,
  findings: ProcurementFinding[],
): ProcurementEvaluation {
  const findingIds = new Set(findings.map((finding) => finding.id));

  const winner = evaluation.winnerFindingId && findingIds.has(evaluation.winnerFindingId)
    ? evaluation.winnerFindingId
    : null;

  const alternativeFindingIds = evaluation.alternativeFindingIds
    .filter((id) => findingIds.has(id) && id !== winner)
    .slice(0, 10);

  return {
    ...evaluation,
    winnerFindingId: winner,
    alternativeFindingIds,
  };
}

export async function evaluateProcurementFindings(params: {
  task: ProcurementTaskRecord;
  findings: ProcurementFinding[];
}): Promise<ProcurementEvaluation> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY is not configured (set ANTHROPIC_API_KEY or CLAUDE_API_KEY)');
  }

  if (params.findings.length === 0) {
    throw new Error('No findings available for comparison');
  }

  const { raw: completionText } = await callClaudeMessagesApi({
    apiKey,
    operation: 'comparison request',
    maxTokens: 1200,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          'You are a procurement evaluator that outputs only valid JSON matching this JSON schema.',
          JSON.stringify(responseJsonSchema()),
          '',
          evaluationPrompt(params.task, params.findings),
        ].join('\n'),
      },
    ],
  });

  let parsedCompletion: { content?: Array<{ type?: string; text?: string }> };
  try {
    parsedCompletion = JSON.parse(completionText) as { content?: Array<{ type?: string; text?: string }> };
  } catch {
    throw new Error('Claude returned non-JSON payload envelope for procurement comparison');
  }

  const content = parsedCompletion.content
    ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n')
    .trim();
  if (!content) {
    throw new Error('Claude returned empty procurement comparison content');
  }

  let rawEvaluation: unknown;
  try {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced?.[1]?.trim() || content;
    rawEvaluation = JSON.parse(jsonText);
  } catch {
    throw new Error('Claude procurement comparison content was not valid JSON');
  }

  const parsed = EvaluationSchema.parse(rawEvaluation);
  return normalizeSelection(parsed, params.findings);
}
