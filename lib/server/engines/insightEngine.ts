import 'server-only';

import { randomUUID } from 'node:crypto';
import { query } from '@/lib/server/db';
import { listAnalyzableTransactions } from '@/lib/server/engines/transactionGuard';
import {
  buildDedupKey,
  ENGINE_VERSION,
  RULES_VERSION,
} from '@/lib/server/engines/contracts';
import { buildSafeSpendingDataset } from '@/security/aiSanitizer';
import { analyzeSpending } from '@/ai_spend_intelligence/spendAnalyzer';
import { detectAnomalies } from '@/ai_spend_intelligence/anomalyDetector';
import { adviseOnSubscriptions } from '@/ai_spend_intelligence/subscriptionAdvisor';
import { detectPriceIncreases } from '@/ai_spend_intelligence/priceTracker';
import { detectCategoryDrift } from '@/ai_spend_intelligence/categoryDriftDetector';
import { detectAndPersistRecurringSubscriptions } from '@/subscription_intelligence/subscriptionService';
import { logInsightRun } from '@/lib/server/engines/snapshotStore';
import { recordEngineMetric } from '@/lib/server/engines/engineMetrics';

declare global {
  var __insightsSchemaInitPromise: Promise<void> | undefined;
}

async function ensureInsightsSchema(): Promise<void> {
  if (globalThis.__insightsSchemaInitPromise) {
    return globalThis.__insightsSchemaInitPromise;
  }

  globalThis.__insightsSchemaInitPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        insight_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        severity TEXT NOT NULL DEFAULT 'info',
        status TEXT NOT NULL DEFAULT 'active',
        related_merchant TEXT,
        amount_impact NUMERIC(14, 2),
        dedup_key TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        rules_version TEXT NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        dismissed_at TIMESTAMPTZ
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_insights_user_status
      ON insights (user_id, status, generated_at DESC);
    `);

    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_dedup_active
      ON insights (dedup_key)
      WHERE status = 'active';
    `);
  })();

  return globalThis.__insightsSchemaInitPromise;
}

export interface InsightGenerationResult {
  insightsCreated: number;
  insightsDeduped: number;
  latencyMs: number;
  engineVersion: string;
  rulesVersion: string;
}

interface InsightCandidate {
  insightType: string;
  title: string;
  summary: string;
  detail: Record<string, unknown>;
  severity: 'info' | 'warning' | 'critical';
  relatedMerchant?: string;
  amountImpact?: number;
  dedupKey: string;
}

