import type { DetectedSubscription, StatementTransaction } from "@/services/statements";
import type { ConnectedAccountRecord } from "@/services/connect";
import {
  type ManualNetWorthItem,
  type RecordSourceType,
} from "@/lib/manualMode";
import { normalizeTransactionType } from "@/lib/manualTransactions";

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
  /** Number of non-transfer transactions in the current month */
  monthTransactionCount: number;
}

export interface SpendingSeriesPoint {
  day: number;
  thisMonth: number;
  lastMonth: number;
}

export interface NetWorthSeriesPoint {
  label: string;
  value: number;
}

export interface BudgetCategoryProgress {
  category: string;
  spent: number;
  total: number;
  progress: number;
}

const LIABILITY_ACCOUNT_TYPES = new Set<ConnectedAccountRecord["account_type"]>([
  "credit",
  "loan",
]);

function safeAmount(value: number | undefined | null): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function sameMonth(date: Date, reference: Date): boolean {
  return date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth();
}

function transactionSpendAmount(tx: StatementTransaction): number {
  return normalizeTransactionType(tx) === "expense" ? Math.abs(safeAmount(tx.amount)) : 0;
}

function transactionNetAmount(tx: StatementTransaction): number {
  const amount = Math.abs(safeAmount(tx.amount));
  const type = normalizeTransactionType(tx);
  if (type === "income") return amount;
  if (type === "expense") return -amount;
  return 0;
}

export function summarizeAccounts(accounts: ConnectedAccountRecord[]): Pick<
  FinancialSummary,
  "totalAccounts" | "connectedBalance" | "manualBalance" | "netWorth" | "totalAssets" | "totalLiabilities"
> {
  let connectedBalance = 0;
  let manualBalance = 0;
  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const account of accounts) {
    const balance = safeAmount(account.balance);
    const sourceType = account.sourceType ?? "connected";

    if (sourceType === "manual") {
      manualBalance += balance;
    } else {
      connectedBalance += balance;
    }

    const isLiability = LIABILITY_ACCOUNT_TYPES.has(account.account_type) || balance < 0;
    if (isLiability) {
      totalLiabilities += Math.abs(balance);
    } else {
      totalAssets += balance;
    }
  }

  return {
    totalAccounts: accounts.length,
    connectedBalance: Math.round(connectedBalance),
    manualBalance: Math.round(manualBalance),
    netWorth: Math.round(connectedBalance + manualBalance),
    totalAssets: Math.round(totalAssets),
    totalLiabilities: Math.round(totalLiabilities),
  };
}

export function summarizeCurrentMonthTransactions(
  transactions: StatementTransaction[],
  now = new Date(),
): Pick<FinancialSummary, "monthIncome" | "monthExpenses" | "monthNet" | "savingsRate" | "monthTransactionCount"> {
  let monthIncome = 0;
  let monthExpenses = 0;
  let monthTransactionCount = 0;

  for (const tx of transactions) {
    const txDate = new Date(tx.occurred_at);
    if (Number.isNaN(txDate.getTime()) || !sameMonth(txDate, now)) continue;

    const txType = normalizeTransactionType(tx);
    if (txType === "transfer") continue;

    const amount = Math.abs(safeAmount(tx.amount));
    monthTransactionCount += 1;

    if (txType === "income") {
      monthIncome += amount;
    } else {
      monthExpenses += amount;
    }
  }

  const monthNet = monthIncome - monthExpenses;
  const savingsRate = monthIncome > 0 ? Math.round((monthNet / monthIncome) * 100) : 0;

  return {
    monthIncome: Math.round(monthIncome),
    monthExpenses: Math.round(monthExpenses),
    monthNet: Math.round(monthNet),
    savingsRate,
    monthTransactionCount,
  };
}

