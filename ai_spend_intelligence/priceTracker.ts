import 'server-only';

import type { StatementTransaction } from '@/transactions/transactionRepository';

export interface PriceIncrease {
  merchant: string;
  previousAmount: number;
  currentAmount: number;
  percentChange: number;
  detectedAt: string;
  confidence: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function merchantKey(tx: StatementTransaction): string {
  return (tx.normalized_merchant || tx.merchant_name || 'unknown')
    .trim()
    .toLowerCase();
}

export function detectPriceIncreases(input: {
  transactions: StatementTransaction[];
  subscriptionMerchants: string[];
}): PriceIncrease[] {
  const { transactions, subscriptionMerchants } = input;

  if (subscriptionMerchants.length === 0 || transactions.length === 0) {
    return [];
  }

  const targetSet = new Set(
    subscriptionMerchants.map((m) => m.trim().toLowerCase()),
  );

  const merchantTxMap = new Map<string, StatementTransaction[]>();

  for (const tx of transactions) {
    if (tx.pending || tx.amount <= 0) continue;
    const key = merchantKey(tx);
    if (!targetSet.has(key)) continue;
    const list = merchantTxMap.get(key) || [];
    list.push(tx);
    merchantTxMap.set(key, list);
  }

  const results: PriceIncrease[] = [];

  for (const [key, txs] of merchantTxMap) {
    if (txs.length < 3) continue;

    const sorted = [...txs].sort(
      (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
    );

    const recentTwo = sorted.slice(-2);
    const prior = sorted.slice(0, -2);

    if (prior.length === 0) continue;

    const priorMedian = median(prior.map((tx) => tx.amount));
    if (priorMedian <= 0) continue;

    const recentAvg =
      recentTwo.reduce((sum, tx) => sum + tx.amount, 0) / recentTwo.length;
    const absoluteChange = recentAvg - priorMedian;
    const percentChange = (absoluteChange / priorMedian) * 100;

    if (percentChange <= 5 || absoluteChange <= 1) continue;

    const dataPoints = sorted.length;
    const confidence = round2(
      Math.min(0.95, 0.5 + dataPoints * 0.05),
    );

    results.push({
      merchant: sorted[sorted.length - 1].merchant_name || key,
      previousAmount: round2(priorMedian),
      currentAmount: round2(recentAvg),
      percentChange: round2(percentChange),
      detectedAt: sorted[sorted.length - 1].occurred_at,
      confidence,
    });
  }

  return results
    .sort((a, b) => b.percentChange - a.percentChange)
    .slice(0, 20);
}
