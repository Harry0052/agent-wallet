import "server-only";

import { randomUUID } from "node:crypto";
import { query } from "@/lib/server/db";
import { ensureFinancialConnectorSchema } from "@/financial_connectors/tokenVault";
import { ensureTransactionSchema } from "@/transactions/transactionRepository";
import { groupTransactionsByMerchant } from "@/subscription_intelligence/merchantGrouping";
import {
  detectRecurringSubscriptions,
  toTransactionSignal,
  type RecurringSubscriptionCandidate,
} from "@/subscription_intelligence/recurringDetector";

interface TransactionSourceRow {
  merchant_name: string;
  normalized_merchant: string;
  amount: string;
  pending: boolean;
  occurred_at: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  merchant: string;
  estimated_monthly_cost: string;
  recurrence_interval: string;
  confidence: string;
  last_seen: string;
  status: string;
}

export interface DetectedSubscription {
  id: string;
  user_id: string;
  merchant: string;
  estimated_monthly_cost: number;
  recurrence_interval: string;
  confidence: number;
  last_seen: string;
  status: string;
}

export type RecurringLifecycleStatus = "detected" | "confirmed" | "ignored" | "inactive" | "manual";

export interface RecurringExplanation {
  summary: string;
  transaction_count: number;
  first_seen: string | null;
  last_seen: string | null;
  average_interval_days: number | null;
  average_amount: number | null;
}

export interface RecurringInsight extends DetectedSubscription {
  lifecycle_status: RecurringLifecycleStatus;
  source_state: "Synced" | "Imported" | "Inferred" | "Manual";
  explanation: RecurringExplanation;
}

declare global {
  var __subscriptionIntelligenceSchemaInitPromise: Promise<void> | undefined;
}

function rowToDetectedSubscription(row: SubscriptionRow): DetectedSubscription {
  return {
    id: row.id,
    user_id: row.user_id,
    merchant: row.merchant,
    estimated_monthly_cost: Number(row.estimated_monthly_cost),
    recurrence_interval: row.recurrence_interval,
    confidence: Number(row.confidence),
    last_seen: row.last_seen,
    status: row.status,
  };
}

