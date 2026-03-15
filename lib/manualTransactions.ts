import type { StatementTransaction } from "@/services/statements";
import { normalizeRecordSourceType } from "@/lib/sourceType";

export type ManualTransactionType = "income" | "expense" | "transfer";

export type ManualTransactionRecord = StatementTransaction & {
  sourceType: "manual";
  transaction_type: ManualTransactionType;
  account_name?: string;
  notes?: string;
  recurring?: boolean;
};

export function normalizeTransactionType(tx: StatementTransaction): ManualTransactionType {
  if (tx.transaction_type === "income" || tx.transaction_type === "expense" || tx.transaction_type === "transfer") {
    return tx.transaction_type;
  }
  return tx.amount >= 0 ? "income" : "expense";
}

export function isManualTransaction(tx: StatementTransaction): tx is ManualTransactionRecord {
  return normalizeRecordSourceType(tx.sourceType, "connected") === "manual";
}

export function shouldIncludeInIncomeExpense(tx: StatementTransaction): boolean {
  return normalizeTransactionType(tx) !== "transfer";
}

export function parseGoalContributionTarget(tx: StatementTransaction): string | null {
  if (normalizeTransactionType(tx) !== "transfer") return null;

  const category = (tx.category || "").trim();
  const notes = (tx.notes || "").trim();
  const merchant = (tx.merchant_name || tx.normalized_merchant || "").trim();

  const goalPrefix = category.match(/^goal\s*:\s*(.+)$/i);
  if (goalPrefix?.[1]) return goalPrefix[1].trim();

  if (/goal/i.test(category) && merchant.length > 0) {
    return merchant;
  }

  const notePrefix = notes.match(/^goal\s*:\s*(.+)$/i);
  if (notePrefix?.[1]) return notePrefix[1].trim();

  return null;
}

export function contributionAmount(tx: StatementTransaction): number {
  return Math.abs(Number(tx.amount) || 0);
}
