import "server-only";
import type { SanitizedAiTransaction } from "@/security/aiDataSanitizer";

export type NormalizedSpendTransaction = SanitizedAiTransaction;

export interface CategorySpendSummary {
  category: string;
  total_spend: number;
  transaction_count: number;
  average_transaction: number;
}

export interface MerchantSpendSummary {
  merchant: string;
  merchant_group: string;
  total_spend: number;
  transaction_count: number;
  last_seen: string;
}

export interface SpendAnalysisResult {
  total_spend: number;
  total_transactions: number;
  currency: string;
  category_summary: CategorySpendSummary[];
  top_merchants: MerchantSpendSummary[];
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeSpendingByCategory(
  transactions: NormalizedSpendTransaction[],
): CategorySpendSummary[] {
  const bucket = new Map<
    string,
    { total: number; count: number }
  >();

  for (const tx of transactions) {
    if (tx.pending) continue;
    const key = tx.category?.trim().toLowerCase() || "uncategorized";
    const current = bucket.get(key) || { total: 0, count: 0 };
    current.total += Math.abs(tx.amount);
    current.count += 1;
    bucket.set(key, current);
  }

  return [...bucket.entries()]
    .map(([category, value]) => ({
      category,
      total_spend: roundCurrency(value.total),
      transaction_count: value.count,
      average_transaction: roundCurrency(value.total / Math.max(value.count, 1)),
    }))
    .sort((a, b) => b.total_spend - a.total_spend);
}

export function identifyTopMerchants(
  transactions: NormalizedSpendTransaction[],
  limit = 5,
): MerchantSpendSummary[] {
  const bucket = new Map<
    string,
    {
      merchant: string;
      total: number;
      count: number;
      lastSeen: string;
    }
  >();

  for (const tx of transactions) {
    if (tx.pending) continue;
    const key = tx.merchant_group?.trim().toLowerCase() || "unknown-merchant";
    const current = bucket.get(key) || {
      merchant: tx.merchant || "Unknown Merchant",
      total: 0,
      count: 0,
      lastSeen: tx.date,
    };
    current.total += Math.abs(tx.amount);
    current.count += 1;
    if (Date.parse(tx.date) > Date.parse(current.lastSeen)) {
      current.lastSeen = tx.date;
      if (tx.merchant.trim()) {
        current.merchant = tx.merchant;
      }
    }
    bucket.set(key, current);
  }

  return [...bucket.entries()]
    .map(([merchantGroup, value]) => ({
      merchant: value.merchant,
      merchant_group: merchantGroup,
      total_spend: roundCurrency(value.total),
      transaction_count: value.count,
      last_seen: value.lastSeen,
    }))
    .sort((a, b) => b.total_spend - a.total_spend)
    .slice(0, Math.max(1, limit));
}

export function analyzeSpending(
  transactions: NormalizedSpendTransaction[],
  options?: { topMerchantLimit?: number },
): SpendAnalysisResult {
  const settled = transactions.filter((tx) => !tx.pending);
  const totalSpend = settled.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  return {
    total_spend: roundCurrency(totalSpend),
    total_transactions: settled.length,
    currency: "USD",
    category_summary: summarizeSpendingByCategory(settled),
    top_merchants: identifyTopMerchants(
      settled,
      options?.topMerchantLimit ?? 5,
    ),
  };
}
