import { fmt } from "@/lib/utils";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";
import type { StatementTransaction } from "@/services/statements";
import {
  buildBudgetCategoryProgress,
  buildEstimatedNetWorthSeries,
  buildRecentTransactions,
  buildSpendingComparisonSeries,
  summarizeAccounts,
  summarizeCurrentMonthTransactions,
} from "@/lib/financialTypes";

const DAY_COUNT = 30;

/** Empty placeholder arrays — widgets check length to decide empty state */
export const placeholderSpending: Array<{ day: number; thisMonth: number; lastMonth: number }> = [];

export const placeholderNetWorth: Array<{ label: string; value: number }> = [];

export function toCurrency(value: number): string {
  return fmt(Number.isFinite(value) ? value : 0);
}

export function buildSpendingDataset(
  transactions: DashboardWidgetProps["dataSource"]["transactions"],
  live: boolean,
) {
  if (!live || transactions.length === 0) {
    return placeholderSpending;
  }
  return buildSpendingComparisonSeries(transactions, { dayCount: DAY_COUNT });
}

export function buildNetWorthDataset(
  accounts: DashboardWidgetProps["dataSource"]["accounts"],
  transactions: DashboardWidgetProps["dataSource"]["transactions"],
  live: boolean,
) {
  if (!live || accounts.length === 0) {
    return placeholderNetWorth;
  }
  return buildEstimatedNetWorthSeries(accounts, transactions);
}

export function buildBudgetCategories(
  transactions: DashboardWidgetProps["dataSource"]["transactions"],
  monthlyBudget: number,
  live: boolean,
) {
  if (!live || transactions.length === 0 || monthlyBudget <= 0) {
    return [];
  }
  return buildBudgetCategoryProgress(transactions, monthlyBudget);
}

export function buildDashboardSummary(props: DashboardWidgetProps) {
  const { wallet, dataSource, accountsConnected, useLiveData } = props;
  const live = useLiveData && accountsConnected;
  const accountSummary = summarizeAccounts(dataSource.accounts);
  const monthSummary = summarizeCurrentMonthTransactions(dataSource.transactions);
  const spending = buildSpendingDataset(dataSource.transactions, live);
  const netWorth =
    live && dataSource.accounts.length > 0
      ? buildNetWorthDataset(dataSource.accounts, dataSource.transactions, live)
      : placeholderNetWorth;
  const monthlyBudget = wallet?.settings.monthlyBudget ?? 0;
  const budgetCategories = buildBudgetCategories(dataSource.transactions, monthlyBudget, live);
  const previousNetWorth = netWorth[Math.max(0, netWorth.length - 2)]?.value ?? accountSummary.netWorth;
  const netWorthDelta = live ? accountSummary.netWorth - previousNetWorth : 0;

  return {
    live,
    spending,
    netWorth,
    budgetCategories,
    recentTransactions: buildRecentTransactions(dataSource.transactions),
    netWorthValue: live ? accountSummary.netWorth : 0,
    netWorthDelta,
    monthlyBudget,
    monthIncome: monthSummary.monthIncome,
    monthExpenses: monthSummary.monthExpenses,
    monthNet: monthSummary.monthNet,
    savingsRate: monthSummary.savingsRate,
    monthTransactionCount: monthSummary.monthTransactionCount,
  };
}

export function getCategoryCompletion(transactions: StatementTransaction[]): boolean {
  const categories = new Set(
    transactions
      .map((tx) => (tx.category || "").trim().toLowerCase())
      .filter((value) => value.length > 0 && value !== "uncategorized"),
  );
  return categories.size >= 3;
}

export function describeLiveMode(live: boolean): string {
  return live
    ? "Manual and connected records are driving visible widgets."
    : "Widgets are using polished placeholder states until live data is enabled.";
}
