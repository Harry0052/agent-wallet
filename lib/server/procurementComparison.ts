import { z } from 'zod';
import type { ProcurementFinding, ProcurementTaskRecord } from '@/lib/types';

const EvaluationSchema = z.object({
  winnerFindingId: z.string().trim().min(1).nullable(),
  alternativeFindingIds: z.array(z.string().trim().min(1)).max(3),
  winnerReasons: z.array(z.string().trim().min(1)).max(5),
  budgetAssessment: z.enum(['fits_budget', 'mixed', 'over_budget', 'unknown']),
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
      noFitExplanation: { type: 'string' },
    },
    required: ['winnerFindingId', 'alternativeFindingIds', 'winnerReasons', 'budgetAssessment'],
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
    .slice(0, 3);

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  if (params.findings.length === 0) {
    throw new Error('No findings available for comparison');
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
          name: 'procurement_comparison_output',
          strict: true,
          schema: responseJsonSchema(),
        },
      },
      messages: [
        {
          role: 'system',
          content: 'You are a procurement evaluator that outputs only valid JSON matching the schema.',
        },
        {
          role: 'user',
          content: evaluationPrompt(params.task, params.findings),
        },
      ],
    }),
    cache: 'no-store',
  });

  const completionText = await completion.text();
  if (!completion.ok) {
    throw new Error(`OpenAI comparison request failed (${completion.status}): ${completionText.slice(0, 280)}`);
  }

  let parsedCompletion: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsedCompletion = JSON.parse(completionText) as { choices?: Array<{ message?: { content?: string } }> };
  } catch {
    throw new Error('OpenAI returned non-JSON payload for procurement comparison');
  }

  const content = parsedCompletion.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned empty procurement comparison content');
  }

  let rawEvaluation: unknown;
  try {
    rawEvaluation = JSON.parse(content);
  } catch {
    throw new Error('OpenAI procurement comparison content was not valid JSON');
  }

  const parsed = EvaluationSchema.parse(rawEvaluation);
  return normalizeSelection(parsed, params.findings);
}
