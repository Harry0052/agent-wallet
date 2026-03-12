import "server-only";

import {
  type MerchantTransactionGroup,
  type TransactionSignal,
} from "@/subscription_intelligence/merchantGrouping";

export interface RecurringSubscriptionCandidate {
  merchant: string;
  estimated_monthly_cost: number;
  recurrence_interval: "monthly";
  confidence: number;
  last_seen: string;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function dayDifference(a: string, b: string): number {
  const one = Date.parse(a);
  const two = Date.parse(b);
  if (Number.isNaN(one) || Number.isNaN(two)) return 0;
  const diffMs = Math.abs(two - one);
  return diffMs / (1000 * 60 * 60 * 24);
}

function confidenceScore(input: {
  amountSimilarity: number;
  monthlyIntervalScore: number;
  sampleSize: number;
  pendingRatio: number;
}): number {
  const sampleScore = Math.min(input.sampleSize / 6, 1);
  const nonPendingScore = 1 - Math.min(input.pendingRatio, 1);
  const raw =
    input.amountSimilarity * 0.38
    + input.monthlyIntervalScore * 0.38
    + sampleScore * 0.16
    + nonPendingScore * 0.08;

  const bounded = Math.max(0, Math.min(raw, 0.99));
  return Number(bounded.toFixed(2));
}

function detectFromGroup(
  group: MerchantTransactionGroup,
): RecurringSubscriptionCandidate | null {
  if (group.transactions.length < 3) return null;

  const amounts = group.transactions.map((tx) => Math.abs(tx.amount));
  const medianAmount = median(amounts);
  if (medianAmount <= 0) return null;

  const variation = stdDev(amounts);
  const amountSimilarity = Math.max(
    0,
    Math.min(1, 1 - variation / Math.max(1, medianAmount * 0.2)),
  );

  const intervals: number[] = [];
  for (let i = 1; i < group.transactions.length; i += 1) {
    intervals.push(
      dayDifference(group.transactions[i - 1].occurred_at, group.transactions[i].occurred_at),
    );
  }

  const monthlyHits = intervals.filter(
    (intervalDays) => intervalDays >= 25 && intervalDays <= 40,
  ).length;
  const monthlyIntervalScore = intervals.length > 0 ? monthlyHits / intervals.length : 0;

  const pendingCount = group.transactions.filter((tx) => tx.pending).length;
  const pendingRatio = pendingCount / group.transactions.length;

  const confidence = confidenceScore({
    amountSimilarity,
    monthlyIntervalScore,
    sampleSize: group.transactions.length,
    pendingRatio,
  });

  if (amountSimilarity < 0.55) return null;
  if (monthlyIntervalScore < 0.5) return null;
  if (confidence < 0.6) return null;

  const lastSeen =
    group.transactions[group.transactions.length - 1]?.occurred_at || new Date().toISOString();

  return {
    merchant: group.merchant_display,
    estimated_monthly_cost: Number(medianAmount.toFixed(2)),
    recurrence_interval: "monthly",
    confidence,
    last_seen: lastSeen,
  };
}

export function detectRecurringSubscriptions(
  groups: MerchantTransactionGroup[],
): RecurringSubscriptionCandidate[] {
  return groups
    .map((group) => detectFromGroup(group))
    .filter((candidate): candidate is RecurringSubscriptionCandidate => candidate !== null)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return Date.parse(b.last_seen) - Date.parse(a.last_seen);
    });
}

export function toTransactionSignal(input: {
  merchant_name: string;
  normalized_merchant: string;
  amount: number;
  occurred_at: string;
  pending: boolean;
}): TransactionSignal {
  return {
    merchant_name: input.merchant_name,
    normalized_merchant: input.normalized_merchant,
    amount: input.amount,
    occurred_at: input.occurred_at,
    pending: input.pending,
  };
}
