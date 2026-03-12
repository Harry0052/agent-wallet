import "server-only";

import type { NormalizedSpendTransaction } from "@/ai_spend_intelligence/spendAnalyzer";

export interface UnusualCharge {
  merchant: string;
  amount: number;
  occurred_at: string;
  reason: string;
  confidence: number;
}

export interface UnknownMerchantFlag {
  merchant: string;
  normalized_merchant: string;
  first_seen: string;
  amount: number;
  reason: string;
}

export interface AnomalyDetectorResult {
  unusual_charges: UnusualCharge[];
  unknown_merchants: UnknownMerchantFlag[];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function merchantKey(tx: NormalizedSpendTransaction): string {
  return (tx.merchant_group || tx.merchant || "unknown-merchant")
    .trim()
    .toLowerCase();
}

function buildMerchantHistory(transactions: NormalizedSpendTransaction[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const tx of transactions) {
    if (tx.pending) continue;
    const key = merchantKey(tx);
    const list = map.get(key) || [];
    list.push(Math.abs(tx.amount));
    map.set(key, list);
  }
  return map;
}

export function detectAnomalies(
  transactions: NormalizedSpendTransaction[],
): AnomalyDetectorResult {
  const settled = transactions
    .filter((tx) => !tx.pending)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const historyMap = buildMerchantHistory(settled);
  const unusual: UnusualCharge[] = [];
  const unknownMerchants: UnknownMerchantFlag[] = [];

  for (const tx of settled) {
    const key = merchantKey(tx);
    const amounts = historyMap.get(key) || [];
    const absoluteAmount = Math.abs(tx.amount);

    const firstSeen =
      settled.find((candidate) => merchantKey(candidate) === key)?.date
      || tx.date;
    const seenCount = settled.filter((candidate) => merchantKey(candidate) === key).length;

    if (seenCount === 1 && absoluteAmount >= 30) {
      unknownMerchants.push({
        merchant: tx.merchant || "Unknown Merchant",
        normalized_merchant: tx.merchant_group || key,
        first_seen: firstSeen,
        amount: absoluteAmount,
        reason: "Merchant appears only once in available history.",
      });
    }

    if (amounts.length < 3) {
      continue;
    }

    const avg = mean(amounts);
    const deviation = stdDev(amounts);
    const threshold = avg + deviation * 2.5;
    if (deviation < 1) {
      if (absoluteAmount > avg * 1.9 && absoluteAmount - avg >= 10) {
        unusual.push({
          merchant: tx.merchant || "Unknown Merchant",
          amount: absoluteAmount,
          occurred_at: tx.date,
          reason: "Charge is materially higher than normal merchant spend.",
          confidence: 0.79,
        });
      }
      continue;
    }

    if (absoluteAmount > threshold && absoluteAmount - avg >= 8) {
      const zScore = (absoluteAmount - avg) / deviation;
      unusual.push({
        merchant: tx.merchant || "Unknown Merchant",
        amount: absoluteAmount,
        occurred_at: tx.date,
        reason: "Charge exceeds merchant baseline by an unusual margin.",
        confidence: Number(Math.min(0.99, 0.55 + zScore * 0.08).toFixed(2)),
      });
    }
  }

  return {
    unusual_charges: unusual.sort((a, b) => b.amount - a.amount).slice(0, 20),
    unknown_merchants: unknownMerchants
      .sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen))
      .slice(0, 20),
  };
}