export function buildSpendingComparisonSeries(
  transactions: StatementTransaction[],
  options?: { now?: Date; dayCount?: number },
): SpendingSeriesPoint[] {
  const now = options?.now ?? new Date();
  const dayCount = options?.dayCount ?? 30;
  const lastMonthReference = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const points = Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    thisMonth: 0,
    lastMonth: 0,
  }));

  for (const tx of transactions) {
    const date = new Date(tx.occurred_at);
    if (Number.isNaN(date.getTime())) continue;

    const day = date.getDate();
    if (day < 1 || day > dayCount) continue;

    const amount = transactionSpendAmount(tx);
    if (amount <= 0) continue;

    const slot = points[day - 1];
    if (sameMonth(date, now)) slot.thisMonth += amount;
    if (sameMonth(date, lastMonthReference)) slot.lastMonth += amount;
  }

  let rollingThisMonth = 0;
  let rollingLastMonth = 0;
  return points.map((point) => {
    rollingThisMonth += point.thisMonth;
    rollingLastMonth += point.lastMonth;
    return {
      day: point.day,
      thisMonth: Math.round(rollingThisMonth),
      lastMonth: Math.round(rollingLastMonth),
    };
  });
}

export function buildEstimatedNetWorthSeries(
  accounts: ConnectedAccountRecord[],
  transactions: StatementTransaction[],
  options?: { now?: Date; monthCount?: number },
): NetWorthSeriesPoint[] {
  const now = options?.now ?? new Date();
  const monthCount = options?.monthCount ?? 6;
  const accountSummary = summarizeAccounts(accounts);
  const monthLabels = Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - index), 1);
    return {
      key: monthKey(date),
      label: date.toLocaleDateString("en-US", { month: "short" }),
    };
  });

  const monthNetByKey = new Map<string, number>();
  for (const tx of transactions) {
    const date = new Date(tx.occurred_at);
    if (Number.isNaN(date.getTime())) continue;

    const key = monthKey(date);
    monthNetByKey.set(key, (monthNetByKey.get(key) ?? 0) + transactionNetAmount(tx));
  }

  let cursor = accountSummary.netWorth;
  const series = Array.from({ length: monthLabels.length }, () => ({ label: "", value: 0 }));
  for (let index = monthLabels.length - 1; index >= 0; index -= 1) {
    const month = monthLabels[index];
    series[index] = {
      label: month.label,
      value: Math.round(cursor),
    };
    cursor -= monthNetByKey.get(month.key) ?? 0;
  }

  return series;
}

export function buildBudgetCategoryProgress(
  transactions: StatementTransaction[],
  monthlyBudget: number,
  options?: { now?: Date; limit?: number },
): BudgetCategoryProgress[] {
  if (monthlyBudget <= 0) return [];

  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 4;
  const grouped = new Map<string, number>();

  for (const tx of transactions) {
    const date = new Date(tx.occurred_at);
    if (Number.isNaN(date.getTime()) || !sameMonth(date, now)) continue;

    const spent = transactionSpendAmount(tx);
    if (spent <= 0) continue;

    const key = (tx.category || "uncategorized").trim().toLowerCase();
    grouped.set(key, (grouped.get(key) ?? 0) + spent);
  }

  return [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category, spent]) => ({
      category: category.replace(/_/g, " "),
      spent: Math.round(spent),
      total: Math.round(monthlyBudget),
      progress: Math.min(100, Math.round((spent / monthlyBudget) * 100)),
    }));
}

export function buildRecentTransactions(
  transactions: StatementTransaction[],
  limit = 6,
): StatementTransaction[] {
  return [...transactions]
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, limit);
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

export function manualNetWorthItemToConnected(item: ManualNetWorthItem): ConnectedAccountRecord {
  return {
    id: item.id,
    user_id: "manual",
    institution_name: "Manual net worth",
    account_type: item.kind === "liability" ? "loan" : "savings",
    mask: "item",
    nickname: item.label,
    last_synced_at: item.updatedAt,
    balance: item.kind === "liability" ? -Math.abs(item.amount) : Math.abs(item.amount),
    sourceType: "manual",
  };
}
