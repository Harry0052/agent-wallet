import 'server-only';

import type { StatementTransaction } from '@/transactions/transactionRepository';

export interface CategoryDrift {
  category: string;
  previousPeriodSpend: number;
  currentPeriodSpend: number;
  absoluteChange: number;
  percentChange: number;
  direction: 'increase' | 'decrease';
  confidence: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function categoryKey(tx: StatementTransaction): string {
  return (tx.category || 'uncategorized').trim().toLowerCase();
}

function bucketByCategory(
  transactions: StatementTransaction[],
): Map<string, number> {
  const bucket = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.pending) continue;
    const key = categoryKey(tx);
    const current = bucket.get(key) || 0;
    bucket.set(key, current + Math.abs(tx.amount));
  }
  return bucket;
}

export function detectCategoryDrift(input: {
  transactions: StatementTransaction[];
  currentPeriodDays?: number;
}): CategoryDrift[] {
  const { transactions } = input;
  const periodDays = input.currentPeriodDays ?? 30;

  if (transactions.length === 0) return [];

  const now = Date.now();
  const currentCutoff = now - periodDays * 24 * 60 * 60 * 1000;
  const priorCutoff = currentCutoff - periodDays * 24 * 60 * 60 * 1000;

  const currentPeriod: StatementTransaction[] = [];
  const priorPeriod: StatementTransaction[] = [];

  for (const tx of transactions) {
    const occurredMs = Date.parse(tx.occurred_at);
    if (!Number.isFinite(occurredMs)) continue;

    if (occurredMs >= currentCutoff && occurredMs <= now) {
      currentPeriod.push(tx);
    } else if (occurredMs >= priorCutoff && occurredMs < currentCutoff) {
      priorPeriod.push(tx);
    }
  }

  if (currentPeriod.length === 0 && priorPeriod.length === 0) return [];

  const currentBucket = bucketByCategory(currentPeriod);
  const priorBucket = bucketByCategory(priorPeriod);

  const allCategories = new Set([
    ...currentBucket.keys(),
    ...priorBucket.keys(),
  ]);

  const results: CategoryDrift[] = [];

  for (const category of allCategories) {
    const currentSpend = currentBucket.get(category) || 0;
    const priorSpend = priorBucket.get(category) || 0;

    const absoluteChange = currentSpend - priorSpend;
    const absAbsoluteChange = Math.abs(absoluteChange);

    if (absAbsoluteChange <= 20) continue;

    const base = Math.max(priorSpend, 1);
    const percentChange = (absAbsoluteChange / base) * 100;

    if (percentChange <= 30) continue;

    const txCount =
      currentPeriod.filter((tx) => categoryKey(tx) === category).length +
      priorPeriod.filter((tx) => categoryKey(tx) === category).length;

    const confidence = round2(
      Math.min(0.95, 0.4 + txCount * 0.04),
    );

    results.push({
      category,
      previousPeriodSpend: round2(priorSpend),
      currentPeriodSpend: round2(currentSpend),
      absoluteChange: round2(absAbsoluteChange),
      percentChange: round2(percentChange),
      direction: absoluteChange > 0 ? 'increase' : 'decrease',
      confidence,
    });
  }

  return results
    .sort((a, b) => b.absoluteChange - a.absoluteChange)
    .slice(0, 20);
}
