import { randomUUID } from 'node:crypto';
import type {
  ActiveSubscriptionTask,
  SubscriptionActionRecord,
  SubscriptionOperationStatus,
  SubscriptionOperationType,
} from '@/lib/types';
import { query } from '@/lib/server/db';
import { parseProcurementRecommendation, recommendationAmount } from '@/lib/server/procurementRecommendation';

type ActiveTaskRow = {
  id: string;
  user_id: string;
  goal: string;
  status: string;
  recommendation: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type SubscriptionActionRow = {
  id: string;
  user_id: string;
  task_id: string;
  operation: SubscriptionOperationType;
  status: SubscriptionOperationStatus;
  summary: string | null;
  evidence_urls: unknown;
  projected_savings: string | null;
  projected_savings_basis: string | null;
  currency: string | null;
  renewal_date: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function rowToAction(row: SubscriptionActionRow): SubscriptionActionRecord {
  const projectedSavingsBasis = row.projected_savings_basis === 'monthly'
    || row.projected_savings_basis === 'annual'
    || row.projected_savings_basis === 'unknown'
    ? row.projected_savings_basis
    : 'unknown';

  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    operation: row.operation,
    status: row.status,
    summary: row.summary || undefined,
    evidenceUrls: toStringArray(row.evidence_urls),
    projectedSavings: row.projected_savings !== null ? Number(row.projected_savings) : null,
    projectedSavingsBasis,
    currency: row.currency,
    renewalDate: row.renewal_date || undefined,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toActiveSubscription(row: ActiveTaskRow): ActiveSubscriptionTask | null {
  const recommendation = parseProcurementRecommendation(row.recommendation);
  if (!recommendation || !recommendation.winner) return null;
  if (recommendation.approval?.decision !== 'approved') return null;

  const amount = recommendationAmount(recommendation);
  return {
    taskId: row.id,
    title: row.goal,
    vendorName: recommendation.winner.vendorName,
    planName: recommendation.winner.planName,
    amount: amount.amount,
    amountBasis: amount.basis,
    billingFrequency: recommendation.winner.billingFrequency,
    sourceUrl: recommendation.purchasePrep?.checkoutUrl || recommendation.winner.pricingPageUrl,
    approvedAt: recommendation.approval?.decidedAt,
    taskStatus: row.status as ActiveSubscriptionTask['taskStatus'],
  };
}

export async function listActiveSubscriptions(userId: string): Promise<ActiveSubscriptionTask[]> {
  const [taskResult, actionResult] = await Promise.all([
    query<ActiveTaskRow>(
      `
        SELECT
          id, user_id, goal, status, recommendation,
          created_at::text, updated_at::text
        FROM procurement_tasks
        WHERE user_id = $1
          AND recommendation IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT 120
      `,
      [userId],
    ),
    query<{ task_id: string; operation: string; status: string }>(
      `
        SELECT DISTINCT ON (task_id)
          task_id, operation, status
        FROM subscription_actions
        WHERE user_id = $1
        ORDER BY task_id, created_at DESC
      `,
      [userId],
    ),
  ]);

  const cancelledTaskIds = new Set(
    actionResult.rows
      .filter((row) => row.operation === 'cancel' && row.status === 'completed')
      .map((row) => row.task_id),
  );

  return taskResult.rows
    .filter((row) => !cancelledTaskIds.has(row.id))
    .map(toActiveSubscription)
    .filter((item): item is ActiveSubscriptionTask => Boolean(item));
}

export async function createSubscriptionAction(params: {
  userId: string;
  taskId: string;
  operation: SubscriptionOperationType;
}): Promise<SubscriptionActionRecord> {
  const id = randomUUID();

  const result = await query<SubscriptionActionRow>(
    `
      INSERT INTO subscription_actions (
        id, user_id, task_id, operation, status, evidence_urls,
        projected_savings, projected_savings_basis, currency, renewal_date, result, error
      )
      VALUES (
        $1, $2, $3, $4, 'running', '[]'::jsonb,
        NULL, 'unknown', NULL, NULL, NULL, NULL
      )
      ON CONFLICT (user_id, task_id, operation)
      WHERE status = 'running'
      DO UPDATE SET
        updated_at = NOW()
      RETURNING
        id, user_id, task_id, operation, status, summary, evidence_urls,
        projected_savings::text, projected_savings_basis, currency, renewal_date::text,
        result, error, created_at::text, updated_at::text
    `,
    [id, params.userId, params.taskId, params.operation],
  );

  return rowToAction(result.rows[0]);
}

export async function getSubscriptionAction(params: {
  userId: string;
  actionId: string;
}): Promise<SubscriptionActionRecord | null> {
  const result = await query<SubscriptionActionRow>(
    `
      SELECT
        id, user_id, task_id, operation, status, summary, evidence_urls,
        projected_savings::text, projected_savings_basis, currency, renewal_date::text,
        result, error, created_at::text, updated_at::text
      FROM subscription_actions
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [params.actionId, params.userId],
  );

  if (!result.rows[0]) return null;
  return rowToAction(result.rows[0]);
}

export async function updateSubscriptionAction(params: {
  actionId: string;
  userId: string;
  status: SubscriptionOperationStatus;
  summary?: string;
  evidenceUrls?: string[];
  projectedSavings?: number | null;
  projectedSavingsBasis?: 'monthly' | 'annual' | 'unknown';
  currency?: string | null;
  renewalDate?: string | null;
  result?: Record<string, unknown> | null;
  error?: string;
}): Promise<SubscriptionActionRecord> {
  const result = await query<SubscriptionActionRow>(
    `
      UPDATE subscription_actions
      SET
        status = $3,
        summary = $4,
        evidence_urls = $5::jsonb,
        projected_savings = $6,
        projected_savings_basis = $7,
        currency = $8,
        renewal_date = $9::timestamptz,
        result = $10::jsonb,
        error = $11,
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING
        id, user_id, task_id, operation, status, summary, evidence_urls,
        projected_savings::text, projected_savings_basis, currency, renewal_date::text,
        result, error, created_at::text, updated_at::text
    `,
    [
      params.actionId,
      params.userId,
      params.status,
      params.summary || null,
      JSON.stringify(params.evidenceUrls || []),
      params.projectedSavings ?? null,
      params.projectedSavingsBasis || 'unknown',
      params.currency || null,
      params.renewalDate || null,
      params.result ? JSON.stringify(params.result) : null,
      params.error || null,
    ],
  );

  if (!result.rows[0]) {
    throw new Error('Failed to update subscription action');
  }

  return rowToAction(result.rows[0]);
}

export async function listSubscriptionActions(params: {
  userId: string;
  taskId?: string;
  limit?: number;
}): Promise<SubscriptionActionRecord[]> {
  const limit = Math.min(Math.max(params.limit ?? 60, 1), 300);
  const result = params.taskId
    ? await query<SubscriptionActionRow>(
      `
        SELECT
          id, user_id, task_id, operation, status, summary, evidence_urls,
          projected_savings::text, projected_savings_basis, currency, renewal_date::text,
          result, error, created_at::text, updated_at::text
        FROM subscription_actions
        WHERE user_id = $1
          AND task_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      `,
      [params.userId, params.taskId, limit],
    )
    : await query<SubscriptionActionRow>(
      `
        SELECT
          id, user_id, task_id, operation, status, summary, evidence_urls,
          projected_savings::text, projected_savings_basis, currency, renewal_date::text,
          result, error, created_at::text, updated_at::text
        FROM subscription_actions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [params.userId, limit],
    );

  return result.rows.map(rowToAction);
}
