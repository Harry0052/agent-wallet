import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId, recordWebAction } from '@/lib/server/ledger';
import { evaluateProcurementFindings } from '@/lib/server/procurementComparison';
import { evaluateSpendPolicy } from '@/lib/server/procurementPolicy';
import {
  getProcurementTask,
  listProcurementFindings,
  updateProcurementTask,
} from '@/lib/server/procurement';
import { apiError, classifyTaskError, logServerEvent, type TaskErrorCode } from '@/lib/server/observability';

export const runtime = 'nodejs';

const CompareSchema = z.object({
  taskId: z.string().trim().min(1),
});

function comparableCostForBudget(input: {
  monthlyPrice: number | null;
  annualPrice: number | null;
  period: 'monthly' | 'yearly' | 'one_time' | 'unknown';
}): number | null {
  if (input.period === 'monthly') {
    if (input.monthlyPrice !== null) return input.monthlyPrice;
    if (input.annualPrice !== null) return input.annualPrice / 12;
    return null;
  }

  if (input.period === 'yearly') {
    if (input.annualPrice !== null) return input.annualPrice;
    if (input.monthlyPrice !== null) return input.monthlyPrice * 12;
    return null;
  }

  if (input.monthlyPrice !== null) return input.monthlyPrice;
  if (input.annualPrice !== null) return input.annualPrice;
  return null;
}

function findingFitsBudget(input: {
  budgetLimit: number | null;
  budgetPeriod: 'monthly' | 'yearly' | 'one_time' | 'unknown';
  finding: Awaited<ReturnType<typeof listProcurementFindings>>[number];
}): boolean | null {
  if (input.budgetLimit === null) return null;
  const comparable = comparableCostForBudget({
    monthlyPrice: input.finding.monthlyPrice,
    annualPrice: input.finding.annualPrice,
    period: input.budgetPeriod,
  });
  if (comparable === null) return null;
  return comparable <= input.budgetLimit;
}