function monthWindow(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function generateInsights(
  userId: string,
): Promise<InsightGenerationResult> {
  const startMs = Date.now();

  await ensureInsightsSchema();

  const { transactions } = await listAnalyzableTransactions({ userId });

  if (transactions.length === 0) {
    const latencyMs = Date.now() - startMs;
    await logInsightRun(userId, {
      insightsGenerated: 0,
      insightsSuppressed: 0,
      latencyMs,
    });
    return {
      insightsCreated: 0,
      insightsDeduped: 0,
      latencyMs,
      engineVersion: ENGINE_VERSION,
      rulesVersion: RULES_VERSION,
    };
  }

  const safeDataset = buildSafeSpendingDataset(
    transactions.map((tx) => ({
      merchant_name: tx.merchant_name,
      normalized_merchant: tx.normalized_merchant,
      amount: tx.amount,
      category: tx.category,
      pending: tx.pending,
      occurred_at: tx.occurred_at,
    })),
  );

  const [, anomalyResult, subscriptions] = await Promise.all([
    Promise.resolve(analyzeSpending(safeDataset.normalizedTransactions)),
    Promise.resolve(detectAnomalies(safeDataset.normalizedTransactions)),
    detectAndPersistRecurringSubscriptions(userId),
  ]);

  const advisorResult = adviseOnSubscriptions({
    subscriptions,
    transactions: safeDataset.normalizedTransactions,
  });

  const subscriptionMerchants = subscriptions.map((s) =>
    s.merchant.trim().toLowerCase(),
  );

  const priceIncreases = detectPriceIncreases({
    transactions,
    subscriptionMerchants,
  });

  const categoryDrifts = detectCategoryDrift({ transactions });

  const window = monthWindow();
  const candidates: InsightCandidate[] = [];

  for (const charge of anomalyResult.unusual_charges) {
    if (charge.confidence < 0.7) continue;
    candidates.push({
      insightType: 'unusual_spending',
      title: `Unusual charge at ${charge.merchant}`,
      summary: `A charge of $${charge.amount.toFixed(2)} at ${charge.merchant} was flagged as unusual. ${charge.reason}`,
      detail: {
        merchant: charge.merchant,
        amount: charge.amount,
        occurredAt: charge.occurred_at,
        reason: charge.reason,
        confidence: charge.confidence,
      },
      severity: charge.amount > 200 ? 'critical' : 'warning',
      relatedMerchant: charge.merchant,
      amountImpact: charge.amount,
      dedupKey: buildDedupKey({
        userId,
        engine: 'insight',
        entity: `unusual:${charge.merchant}:${charge.amount}`,
        window,
      }),
    });
  }

  for (const suggestion of advisorResult.cancellation_suggestions) {
    candidates.push({
      insightType: 'waste',
      title: `Consider canceling ${suggestion.subscription}`,
      summary: `${suggestion.subscription} costs $${suggestion.monthly_cost.toFixed(2)}/mo. ${suggestion.reason}`,
      detail: {
        subscription: suggestion.subscription,
        monthlyCost: suggestion.monthly_cost,
        recommendation: suggestion.recommendation,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        lastSeen: suggestion.last_seen,
      },
      severity: suggestion.monthly_cost > 50 ? 'warning' : 'info',
      relatedMerchant: suggestion.subscription,
      amountImpact: suggestion.monthly_cost,
      dedupKey: buildDedupKey({
        userId,
        engine: 'insight',
        entity: `waste:${suggestion.subscription}`,
        window,
      }),
    });
  }

  for (const increase of priceIncreases) {
    candidates.push({
      insightType: 'price_increase',
      title: `Price increase detected at ${increase.merchant}`,
      summary: `${increase.merchant} increased from $${increase.previousAmount.toFixed(2)} to $${increase.currentAmount.toFixed(2)} (+${increase.percentChange.toFixed(1)}%).`,
      detail: {
        merchant: increase.merchant,
        previousAmount: increase.previousAmount,
        currentAmount: increase.currentAmount,
        percentChange: increase.percentChange,
        detectedAt: increase.detectedAt,
        confidence: increase.confidence,
      },
      severity: increase.percentChange > 20 ? 'warning' : 'info',
      relatedMerchant: increase.merchant,
      amountImpact: increase.currentAmount - increase.previousAmount,
      dedupKey: buildDedupKey({
        userId,
        engine: 'insight',
        entity: `price_increase:${increase.merchant}`,
        window,
      }),
    });
  }

  for (const drift of categoryDrifts) {
    candidates.push({
      insightType: 'category_drift',
      title: `${drift.direction === 'increase' ? 'Spending up' : 'Spending down'} in ${drift.category}`,
      summary: `Your ${drift.category} spending ${drift.direction === 'increase' ? 'increased' : 'decreased'} by $${drift.absoluteChange.toFixed(2)} (${drift.percentChange.toFixed(0)}%) compared to last period.`,
      detail: {
        category: drift.category,
        previousPeriodSpend: drift.previousPeriodSpend,
        currentPeriodSpend: drift.currentPeriodSpend,
        absoluteChange: drift.absoluteChange,
        percentChange: drift.percentChange,
        direction: drift.direction,
        confidence: drift.confidence,
      },
      severity: drift.absoluteChange > 100 ? 'warning' : 'info',
      relatedMerchant: undefined,
      amountImpact: drift.absoluteChange,
      dedupKey: buildDedupKey({
        userId,
        engine: 'insight',
        entity: `category_drift:${drift.category}`,
        window,
      }),
    });
  }

  const totalCancellationSavings = advisorResult.cancellation_suggestions.reduce(
    (sum, s) => sum + s.monthly_cost,
    0,
  );

  if (totalCancellationSavings > 0) {
    candidates.push({
      insightType: 'found_money',
      title: `Save up to $${totalCancellationSavings.toFixed(2)}/mo`,
      summary: `We found ${advisorResult.cancellation_suggestions.length} subscription(s) you could cancel to save $${totalCancellationSavings.toFixed(2)} per month.`,
      detail: {
        potentialMonthlySavings: totalCancellationSavings,
        subscriptionCount: advisorResult.cancellation_suggestions.length,
        subscriptions: advisorResult.cancellation_suggestions.map((s) => s.subscription),
      },
      severity: totalCancellationSavings > 100 ? 'warning' : 'info',
      relatedMerchant: undefined,
      amountImpact: totalCancellationSavings,
      dedupKey: buildDedupKey({
        userId,
        engine: 'insight',
        entity: 'found_money',
        window,
      }),
    });
  }

  let insightsCreated = 0;
  let insightsDeduped = 0;

  for (const candidate of candidates) {
    const existingResult = await query<{ id: string }>(
      `SELECT id FROM insights
       WHERE dedup_key = $1 AND status = 'active'
       LIMIT 1`,
      [candidate.dedupKey],
    );

    if (existingResult.rows.length > 0) {
      insightsDeduped += 1;
      continue;
    }

    const id = randomUUID();
    await query(
      `INSERT INTO insights (
        id, user_id, insight_type, title, summary, detail,
        severity, status, related_merchant, amount_impact,
        dedup_key, engine_version, rules_version
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'active', $8, $9, $10, $11, $12)`,
      [
        id,
        userId,
        candidate.insightType,
        candidate.title,
        candidate.summary,
        JSON.stringify(candidate.detail),
        candidate.severity,
        candidate.relatedMerchant || null,
        candidate.amountImpact ?? null,
        candidate.dedupKey,
        ENGINE_VERSION,
        RULES_VERSION,
      ],
    );

    insightsCreated += 1;
  }

  const latencyMs = Date.now() - startMs;

  await logInsightRun(userId, {
    insightsGenerated: insightsCreated,
    insightsSuppressed: insightsDeduped,
    latencyMs,
  });

  recordEngineMetric({
    engine: 'insight',
    event: 'generate',
    userId,
    latencyMs,
    count: transactions.length,
  });

  return {
    insightsCreated,
    insightsDeduped,
    latencyMs,
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
  };
}
