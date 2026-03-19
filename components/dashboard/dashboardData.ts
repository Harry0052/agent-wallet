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

export const placeholderSpending = Array.from({ length: DAY_COUNT }, (_, index) => {
  const day = index + 1;
  const curve = Math.sin(day / 4.3) * 10;
  return {
    day,
    thisMonth: Math.max(0, Math.round(day * 1.6 + curve + (day % 6 === 0 ? 14 : 0))),
    lastMonth: Math.max(0, Math.round(day * 1.35 + Math.cos(day / 5.2) * 12 + (day % 7 === 0 ? 10 : 0))),
  };
});

export const placeholderNetWorth = [
  { label: "Jan", value: 1 },
  { label: "Feb", value: 1 },
  { label: "Mar", value: 1 },
  { label: "Apr", value: 1 },
  { label: "May", value: 1 },
  { label: "Jun", value: 1 },
];

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
