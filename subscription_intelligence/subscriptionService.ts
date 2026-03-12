import "server-only";

import { randomUUID } from "node:crypto";
import { query } from "@/lib/server/db";
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
  const result = await query<TransactionSourceRow>(
    `
      SELECT
        merchant_name,
        normalized_merchant,
        amount::text,
        pending,
        occurred_at::text
      FROM transactions
      WHERE user_id = $1
        AND occurred_at >= (NOW() - INTERVAL '365 days')
      ORDER BY occurred_at ASC
    `,
    [userId],
  );

  return result.rows;
}

async function upsertSuspectedSubscription(
  userId: string,
  candidate: RecurringSubscriptionCandidate,
): Promise<void> {
  await query(
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
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, 'suspected')
      ON CONFLICT (user_id, merchant)
      DO UPDATE SET
        estimated_monthly_cost = EXCLUDED.estimated_monthly_cost,
        recurrence_interval = EXCLUDED.recurrence_interval,
        confidence = EXCLUDED.confidence,
        last_seen = EXCLUDED.last_seen,
        status = CASE
          WHEN subscriptions.status = 'ignored' THEN subscriptions.status
          ELSE 'suspected'
        END,
        updated_at = NOW()
    `,
    [
      randomUUID(),
      userId,
      candidate.merchant,
      candidate.estimated_monthly_cost,
      candidate.recurrence_interval,
      candidate.confidence,
      candidate.last_seen,
    ],
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

  for (const subscription of detected) {
    await upsertSuspectedSubscription(userId, subscription);
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