function optionFromFinding(finding: Awaited<ReturnType<typeof listProcurementFindings>>[number]) {
  return {
    findingId: finding.id,
    vendorName: finding.vendorName,
    planName: finding.planName,
    monthlyPrice: finding.monthlyPrice,
    annualPrice: finding.annualPrice,
    billingFrequency: finding.billingFrequency,
    contentAvailability: finding.contentAvailability || null,
    notes: finding.notes || null,
    pricingPageUrl: finding.pricingPageUrl,
    notableFeatures: finding.notableFeatures,
    extractionTimestamp: finding.extractionTimestamp,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { taskId } = CompareSchema.parse(await req.json());
    const userId = getWalletUserId();
    logServerEvent('info', 'procurement.compare.started', { userId, taskId });

    const task = await getProcurementTask({ taskId, userId });
    if (!task) {
      return NextResponse.json(apiError('NOT_FOUND', 'Procurement task not found', true), { status: 404 });
    }

    if (task.status === 'comparing') {
      return NextResponse.json(apiError('IDEMPOTENCY_CONFLICT', 'Comparison already in progress for this task', true), { status: 409 });
    }

    if (task.status === 'awaiting_approval' && task.recommendation) {
      return NextResponse.json({
        ok: true,
        started: false,
        task,
        recommendation: task.recommendation,
      });
    }

    if (task.status === 'purchase_preparing' || task.status === 'purchase_prepared') {
      return NextResponse.json(
        apiError('INVALID_STATE', `Comparison cannot run while task is in ${task.status} state`, true),
        { status: 409 },
      );
    }

    const disallowedStates: Array<typeof task.status> = ['planning', 'planned', 'needs_clarification', 'researching'];
    if (disallowedStates.includes(task.status)) {
      return NextResponse.json(
        apiError('INVALID_STATE', `Run live research before comparison. Current task state: ${task.status}`, true),
        { status: 409 },
      );
    }

    const findings = await listProcurementFindings({ taskId, userId });
    if (findings.length === 0) {
      return NextResponse.json(
        apiError('TINYFISH_RESEARCH_FAILURE', 'No live findings available. Run TinyFish research before comparison.', true),
        { status: 409 },
      );
    }

    const comparisonTask = await updateProcurementTask({
      taskId,
      userId,
      status: 'comparing',
      goal: task.goal,
      budgetLimit: task.budgetLimit,
      category: task.category,
      targetVendors: task.targetVendors,
      comparisonCriteria: task.comparisonCriteria,
      mustHaveFeatures: task.mustHaveFeatures,
      findings: task.findings,
      recommendation: task.recommendation,
      planningOutput: task.planningOutput,
      error: undefined,
    });

    await recordWebAction({
      userId,
      taskId,
      actionType: 'compare',
      status: 'running',
      details: {
        id: randomUUID(),
        phase: 'comparing',
        event: 'compare_started',
        code: 'COMPARE_STARTED',
        message: `evaluating ${findings.length} live finding(s) for recommendation`,
      },
    });

    const evaluation = await evaluateProcurementFindings({
      task: comparisonTask,
      findings,
    });

    const initialWinner = evaluation.winnerFindingId
      ? findings.find((finding) => finding.id === evaluation.winnerFindingId) || null
      : null;

    const budgetPeriod = comparisonTask.planningOutput.budgetConstraint.period;
    const budgetFitCandidates = findings.filter((finding) => findingFitsBudget({
      budgetLimit: comparisonTask.budgetLimit,
      budgetPeriod,
      finding,
    }) === true);

    let winner = initialWinner;
    let noFitExplanation = evaluation.noFitExplanation || null;
    if (comparisonTask.budgetLimit !== null) {
      if (budgetFitCandidates.length === 0) {
        winner = null;
        noFitExplanation = noFitExplanation || `No live findings fit the budget limit of ${comparisonTask.budgetLimit.toFixed(2)} per ${budgetPeriod}.`;
      } else if (winner) {
        const winnerFits = findingFitsBudget({
          budgetLimit: comparisonTask.budgetLimit,
          budgetPeriod,
          finding: winner,
        });

        if (winnerFits === false) {
          winner = [...budgetFitCandidates].sort((a, b) => {
            const aCost = comparableCostForBudget({
              monthlyPrice: a.monthlyPrice,
              annualPrice: a.annualPrice,
              period: budgetPeriod,
            }) || Number.POSITIVE_INFINITY;
            const bCost = comparableCostForBudget({
              monthlyPrice: b.monthlyPrice,
              annualPrice: b.annualPrice,
              period: budgetPeriod,
            }) || Number.POSITIVE_INFINITY;
            return aCost - bCost;
          })[0] || null;
        }
      } else if (budgetFitCandidates.length > 0) {
        winner = [...budgetFitCandidates].sort((a, b) => {
          const aCost = comparableCostForBudget({
            monthlyPrice: a.monthlyPrice,
            annualPrice: a.annualPrice,
            period: budgetPeriod,
          }) || Number.POSITIVE_INFINITY;
          const bCost = comparableCostForBudget({
            monthlyPrice: b.monthlyPrice,
            annualPrice: b.annualPrice,
            period: budgetPeriod,
          }) || Number.POSITIVE_INFINITY;
          return aCost - bCost;
        })[0] || null;
      }
    }

    const alternatives = evaluation.alternativeFindingIds
      .map((id) => findings.find((finding) => finding.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => item.id !== winner?.id)
      .slice(0, 3);

    const policy = winner
      ? await evaluateSpendPolicy({ userId, finding: winner })
      : null;

    const recommendation = {
      engineVersion: 'procurement-compare-v1',
      generatedAt: new Date().toISOString(),
      goal: comparisonTask.goal,
      budgetLimit: comparisonTask.budgetLimit,
      budgetAssessment: evaluation.budgetAssessment,
      noFitExplanation,
      confidence: evaluation.confidence,
      exceptions: evaluation.exceptions,
      winner: winner ? optionFromFinding(winner) : null,
      alternatives: alternatives.map(optionFromFinding),
      whyWinner: evaluation.winnerReasons,
      evidenceLinks: Array.from(new Set([
        ...(winner ? [winner.pricingPageUrl] : []),
        ...alternatives.map((item) => item.pricingPageUrl),
      ])),
      policy,
    };

    const nextStatus: typeof comparisonTask.status = winner && policy?.allowed
      ? 'awaiting_approval'
      : 'researched';

    const nextError = !winner
      ? `[POLICY_FAILURE] ${noFitExplanation || 'No budget-fit winner was selected from live findings'}`
      : policy && !policy.allowed
        ? `[POLICY_FAILURE] ${policy.reason || 'One or more blocking policy checks failed'}`
        : undefined;

    const updatedTask = await updateProcurementTask({
      taskId,
      userId,
      status: nextStatus,
      goal: comparisonTask.goal,
      budgetLimit: comparisonTask.budgetLimit,
      category: comparisonTask.category,
      targetVendors: comparisonTask.targetVendors,
      comparisonCriteria: comparisonTask.comparisonCriteria,
      mustHaveFeatures: comparisonTask.mustHaveFeatures,
      findings: comparisonTask.findings,
      recommendation,
      planningOutput: comparisonTask.planningOutput,
      error: nextError,
    });

    await recordWebAction({
      userId,
      taskId,
      actionType: 'compare',
      status: 'done',
      details: {
        id: randomUUID(),
        phase: 'comparing',
        event: 'compare_completed',
        code: winner ? 'COMPARE_WINNER_SELECTED' : 'COMPARE_NO_BUDGET_FIT',
        message: winner
          ? `selected ${winner.vendorName} ${winner.planName} as top recommendation`
          : 'comparison complete with no budget-fit winner',
      },
      url: winner?.pricingPageUrl,
    });

    await recordWebAction({
      userId,
      taskId,
      actionType: 'guardrail',
      status: winner && policy?.allowed ? 'done' : 'error',
      details: {
        id: randomUUID(),
        phase: 'approval',
        event: 'policy_evaluated',
        code: winner && policy?.allowed ? 'POLICY_PASSED' : 'POLICY_FAILED',
        message: !winner
          ? 'policy check skipped because no winner was selected'
          : policy?.allowed
            ? (policy.approvalRequired
              ? 'policy checks passed; approval required by threshold'
              : 'policy checks passed; no approval required')
            : `policy check failed: ${policy?.reason || 'one or more blocking checks failed'}`,
        policy,
      },
      url: winner?.pricingPageUrl,
    });

    return NextResponse.json({
      ok: true,
      started: true,
      task: updatedTask,
      recommendation,
    });
  } catch (error) {
    let errorCode: TaskErrorCode = 'UNKNOWN_FAILURE';
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to compare procurement findings';

    const status = error instanceof z.ZodError ? 400 : 500;
    errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'procurement.compare.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
