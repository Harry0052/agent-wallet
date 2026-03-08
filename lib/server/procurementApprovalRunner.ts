import { randomUUID } from 'node:crypto';
import type { ProcurementRecommendationRecord, ProcurementTaskRecord } from '@/lib/types';
import { recordLedgerEntry, recordWebAction } from '@/lib/server/ledger';
import { getProcurementTask, updateProcurementTask } from '@/lib/server/procurement';
import { parseProcurementRecommendation, recommendationAmount } from '@/lib/server/procurementRecommendation';
import { runTinyFishPurchasePreparation } from '@/lib/server/tinyfishPurchasePrep';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Unknown purchase preparation error';
}

async function appendLog(params: {
  userId: string;
  taskId: string;
  actionType: string;
  status: 'running' | 'done' | 'error';
  message: string;
  url?: string;
  phase?: string;
  event?: string;
  code?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await recordWebAction({
    userId: params.userId,
    taskId: params.taskId,
    actionType: params.actionType,
    status: params.status,
    url: params.url,
    details: {
      id: randomUUID(),
      phase: params.phase,
      event: params.event,
      code: params.code,
      message: params.message,
      ...params.details,
    },
  });
}

async function persistTask(task: ProcurementTaskRecord, params: {
  status: ProcurementTaskRecord['status'];
  recommendation: ProcurementRecommendationRecord;
  error?: string;
}): Promise<ProcurementTaskRecord> {
  return updateProcurementTask({
    taskId: task.id,
    userId: task.userId,
    status: params.status,
    goal: task.goal,
    budgetLimit: task.budgetLimit,
    category: task.category,
    targetVendors: task.targetVendors,
    comparisonCriteria: task.comparisonCriteria,
    mustHaveFeatures: task.mustHaveFeatures,
    findings: task.findings,
    recommendation: params.recommendation as unknown as Record<string, unknown>,
    planningOutput: task.planningOutput,
    error: params.error,
  });
}

export async function runProcurementPurchasePreparation(params: {
  userId: string;
  taskId: string;
}): Promise<void> {
  const task = await getProcurementTask({ taskId: params.taskId, userId: params.userId });
  if (!task) {
    throw new Error(`Procurement task not found: ${params.taskId}`);
  }

  const recommendation = parseProcurementRecommendation(task.recommendation);
  if (!recommendation || !recommendation.winner) {
    throw new Error('No recommendation winner is available for purchase preparation');
  }

  if (!recommendation.policy?.allowed) {
    throw new Error('Purchase preparation is blocked because policy checks did not pass');
  }

  const winner = recommendation.winner;
  const amountInfo = recommendationAmount(recommendation);
  const nextRecommendation: ProcurementRecommendationRecord = {
    ...recommendation,
    purchasePrep: {
      status: 'running',
      proofUrls: recommendation.purchasePrep?.proofUrls || [],
      pendingLedgerEntry: recommendation.purchasePrep?.pendingLedgerEntry,
    },
  };

  await persistTask(task, {
    status: 'purchase_preparing',
    recommendation: nextRecommendation,
  });

  await appendLog({
    userId: task.userId,
    taskId: task.id,
    actionType: 'checkout',
    status: 'running',
    phase: 'purchase_prep',
    event: 'purchase_prep_started',
    code: 'PURCHASE_PREP_STARTED',
    message: `navigating ${winner.vendorName} signup/checkout flow`,
    url: winner.pricingPageUrl,
  });

  await appendLog({
    userId: task.userId,
    taskId: task.id,
    actionType: 'form-fill',
    status: 'running',
    phase: 'purchase_prep',
    event: 'purchase_form_fill_started',
    code: 'PURCHASE_FORM_FILL_STARTED',
    message: `filling plan and account form fields for ${winner.planName}`,
  });

  try {
    const prep = await runTinyFishPurchasePreparation({
      taskId: task.id,
      vendorName: winner.vendorName,
      planName: winner.planName,
      pricingPageUrl: winner.pricingPageUrl,
      amount: amountInfo.amount,
      amountBasis: amountInfo.basis,
    });

    for (const step of prep.steps) {
      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: step.type,
        status: step.status,
        phase: 'purchase_prep',
        event: 'tinyfish_step',
        code: 'TINYFISH_STEP',
        message: step.description,
        url: step.url,
      });
    }

    let pendingLedgerEntry = recommendation.purchasePrep?.pendingLedgerEntry;
    if (!pendingLedgerEntry && amountInfo.amount !== null) {
      const ledger = await recordLedgerEntry({
        userId: task.userId,
        type: 'procurement_commitment',
        amount: amountInfo.amount,
        currency: 'usd',
        direction: 'debit',
        status: 'pending',
        description: `Purchase prepared: ${winner.vendorName} ${winner.planName} (${amountInfo.basis})`,
        merchant: winner.vendorName,
        sourceUrl: prep.checkoutUrl || winner.pricingPageUrl,
        metadata: {
          procurement_task_id: task.id,
          taskTitle: `${task.goal.slice(0, 120)}`,
          plan_name: winner.planName,
          amount_basis: amountInfo.basis,
        },
      });

      pendingLedgerEntry = {
        entryId: ledger.id,
        type: 'procurement_commitment',
        status: 'pending',
        amount: ledger.amount,
        currency: ledger.currency,
        description: ledger.description,
      };
    }

    const updatedRecommendation: ProcurementRecommendationRecord = {
      ...recommendation,
      purchasePrep: {
        status: 'prepared',
        preparedAt: new Date().toISOString(),
        checkoutUrl: prep.checkoutUrl || winner.pricingPageUrl,
        proofUrls: prep.proofUrls,
        pendingLedgerEntry,
      },
    };

    await persistTask(task, {
      status: 'purchase_prepared',
      recommendation: updatedRecommendation,
    });

    await appendLog({
      userId: task.userId,
      taskId: task.id,
      actionType: 'checkout',
      status: 'done',
      phase: 'purchase_prep',
      event: 'purchase_prep_completed',
      code: 'PURCHASE_PREP_COMPLETED',
      message: prep.checkoutUrl
        ? `purchase prepared and paused before payment at ${prep.checkoutUrl}`
        : 'purchase prepared and paused before payment',
      url: prep.checkoutUrl || winner.pricingPageUrl,
    });

    if (prep.proofUrls.length > 0) {
      await appendLog({
        userId: task.userId,
        taskId: task.id,
        actionType: 'extract',
        status: 'done',
        phase: 'purchase_prep',
        event: 'purchase_proof_captured',
        code: 'PURCHASE_PROOF_CAPTURED',
        message: `captured ${prep.proofUrls.length} proof reference(s) from TinyFish`,
        details: { proofUrls: prep.proofUrls },
      });
    }
  } catch (error) {
    const message = errorMessage(error);
    const failedRecommendation: ProcurementRecommendationRecord = {
      ...recommendation,
      purchasePrep: {
        status: 'failed',
        proofUrls: recommendation.purchasePrep?.proofUrls || [],
        pendingLedgerEntry: recommendation.purchasePrep?.pendingLedgerEntry,
        error: message,
      },
    };

    await persistTask(task, {
      status: 'failed',
      recommendation: failedRecommendation,
      error: `[TINYFISH_RESEARCH_FAILURE] ${message}`,
    });

    await appendLog({
      userId: task.userId,
      taskId: task.id,
      actionType: 'checkout',
      status: 'error',
      phase: 'purchase_prep',
      event: 'purchase_prep_failed',
      code: 'PURCHASE_PREP_FAILED',
      message: `purchase preparation failed: ${message}`,
    });
  }
}
