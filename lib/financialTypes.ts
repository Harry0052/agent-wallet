import type { DetectedSubscription, StatementTransaction } from "@/services/statements";
import type { ConnectedAccountRecord } from "@/services/connect";
import type { RecordSourceType } from "@/lib/manualMode";

// ── Shared types used across multiple financial pages ────────────────────────

/** Manual cashflow entry stored in localStorage (calico.manual.cashflow) */
export interface ManualCashflowEntry {
  id: string;
  label: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  occurredAt: string;
  sourceType?: "manual";
}

/** Manual report entry stored in localStorage (calico.manual.reports) */
export interface ManualReportEntry {
  id: string;
  label: string;
  type: "income" | "expense";
  amount: number;
  date: string;
}

/** Manual recurring item extending DetectedSubscription */
export interface ManualRecurringItem extends DetectedSubscription {
  sourceType?: "manual";
  cashflowType?: "income" | "expense" | "transfer";
  manualType?: string;
  title?: string;
  amount?: number;
  frequency?: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  startDate?: string;
  category?: string;
  autopopulateForecast?: boolean;
}

/** Normalized cash flow entry used by charts, tables, and summaries */
export interface CashFlowEntry {
  id: string;
  label: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  category: string;
  occurredAt: string;
  sourceType: RecordSourceType;
  entryKind?: "actual" | "forecast";
}

/** Unified account row used across pages */
export interface UnifiedAccountRow {
  id: string;
  label: string;
  subtitle: string;
  balance: number;
  updatedLabel: string;
  sourceType: RecordSourceType;
  notes?: string;
}

// ── Derived financial summary ────────────────────────────────────────────────

export interface FinancialSummary {
  /** All accounts merged: connected + manual */
  totalAccounts: number;
  /** Sum of connected account balances */
  connectedBalance: number;
  /** Sum of manual account balances */
  manualBalance: number;
  /** Combined net worth (connected + manual) */
  netWorth: number;
  /** Sum of asset balances */
  totalAssets: number;
  /** Sum of liability balances (positive number) */
  totalLiabilities: number;

  /** Current month income from all transaction sources */
  monthIncome: number;
  /** Current month expenses from all transaction sources */
  monthExpenses: number;
  /** Current month net (income - expenses) */
  monthNet: number;
  /** Current month savings rate as percentage */
  savingsRate: number;
}

// ── Merge helpers ────────────────────────────────────────────────────────────

/**
 * Map manual cashflow entries to StatementTransaction shape so they can
 * participate in a unified transaction stream.
 */
export function cashflowToTransactions(entries: ManualCashflowEntry[]): StatementTransaction[] {
  return entries.map((entry) => ({
    id: `cashflow-${entry.id}`,
    user_id: "manual",
    linked_account_id: "manual",
    merchant_name: entry.label,
    normalized_merchant: entry.label,
    amount: entry.type === "expense" ? -Math.abs(entry.amount) : Math.abs(entry.amount),
    currency: "USD",
    category: entry.category || "Manual",
    pending: false,
    occurred_at: entry.occurredAt,
    sourceType: "manual",
  }));
}

/**
 * Map manual report entries to StatementTransaction shape.
 */
export function reportsToTransactions(entries: ManualReportEntry[]): StatementTransaction[] {
  return entries.map((entry) => ({
    id: `report-${entry.id}`,
    user_id: "manual",
    linked_account_id: "manual",
    merchant_name: entry.label,
    normalized_merchant: entry.label,
    amount: entry.type === "expense" ? -Math.abs(entry.amount) : Math.abs(entry.amount),
    currency: "USD",
    category: "Manual report",
    pending: false,
    occurred_at: new Date(`${entry.date}T12:00:00.000Z`).toISOString(),
    sourceType: "manual",
  }));
}

/**
 * Deduplicate transactions by ID, keeping the last occurrence (so manual
 * overrides win when both exist).
 */
export function deduplicateTransactions(
  ...sources: StatementTransaction[][]
): StatementTransaction[] {
  const byId = new Map<string, StatementTransaction>();
  for (const source of sources) {
    for (const tx of source) {
      byId.set(tx.id, tx);
    }
  }
  return [...byId.values()];
}

/**
 * Map a ManualAccountRecord to ConnectedAccountRecord so both sources
 * can be handled with the same shape.
 */
export function manualAccountToConnected(
  account: import("@/lib/manualMode").ManualAccountRecord,
): ConnectedAccountRecord {
  type AccountType = ConnectedAccountRecord["account_type"];
  const typeMap: Record<string, AccountType> = {
    credit: "credit",
    loan: "loan",
    cash: "cash",
    checking: "checking",
    savings: "savings",
    investment: "savings",
    other_asset: "savings",
    other_liability: "loan",
  };
  return {
    id: account.id,
    user_id: "manual",
    institution_name: account.institutionName || "Manual",
    account_type: typeMap[account.type] ?? "savings",
    mask: account.mask ?? "manual",
    nickname: account.name,
    last_synced_at: account.updatedAt,
    balance: account.balance,
    sourceType: "manual",
  };
}
