import { fmt } from "@/lib/utils";
import type { Wallet } from "@/lib/types";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";
import type { StatementTransaction } from "@/services/statements";

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

function dayOfMonth(dateString: string): number | null {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return date.getDate();
}

function sameMonth(dateString: string, monthOffset = 0): boolean {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  return date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth();
}

function transactionSpendAmount(tx: StatementTransaction): number {
  const amount = Number(tx.amount) || 0;
  return amount < 0 ? Math.abs(amount) : 0;
}

export function buildSpendingDataset(transactions: StatementTransaction[], live: boolean) {
  if (!live || transactions.length === 0) {
    return placeholderSpending;
  }

  const points = Array.from({ length: DAY_COUNT }, (_, index) => ({
    day: index + 1,
    thisMonth: 0,
    lastMonth: 0,
  }));

  for (const tx of transactions) {
    const day = dayOfMonth(tx.occurred_at);
    if (!day || day > DAY_COUNT) continue;
    const slot = points[day - 1];
    const amount = transactionSpendAmount(tx);
    if (sameMonth(tx.occurred_at, 0)) slot.thisMonth += amount;
    if (sameMonth(tx.occurred_at, -1)) slot.lastMonth += amount;
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

export function buildNetWorthDataset(wallet: Wallet | null, transactions: StatementTransaction[], live: boolean) {
  if (!live || !wallet || transactions.length === 0) {
    return placeholderNetWorth;
  }

  const now = new Date();
  const monthLabels: Array<{ key: string; label: string }> = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const label = date.toLocaleDateString("en-US", { month: "short" });
    monthLabels.push({ key, label });
  }

  const monthlySpend = new Map<string, number>();
  for (const tx of transactions) {
    const date = new Date(tx.occurred_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    monthlySpend.set(key, (monthlySpend.get(key) ?? 0) + transactionSpendAmount(tx));
  }

  let baseline = wallet.balance + monthLabels.reduce((sum, month) => sum + (monthlySpend.get(month.key) ?? 0), 0);
  return monthLabels.map((month) => {
    const value = Math.max(0, baseline - (monthlySpend.get(month.key) ?? 0));
    baseline = value;
    return {
      label: month.label,
      value: Math.round(value),
    };
  });
}

export function buildBudgetCategories(wallet: Wallet | null, transactions: StatementTransaction[], live: boolean) {
  if (!live || !wallet || transactions.length === 0 || wallet.settings.monthlyBudget <= 0) {
    return [];
  }

  const currentMonthTransactions = transactions.filter((tx) => sameMonth(tx.occurred_at, 0));
  const grouped = new Map<string, number>();

  for (const tx of currentMonthTransactions) {
    const key = tx.category?.trim() || "uncategorized";
    grouped.set(key, (grouped.get(key) ?? 0) + transactionSpendAmount(tx));
  }

  return [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([category, spent]) => ({
      category: category.replace(/_/g, " "),
      spent: Math.round(spent),
      total: wallet.settings.monthlyBudget,
      progress: Math.min(100, Math.round((spent / wallet.settings.monthlyBudget) * 100)),
    }));
}

export function buildDashboardSummary(props: DashboardWidgetProps) {
  const { home, wallet, dataSource, accountsConnected, useLiveData } = props;
  const live = useLiveData && accountsConnected;
  const spending = buildSpendingDataset(dataSource.transactions, live);
  let netWorth = buildNetWorthDataset(wallet, dataSource.transactions, live);
  const budgetCategories = buildBudgetCategories(wallet, dataSource.transactions, live);
  const hasManualAccountBalance = dataSource.accounts.some((account) => typeof account.balance === "number");
  const manualAccountNetWorth = dataSource.accounts.reduce(
    (sum, account) => sum + (typeof account.balance === "number" ? account.balance : 0),
    0,
  );
  const liveNetWorth = live
    ? wallet?.balance ?? (hasManualAccountBalance ? manualAccountNetWorth : home.summary.netCashPosition)
    : 1;

  if (live && !wallet && hasManualAccountBalance) {
    netWorth = placeholderNetWorth.map((point, index) => ({
      ...point,
      value: Math.max(0, Math.round(liveNetWorth * (0.92 + index * 0.02))),
    }));
  }

  const previousNetWorth = netWorth[Math.max(0, netWorth.length - 2)]?.value ?? liveNetWorth;
  const netWorthDelta = live ? liveNetWorth - previousNetWorth : 0;

  return {
    live,
    spending,
    netWorth,
    budgetCategories,
    netWorthValue: live ? liveNetWorth : 1,
    netWorthDelta,
    monthlyBudget: wallet?.settings.monthlyBudget ?? 0,
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
