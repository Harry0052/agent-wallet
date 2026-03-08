import { randomUUID } from 'node:crypto';
import type { ProcurementRecommendationRecord, SubscriptionOperationStatus } from '@/lib/types';
import { getProcurementTask } from '@/lib/server/procurement';
import { recordLedgerEntry, recordWebAction } from '@/lib/server/ledger';
import { parseProcurementRecommendation } from '@/lib/server/procurementRecommendation';
import { getSubscriptionAction, updateSubscriptionAction } from '@/lib/server/subscriptions';
import { runTinyFishSubscriptionOperation } from '@/lib/server/tinyfishSubscriptionOps';

function firstErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Unknown subscription operation error';
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

function isSavingsOperation(operation: string): boolean {
  return operation === 'downgrade' || operation === 'cancel' || operation === 'switch_billing';
}

async function writeSavingsProjectionLedger(params: {
  userId: string;
  taskId: string;
  recommendation: ProcurementRecommendationRecord;
  operation: string;
  projectedSavings: number;
  basis: 'monthly' | 'annual' | 'unknown';
  sourceUrl: string;
}): Promise<void> {
  if (!isSavingsOperation(params.operation)) return;
  if (!(params.projectedSavings > 0)) return;

  await recordLedgerEntry({
    userId: params.userId,
    type: 'subscription_savings_projection',
    amount: params.projectedSavings,
    currency: 'usd',
    direction: 'credit',
    status: 'pending',
    description: `Projected savings: ${params.recommendation.winner?.vendorName || 'subscription'} ${params.operation} (${params.basis})`,
    merchant: params.recommendation.winner?.vendorName,
    sourceUrl: params.sourceUrl,
    metadata: {
      procurement_task_id: params.taskId,
      operation: params.operation,
      projected_basis: params.basis,
      taskTitle: params.recommendation.goal.slice(0, 120),
    },
  });
}

export async function runSubscriptionOperation(params: {
  userId: string;
  actionId: string;
}): Promise<void> {
  const action = await getSubscriptionAction({ userId: params.userId, actionId: params.actionId });
  if (!action) {
    throw new Error(`Subscription action not found: ${params.actionId}`);
  }

  const task = await getProcurementTask({ taskId: action.taskId, userId: params.userId });
  if (!task) {
    throw new Error(`Procurement task not found for subscription action: ${action.taskId}`);
  }

  const recommendation = parseProcurementRecommendation(task.recommendation);
  if (!recommendation || !recommendation.winner) {
    throw new Error('Subscription action requires an approved recommendation winner');
  }

  if (recommendation.approval?.decision !== 'approved') {
    throw new Error('Subscription operation blocked until procurement task is explicitly approved');
  }

  await appendLog({
    userId: params.userId,
    taskId: task.id,
    actionType: 'visit',
    status: 'running',
    phase: 'subscription_ops',
    event: 'subscription_operation_started',
    code: 'SUBSCRIPTION_OPERATION_STARTED',
    message: `starting ${action.operation} for ${recommendation.winner.vendorName}`,
    url: recommendation.purchasePrep?.checkoutUrl || recommendation.winner.pricingPageUrl,
  });

  try {
    const tinyfish = await runTinyFishSubscriptionOperation({
      taskId: task.id,
      service: recommendation.winner.vendorName,
      planName: recommendation.winner.planName,
      sourceUrl: recommendation.purchasePrep?.checkoutUrl || recommendation.winner.pricingPageUrl,
      operation: action.operation,
    });

    for (const step of tinyfish.steps) {
      await appendLog({
        userId: params.userId,
        taskId: task.id,
        actionType: step.type,
        status: step.status,
        phase: 'subscription_ops',
        event: 'tinyfish_step',
        code: 'TINYFISH_STEP',
        message: step.description,
        url: step.url,
      });
    }

    let status: SubscriptionOperationStatus = 'completed';
    let error: string | undefined;
    let summary = tinyfish.summary;

    if (tinyfish.blocker) {
      status = 'blocked';
      error = tinyfish.blocker;
      summary = `Blocked: ${tinyfish.blocker}`;
    } else if (!tinyfish.success) {
      status = 'failed';
      error = tinyfish.summary;
      summary = tinyfish.summary;
    }

    await updateSubscriptionAction({
      actionId: action.id,
      userId: params.userId,
      status,
      summary,
      evidenceUrls: tinyfish.evidenceUrls,
      projectedSavings: tinyfish.projectedSavings,
      projectedSavingsBasis: tinyfish.projectedSavingsBasis,
      currency: 'usd',
      renewalDate: tinyfish.renewalDate || null,
      result: tinyfish.raw,
      error,
    });

    if (status === 'completed') {
      await writeSavingsProjectionLedger({
        userId: params.userId,
        taskId: task.id,
        recommendation,
        operation: action.operation,
        projectedSavings: tinyfish.projectedSavings || 0,
        basis: tinyfish.projectedSavingsBasis,
        sourceUrl: tinyfish.evidenceUrls[0] || recommendation.winner.pricingPageUrl,
      });
    }

    await appendLog({
      userId: params.userId,
      taskId: task.id,
      actionType: 'compare',
      status: status === 'completed' ? 'done' : 'error',
      phase: 'subscription_ops',
      event: status === 'completed' ? 'subscription_operation_completed' : 'subscription_operation_blocked',
      code: status === 'completed' ? 'SUBSCRIPTION_OPERATION_COMPLETED' : 'SUBSCRIPTION_OPERATION_BLOCKED',
      message: summary,
      url: tinyfish.evidenceUrls[0] || recommendation.winner.pricingPageUrl,
      details: {
        evidenceUrls: tinyfish.evidenceUrls,
        projectedSavings: tinyfish.projectedSavings,
        projectedSavingsBasis: tinyfish.projectedSavingsBasis,
        renewalDate: tinyfish.renewalDate,
      },
    });
  } catch (error) {
    const message = firstErrorMessage(error);
    await updateSubscriptionAction({
      actionId: action.id,
      userId: params.userId,
      status: 'failed',
      summary: message,
      error: `[TINYFISH_RESEARCH_FAILURE] ${message}`,
    });

    await appendLog({
      userId: params.userId,
      taskId: task.id,
      actionType: 'compare',
      status: 'error',
      phase: 'subscription_ops',
      event: 'subscription_operation_failed',
      code: 'SUBSCRIPTION_OPERATION_FAILED',
      message: `subscription ${action.operation} failed: ${message}`,
      url: recommendation.winner.pricingPageUrl,
    });
  }
}