async function ensureSubscriptionSchema(): Promise<void> {
  if (globalThis.__subscriptionIntelligenceSchemaInitPromise) {
    return globalThis.__subscriptionIntelligenceSchemaInitPromise;
  }

  globalThis.__subscriptionIntelligenceSchemaInitPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        merchant TEXT NOT NULL,
        estimated_monthly_cost NUMERIC(14, 2) NOT NULL,
        recurrence_interval TEXT NOT NULL,
        confidence NUMERIC(4, 2) NOT NULL,
        last_seen TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, merchant)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
      ON subscriptions (user_id, status, confidence DESC);
    `);
  })();

  return globalThis.__subscriptionIntelligenceSchemaInitPromise;
}

async function loadCandidateTransactions(userId: string): Promise<TransactionSourceRow[]> {
  await ensureTransactionSchema();
  await ensureFinancialConnectorSchema();
  const result = await query<TransactionSourceRow>(
    `
      SELECT
        t.merchant_name,
        t.normalized_merchant,
        t.amount::text,
        t.pending,
        t.occurred_at::text
      FROM transactions t
      INNER JOIN financial_connector_accounts a
        ON a.id = t.linked_account_id
       AND a.user_id = t.user_id
      WHERE t.user_id = $1
        AND t.occurred_at >= (NOW() - INTERVAL '365 days')
      ORDER BY t.occurred_at ASC
    `,
    [userId],
  );

  return result.rows;
}

async function batchUpsertSuspectedSubscriptions(
  userId: string,
  candidates: RecurringSubscriptionCandidate[],
): Promise<void> {
  if (candidates.length === 0) return;

  // Build a single multi-row INSERT ... ON CONFLICT for all candidates
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const c of candidates) {
    placeholders.push(
      `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}::timestamptz, 'suspected')`,
    );
    values.push(
      randomUUID(),
      userId,
      c.merchant,
      c.estimated_monthly_cost,
      c.recurrence_interval,
      c.confidence,
      c.last_seen,
    );
    idx += 7;
  }

  await query(
    `
      INSERT INTO subscriptions (
        id, user_id, merchant, estimated_monthly_cost,
        recurrence_interval, confidence, last_seen, status
      )
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (user_id, merchant)
      DO UPDATE SET
        estimated_monthly_cost = EXCLUDED.estimated_monthly_cost,
        recurrence_interval = EXCLUDED.recurrence_interval,
        confidence = EXCLUDED.confidence,
        last_seen = EXCLUDED.last_seen,
        status = CASE
          WHEN subscriptions.status IN ('ignored', 'confirmed', 'inactive', 'manual') THEN subscriptions.status
          ELSE 'suspected'
        END,
        updated_at = NOW()
    `,
    values,
  );
}

async function markMissingSuspectedAsInactive(input: {
  userId: string;
  activeMerchants: string[];
}): Promise<void> {
  if (input.activeMerchants.length === 0) {
    await query(
      `
        UPDATE subscriptions
        SET status = 'inactive',
            updated_at = NOW()
        WHERE user_id = $1
          AND status = 'suspected'
      `,
      [input.userId],
    );
    return;
  }

  await query(
    `
      UPDATE subscriptions
      SET status = 'inactive',
          updated_at = NOW()
      WHERE user_id = $1
        AND status = 'suspected'
        AND NOT (merchant = ANY($2::text[]))
    `,
    [input.userId, input.activeMerchants],
  );
}

export async function detectAndPersistRecurringSubscriptions(
  userId: string,
): Promise<DetectedSubscription[]> {
  await ensureSubscriptionSchema();

  const source = await loadCandidateTransactions(userId);
  const signals = source.map((row) =>
    toTransactionSignal({
      merchant_name: row.merchant_name,
      normalized_merchant: row.normalized_merchant,
      amount: Number(row.amount),
      pending: row.pending,
      occurred_at: row.occurred_at,
    }),
  );

  const grouped = groupTransactionsByMerchant(signals);
  const detected = detectRecurringSubscriptions(grouped);

  // Batch upsert all detected subscriptions in one query instead of N sequential writes
  if (detected.length > 0) {
    await batchUpsertSuspectedSubscriptions(userId, detected);
  }

  await markMissingSuspectedAsInactive({
    userId,
    activeMerchants: detected.map((item) => item.merchant),
  });

  return listSubscriptions({
    userId,
    status: "suspected",
  });
}

function lifecycleStatusFromStored(value: string): RecurringLifecycleStatus {
  const status = value.trim().toLowerCase();
  if (status === "confirmed") return "confirmed";
  if (status === "ignored") return "ignored";
  if (status === "inactive") return "inactive";
  if (status === "manual") return "manual";
  return "detected";
}

function average(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function computeExplanation(signals: TransactionSourceRow[], lifecycleStatus: RecurringLifecycleStatus): RecurringExplanation {
  if (lifecycleStatus === "manual") {
    return {
      summary: "Manually tracked recurring item.",
      transaction_count: 0,
      first_seen: null,
      last_seen: null,
      average_interval_days: null,
      average_amount: null,
    };
  }

  if (signals.length === 0) {
    return {
      summary: "No active synced transactions currently match this recurring item.",
      transaction_count: 0,
      first_seen: null,
      last_seen: null,
      average_interval_days: null,
      average_amount: null,
    };
  }

  const sorted = [...signals].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const intervalsDays: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = Date.parse(sorted[i - 1].occurred_at);
    const next = Date.parse(sorted[i].occurred_at);
    intervalsDays.push((next - prev) / (1000 * 60 * 60 * 24));
  }

  const avgInterval = average(intervalsDays);
  const avgAmount = average(sorted.map((row) => Math.abs(Number(row.amount))));
  const firstSeen = sorted[0]?.occurred_at || null;
  const lastSeen = sorted[sorted.length - 1]?.occurred_at || null;

  const cadenceText = avgInterval
    ? `~${Math.round(avgInterval)} days apart`
    : "with repeated charge behavior";
  const amountText = avgAmount ? `around $${avgAmount.toFixed(2)}` : "with varying amounts";
  const statusText = lifecycleStatus === "confirmed"
    ? "User-confirmed recurring item"
    : lifecycleStatus === "ignored"
      ? "Ignored recurring candidate"
      : lifecycleStatus === "inactive"
        ? "Inactive recurring item"
        : "Detected recurring pattern";

  return {
    summary: `${statusText}: ${sorted.length} transactions ${cadenceText}, ${amountText}.`,
    transaction_count: sorted.length,
    first_seen: firstSeen,
    last_seen: lastSeen,
    average_interval_days: avgInterval ? Number(avgInterval.toFixed(1)) : null,
    average_amount: avgAmount ? Number(avgAmount.toFixed(2)) : null,
  };
}

async function loadActiveTransactionsForRecurring(userId: string): Promise<TransactionSourceRow[]> {
  await ensureTransactionSchema();
  await ensureFinancialConnectorSchema();
  const result = await query<TransactionSourceRow>(
    `
      SELECT
        t.merchant_name,
        t.normalized_merchant,
        t.amount::text,
        t.pending,
        t.occurred_at::text
      FROM transactions t
      INNER JOIN financial_connector_accounts a
        ON a.id = t.linked_account_id
       AND a.user_id = t.user_id
      WHERE t.user_id = $1
        AND t.pending = FALSE
        AND t.occurred_at >= (NOW() - INTERVAL '365 days')
      ORDER BY t.occurred_at ASC
    `,
    [userId],
  );

  return result.rows;
}

function sourceStateFrom(input: {
  lifecycle: RecurringLifecycleStatus;
  transactionCount: number;
}): RecurringInsight["source_state"] {
  if (input.lifecycle === "manual") return "Manual";
  if (input.lifecycle === "detected") return "Inferred";
  if (input.transactionCount > 0) return "Synced";
  return "Manual";
}

export async function listRecurringIntelligence(input: {
  userId: string;
  status?: string;
}): Promise<RecurringInsight[]> {
  const [subscriptions, activeSignals] = await Promise.all([
    listSubscriptions(input),
    loadActiveTransactionsForRecurring(input.userId),
  ]);

  const byNormalized = new Map<string, TransactionSourceRow[]>();
  const byMerchant = new Map<string, TransactionSourceRow[]>();
  for (const signal of activeSignals) {
    const normalizedKey = signal.normalized_merchant.trim().toLowerCase();
    const merchantKey = signal.merchant_name.trim().toLowerCase();
    if (normalizedKey) {
      const existing = byNormalized.get(normalizedKey) || [];
      existing.push(signal);
      byNormalized.set(normalizedKey, existing);
    }
    if (merchantKey) {
      const existing = byMerchant.get(merchantKey) || [];
      existing.push(signal);
      byMerchant.set(merchantKey, existing);
    }
  }

  return subscriptions.map((subscription) => {
    const key = subscription.merchant.trim().toLowerCase();
    const matchedSignals = byNormalized.get(key) || byMerchant.get(key) || [];
    const lifecycleStatus = lifecycleStatusFromStored(subscription.status);
    const explanation = computeExplanation(matchedSignals, lifecycleStatus);

    return {
      ...subscription,
      lifecycle_status: lifecycleStatus,
      source_state: sourceStateFrom({
        lifecycle: lifecycleStatus,
        transactionCount: explanation.transaction_count,
      }),
      explanation,
    };
  });
}

export async function updateRecurringSubscriptionStatus(input: {
  userId: string;
  subscriptionId: string;
  status: "confirmed" | "ignored" | "inactive";
}): Promise<void> {
  await ensureSubscriptionSchema();

  const result = await query<{ id: string }>(
    `
      UPDATE subscriptions
      SET
        status = $3,
        updated_at = NOW()
      WHERE user_id = $1
        AND id = $2
      RETURNING id
    `,
    [input.userId, input.subscriptionId, input.status],
  );

  if (!result.rows[0]) {
    throw new Error("Recurring item not found.");
  }
}

export async function upsertManualRecurringSubscription(input: {
  userId: string;
  merchant: string;
  estimatedMonthlyCost: number;
  recurrenceInterval?: string;
}): Promise<DetectedSubscription> {
  await ensureSubscriptionSchema();

  const merchant = input.merchant.trim();
  if (!merchant) {
    throw new Error("merchant is required.");
  }
  if (!Number.isFinite(input.estimatedMonthlyCost) || input.estimatedMonthlyCost <= 0) {
    throw new Error("estimatedMonthlyCost must be greater than 0.");
  }

  const interval = (input.recurrenceInterval || "monthly").trim().toLowerCase() || "monthly";
  const upserted = await query<SubscriptionRow>(
    `
      INSERT INTO subscriptions (
        id,
        user_id,
        merchant,
        estimated_monthly_cost,
        recurrence_interval,
        confidence,
        last_seen,
        status
      )
      VALUES ($1, $2, $3, $4, $5, 1.0, NOW(), 'manual')
      ON CONFLICT (user_id, merchant)
      DO UPDATE SET
        estimated_monthly_cost = EXCLUDED.estimated_monthly_cost,
        recurrence_interval = EXCLUDED.recurrence_interval,
        confidence = EXCLUDED.confidence,
        status = 'manual',
        updated_at = NOW()
      RETURNING
        id,
        user_id,
        merchant,
        estimated_monthly_cost::text,
        recurrence_interval,
        confidence::text,
        last_seen::text,
        status
    `,
    [
      randomUUID(),
      input.userId,
      merchant,
      Number(input.estimatedMonthlyCost.toFixed(2)),
      interval,
    ],
  );

  const row = upserted.rows[0];
  if (!row) {
    throw new Error("Failed to save manual recurring item.");
  }

  return rowToDetectedSubscription(row);
}

export async function listSubscriptions(input: {
  userId: string;
  status?: string;
}): Promise<DetectedSubscription[]> {
  await ensureSubscriptionSchema();

  const hasStatusFilter = Boolean(input.status?.trim());
  const result = await query<SubscriptionRow>(
    `
      SELECT
        id,
        user_id,
        merchant,
        estimated_monthly_cost::text,
        recurrence_interval,
        confidence::text,
        last_seen::text,
        status
      FROM subscriptions
      WHERE user_id = $1
        ${hasStatusFilter ? "AND status = $2" : ""}
      ORDER BY confidence DESC, last_seen DESC
    `,
    hasStatusFilter ? [input.userId, input.status] : [input.userId],
  );

  return result.rows.map(rowToDetectedSubscription);
}
