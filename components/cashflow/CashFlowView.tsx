"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchUnifiedStatement,
  type DetectedSubscription,
  type StatementTransaction,
  type UnifiedStatement,
} from "@/services/statements";
import { fetchConnectedAccountsBundle } from "@/services/connect";
import { fmt, fmtDate } from "@/lib/utils";
import {
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import { ManualEntryModal } from "@/components/finance/ManualDataControls";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { MANUAL_STORAGE_KEYS } from "@/lib/manualMode";
import { normalizeTransactionType } from "@/lib/manualTransactions";

interface ManualCashflowEntry {
  id: string;
  label: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  occurredAt: string;
  sourceType?: "manual";
}

type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

interface ManualRecurringItem extends DetectedSubscription {
  sourceType?: "manual";
  cashflowType?: "income" | "expense" | "transfer";
  manualType?: string;
  title?: string;
  amount?: number;
  frequency?: RecurringFrequency;
  startDate?: string;
  category?: string;
  autopopulateForecast?: boolean;
}

interface CashFlowEntry {
  id: string;
  label: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  category: string;
  occurredAt: string;
  sourceType: "manual" | "connected";
  entryKind?: "actual" | "forecast";
}

interface ChartPoint {
  label: string;
  income: number;
  expense: number;
  net: number;
}

type TimeRange = "month" | "quarter" | "year";

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function normalizeRecurringFrequency(interval?: string): RecurringFrequency {
  if (
    interval === "weekly"
    || interval === "biweekly"
    || interval === "monthly"
    || interval === "quarterly"
    || interval === "annual"
  ) {
    return interval;
  }
  return "monthly";
}

function addRecurringInterval(date: Date, frequency: RecurringFrequency): Date {
  const next = new Date(date);
  if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (frequency === "biweekly") {
    next.setDate(next.getDate() + 14);
  } else if (frequency === "monthly") {
    next.setMonth(next.getMonth() + 1);
  } else if (frequency === "quarterly") {
    next.setMonth(next.getMonth() + 3);
  } else {
    next.setFullYear(next.getFullYear() + 1);
  }
  return next;
}

function recurringEntryType(item: ManualRecurringItem): CashFlowEntry["type"] {
  if (item.cashflowType === "income") return "income";
  if (item.cashflowType === "transfer") return "transfer";
  return "expense";
}

function recurringStartDate(item: ManualRecurringItem): Date {
  const start = item.startDate
    || item.explanation?.first_seen
    || item.last_seen
    || new Date().toISOString();

  const parsed = item.startDate
    ? new Date(`${item.startDate}T12:00:00.000Z`)
    : new Date(start);

  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function buildRecurringForecastEntries(items: ManualRecurringItem[]): CashFlowEntry[] {
  const now = new Date();
  const entries: CashFlowEntry[] = [];

  for (const item of items) {
    if (item.autopopulateForecast === false) continue;

    const frequency = normalizeRecurringFrequency(item.frequency || item.recurrence_interval);
    const amount = Math.abs(item.amount ?? item.estimated_monthly_cost ?? 0);
    if (!amount) continue;

    const type = recurringEntryType(item);
    let cursor = recurringStartDate(item);
    let guard = 0;

    while (cursor < now && guard < 300) {
      cursor = addRecurringInterval(cursor, frequency);
      guard += 1;
    }

    let count = 0;
    while (count < 6 && guard < 1000) {
      entries.push({
        id: `forecast-${item.id}-${count}`,
        label: item.title || item.merchant || "Recurring forecast",
        type,
        amount,
        category: item.category || "Recurring forecast",
        occurredAt: cursor.toISOString(),
        sourceType: "manual",
        entryKind: "forecast",
      });
      cursor = addRecurringInterval(cursor, frequency);
      count += 1;
      guard += 1;
    }
  }

  return entries;
}

function inRange(date: Date, range: TimeRange): boolean {
  const now = new Date();
  if (range === "month") {
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }

  if (range === "quarter") {
    const quarterStart = addMonths(startOfMonth(now), -2);
    return date >= quarterStart;
  }

  const yearStart = addMonths(startOfMonth(now), -11);
  return date >= yearStart;
}

function buildChartData(entries: CashFlowEntry[], range: TimeRange): ChartPoint[] {
  const now = new Date();

  if (range === "month") {
    const weekStarts = [1, 8, 15, 22, 29];
    const buckets = weekStarts.map((_day, index) => ({
      key: index,
      label: `Week ${index + 1}`,
      income: 0,
      expense: 0,
    }));

    for (const entry of entries) {
      const date = new Date(entry.occurredAt);
      if (Number.isNaN(date.getTime())) continue;
      if (date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear()) continue;

      const day = date.getDate();
      const weekIndex = day >= 29 ? 4 : day >= 22 ? 3 : day >= 15 ? 2 : day >= 8 ? 1 : 0;
      if (entry.type === "income") {
        buckets[weekIndex].income += entry.amount;
      } else if (entry.type === "expense") {
        buckets[weekIndex].expense += entry.amount;
      }
    }

    return buckets.map((bucket) => ({
      label: bucket.label,
      income: Math.round(bucket.income),
      expense: Math.round(bucket.expense),
      net: Math.round(bucket.income - bucket.expense),
    }));
  }

  const monthCount = range === "quarter" ? 3 : 12;
  const months = Array.from({ length: monthCount }, (_, idx) => {
    const date = addMonths(startOfMonth(now), -(monthCount - 1 - idx));
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const label = date.toLocaleDateString("en-US", { month: "short" });
    return { key, label, income: 0, expense: 0 };
  });

  const monthMap = new Map(months.map((month) => [month.key, month]));

  for (const entry of entries) {
    const date = new Date(entry.occurredAt);
    if (Number.isNaN(date.getTime())) continue;

    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const bucket = monthMap.get(key);
    if (!bucket) continue;

    if (entry.type === "income") {
      bucket.income += entry.amount;
    } else if (entry.type === "expense") {
      bucket.expense += entry.amount;
    }
  }

  return months.map((month) => ({
    label: month.label,
    income: Math.round(month.income),
    expense: Math.round(month.expense),
    net: Math.round(month.income - month.expense),
  }));
}

export function CashFlowView() {
  const [statement, setStatement] = useState<UnifiedStatement | null>(null);
  const [connectedAccountCount, setConnectedAccountCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>("month");

  const [manualEntries, setManualEntries] = useLocalStorageState<ManualCashflowEntry[]>(
    MANUAL_STORAGE_KEYS.cashflow,
    [],
  );
  const [manualTransactions] = useLocalStorageState<StatementTransaction[]>(
    MANUAL_STORAGE_KEYS.transactions,
    [],
  );
  const [manualRecurringItems] = useLocalStorageState<ManualRecurringItem[]>(
    MANUAL_STORAGE_KEYS.recurring,
    [],
  );

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualLabel, setManualLabel] = useState("");
  const [manualType, setManualType] = useState<"income" | "expense">("expense");
  const [manualAmount, setManualAmount] = useState("");
  const [manualCategory, setManualCategory] = useState("");
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualError, setManualError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [statementResult, accountsResult] = await Promise.allSettled([
      fetchUnifiedStatement({ page_size: 120 }),
      fetchConnectedAccountsBundle(),
    ]);

    if (statementResult.status === "fulfilled") {
      setStatement(statementResult.value);
    } else {
      setStatement(null);
      const message = statementResult.reason instanceof Error
        ? statementResult.reason.message
        : "Failed to load cash flow.";
      const safeNoDataError = /no\s+connected|no\s+account|not\s+connected|empty/i.test(message);
      if (!safeNoDataError) {
        setError(message);
      }
    }

    if (accountsResult.status === "fulfilled") {
      setConnectedAccountCount(accountsResult.value.accounts.length);
    } else {
      setConnectedAccountCount(0);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedEntries = useMemo<CashFlowEntry[]>(() => {
    const connectedTx = statement?.transactions ?? [];
    return connectedTx.reduce<CashFlowEntry[]>((rows, tx) => {
        const txType = normalizeTransactionType(tx);
        if (txType !== "income" && txType !== "expense") return rows;

        rows.push({
          id: `connected-${tx.id}`,
          label: tx.merchant_name || tx.normalized_merchant || "Connected transaction",
          type: txType,
          amount: Math.abs(tx.amount),
          category: tx.category || "Uncategorized",
          occurredAt: tx.occurred_at,
          sourceType: "connected",
          entryKind: "actual",
        });
        return rows;
      }, []);
  }, [statement?.transactions]);

  const manualTransactionEntries = useMemo<CashFlowEntry[]>(() => {
    return manualTransactions.reduce<CashFlowEntry[]>((rows, tx) => {
        const txType = normalizeTransactionType(tx);
        if (txType !== "income" && txType !== "expense") return rows;

        rows.push({
          id: `tx-${tx.id}`,
          label: tx.merchant_name || tx.normalized_merchant || "Manual transaction",
          type: txType,
          amount: Math.abs(tx.amount),
          category: tx.category || "Manual",
          occurredAt: tx.occurred_at,
          sourceType: "manual",
          entryKind: "actual",
        });
        return rows;
      }, []);
  }, [manualTransactions]);

  const manualCashflowEntries = useMemo<CashFlowEntry[]>(() => {
    return manualEntries.map((entry) => ({
      id: `cashflow-${entry.id}`,
      label: entry.label,
      type: entry.type,
      amount: entry.amount,
      category: entry.category,
      occurredAt: entry.occurredAt,
      sourceType: "manual",
      entryKind: "actual",
    }));
  }, [manualEntries]);

  const recurringForecastEntries = useMemo<CashFlowEntry[]>(() => {
    return buildRecurringForecastEntries(manualRecurringItems);
  }, [manualRecurringItems]);

  const allEntries = useMemo(() => {
    return [...connectedEntries, ...manualTransactionEntries, ...manualCashflowEntries, ...recurringForecastEntries].sort(
      (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
    );
  }, [connectedEntries, manualCashflowEntries, manualTransactionEntries, recurringForecastEntries]);

  const rangeEntries = useMemo(() => {
    return allEntries.filter((entry) => {
      const date = new Date(entry.occurredAt);
      if (Number.isNaN(date.getTime())) return false;
      return inRange(date, range);
    });
  }, [allEntries, range]);

  const monthEntries = useMemo(() => {
    return allEntries.filter((entry) => {
      const date = new Date(entry.occurredAt);
      return inRange(date, "month");
    });
  }, [allEntries]);

  const monthIncome = monthEntries
    .filter((entry) => entry.type === "income")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const monthExpenses = monthEntries
    .filter((entry) => entry.type === "expense")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const monthNet = monthIncome - monthExpenses;
  const savingsRate = monthIncome > 0 ? Math.round((monthNet / monthIncome) * 100) : 0;
  const incomeEntries = rangeEntries.filter((entry) => entry.type === "income");
  const expenseEntries = rangeEntries.filter((entry) => entry.type === "expense");
  const chartData = useMemo(() => buildChartData(rangeEntries, range), [range, rangeEntries]);

  const openManualEntry = (type?: "income" | "expense") => {
    if (type) setManualType(type);
    setManualModalOpen(true);
  };

  const addManualEntry = () => {
    setManualError(null);
    const label = manualLabel.trim();
    const amount = Number(manualAmount);

    if (!label) {
      setManualError("Label is required.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setManualError("Amount must be greater than zero.");
      return;
    }

    if (!manualDate) {
      setManualError("Date is required.");
      return;
    }

    setManualEntries((prev) => [
      {
        id: `manual-${Date.now()}`,
        label,
        type: manualType,
        amount,
        category: manualCategory.trim() || "Manual",
        occurredAt: new Date(`${manualDate}T12:00:00.000Z`).toISOString(),
        sourceType: "manual",
      },
      ...prev,
    ]);

    setManualLabel("");
    setManualAmount("");
    setManualCategory("");
    setManualDate(new Date().toISOString().slice(0, 10));
    setManualType("expense");
    setManualModalOpen(false);
  };

  if (loading) {
    return (
      <div className="aw-workspace-page flex items-center justify-center py-32">
        <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="aw-workspace-page">
        <div className="rounded-2xl border border-[var(--aw-border)] bg-white px-4 py-3 text-sm text-[var(--aw-text)]">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="aw-workspace-page">
      <WorkspaceHeader
        title="Money In & Out"
        actions={(
          <button
            type="button"
            onClick={() => openManualEntry()}
            className="aw-button-primary inline-flex h-[38px] items-center gap-1.5 rounded-xl px-4 text-sm"
          >
            Add Transaction
          </button>
        )}
      />

      <WorkspacePanel
        title="Income vs expenses"
        action={(
          <div className="aw-toolbar">
            <div className="aw-segmented">
              <button type="button" data-active={range === "month"} onClick={() => setRange("month")}>Monthly</button>
              <button type="button" data-active={range === "quarter"} onClick={() => setRange("quarter")}>Quarterly</button>
              <button type="button" data-active={range === "year"} onClick={() => setRange("year")}>Yearly</button>
            </div>
          </div>
        )}
      >
        {rangeEntries.length === 0 ? (
          <WorkspaceEmpty
            title="No cash flow data yet"
            description={connectedAccountCount === 0
              ? "Connect an account or start adding manual income and expenses."
              : "No cash flow data for this range yet. Add manual entries to continue."}
            action={(
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link href="/connect" className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm">
                  Connect an account
                </Link>
                <button
                  type="button"
                  onClick={() => openManualEntry()}
                  className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                >
                  Add transaction manually
                </button>
              </div>
            )}
            className="min-h-[240px]"
          />
        ) : (
          <>
            <div className="mb-3 flex items-center gap-5">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#86EFAC" }} />
                <span className="text-xs text-[var(--aw-text-muted)]">Income</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#FCA5A5" }} />
                <span className="text-xs text-[var(--aw-text-muted)]">Expenses</span>
              </div>
            </div>
            <div className="h-[280px] rounded-[16px] border border-[var(--aw-border)] bg-white px-3 py-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid stroke="var(--aw-chart-grid)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--aw-text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "var(--aw-text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip
                    formatter={(value, name) => [fmt(Number(value ?? 0)), name === "income" ? "Income" : "Expenses"]}
                    labelStyle={{ color: "var(--aw-text-muted)" }}
                    itemStyle={{ color: "var(--aw-text)" }}
                    contentStyle={{
                      background: "var(--aw-surface-1)",
                      border: "1px solid var(--aw-border)",
                      borderRadius: 12,
                      boxShadow: "0 8px 18px rgba(15,23,42,0.06)",
                    }}
                  />
                  <Bar dataKey="income" fill="#86EFAC" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" fill="#FCA5A5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </WorkspacePanel>

      <div className="aw-workspace-grid mt-4" data-columns="4">
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
            Income
          </p>
          <p className="aw-number mt-3 text-2xl text-[var(--aw-text)]">{fmt(monthIncome)}</p>
          <p className="mt-2 text-sm text-[var(--aw-text-muted)]">This month</p>
        </div>
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
            Expenses
          </p>
          <p className="aw-number mt-3 text-2xl text-[var(--aw-text)]">{fmt(monthExpenses)}</p>
          <p className="mt-2 text-sm text-[var(--aw-text-muted)]">This month</p>
        </div>
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
            Net cash flow
          </p>
          <p
            className={`aw-number mt-3 text-2xl ${
              monthNet >= 0 ? "text-[var(--aw-text)]" : "text-[var(--aw-danger)]"
            }`}
          >
            {fmt(monthNet)}
          </p>
          <p className="mt-2 text-sm text-[var(--aw-text-muted)]">This month</p>
        </div>
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
            Savings rate
          </p>
          <p className="aw-number mt-3 text-2xl text-[var(--aw-text)]">{savingsRate}%</p>
          <p className="mt-2 text-sm text-[var(--aw-text-muted)]">This month</p>
        </div>
      </div>

      <WorkspacePanel className="mt-4" title="Income">
        <div className="aw-card-table">
          {incomeEntries.length === 0 ? (
            <WorkspaceEmpty
              title="No income entries"
              description={connectedAccountCount === 0
                ? "Connect an account or add income manually to populate cash flow for this range."
                : "Add income manually to populate cash flow for this range."}
              action={(
                <div className="flex flex-wrap items-center gap-2">
                  {connectedAccountCount === 0 ? (
                    <Link
                      href="/connect"
                      className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                    >
                      Connect an account
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                    onClick={() => openManualEntry("income")}
                  >
                    Add income manually
                  </button>
                  <button
                    type="button"
                    className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                    onClick={() => openManualEntry()}
                  >
                    Add transaction manually
                  </button>
                </div>
              )}
              className="min-h-[220px] text-[var(--aw-text-muted)]"
            />
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1.4fr)_140px_140px] gap-4 border-b border-[var(--aw-border)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
                <span>Income</span>
                <span>Date</span>
                <span className="text-right">Amount</span>
              </div>
              {incomeEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1.4fr)_140px_140px] gap-4 border-t border-[var(--aw-border)] px-4 py-4 transition hover:bg-[var(--aw-primary-soft)]/40 first:border-t-0"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--aw-text)]">{entry.label}</p>
                      {entry.sourceType === "manual" ? <span className="aw-pill">Manual</span> : null}
                      {entry.entryKind === "forecast" ? <span className="aw-pill">Forecast</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-[var(--aw-text-muted)]">{entry.category}</p>
                  </div>
                  <span className="text-sm text-[var(--aw-text-muted)]">{fmtDate(entry.occurredAt)}</span>
                  <span className="aw-number text-right text-sm text-[var(--aw-success)]">
                    {fmt(entry.amount)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </WorkspacePanel>

      <WorkspacePanel className="mt-4" title="Expenses">
        <div className="aw-card-table">
          {expenseEntries.length === 0 ? (
            <WorkspaceEmpty
              title="No expense entries"
              description={connectedAccountCount === 0
                ? "Connect an account or add expenses manually to populate cash flow for this range."
                : "Add expenses manually to populate cash flow for this range."}
              action={(
                <div className="flex flex-wrap items-center gap-2">
                  {connectedAccountCount === 0 ? (
                    <Link
                      href="/connect"
                      className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                    >
                      Connect an account
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                    onClick={() => openManualEntry("expense")}
                  >
                    Add expense manually
                  </button>
                  <button
                    type="button"
                    className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                    onClick={() => openManualEntry()}
                  >
                    Add transaction manually
                  </button>
                </div>
              )}
              className="min-h-[220px] text-[var(--aw-text-muted)]"
            />
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1.4fr)_140px_140px] gap-4 border-b border-[var(--aw-border)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
                <span>Expense</span>
                <span>Date</span>
                <span className="text-right">Amount</span>
              </div>
              {expenseEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1.4fr)_140px_140px] gap-4 border-t border-[var(--aw-border)] px-4 py-4 transition hover:bg-[var(--aw-primary-soft)]/40 first:border-t-0"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--aw-text)]">{entry.label}</p>
                      {entry.sourceType === "manual" ? <span className="aw-pill">Manual</span> : null}
                      {entry.entryKind === "forecast" ? <span className="aw-pill">Forecast</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-[var(--aw-text-muted)]">{entry.category}</p>
                  </div>
                  <span className="text-sm text-[var(--aw-text-muted)]">{fmtDate(entry.occurredAt)}</span>
                  <span className="aw-number text-right text-sm text-[var(--aw-text)]">
                    {fmt(entry.amount)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </WorkspacePanel>

      <ManualEntryModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Add manual cash flow entry"
        description="Create a local income or expense record."
      >
        <div className="space-y-4">
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Label</span>
            <input
              value={manualLabel}
              onChange={(event) => setManualLabel(event.target.value)}
              className="aw-input h-10 text-sm"
              placeholder="Client invoice"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Type</span>
              <select
                value={manualType}
                onChange={(event) => setManualType(event.target.value as "income" | "expense")}
                className="aw-input h-10 text-sm"
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Amount</span>
              <input
                value={manualAmount}
                onChange={(event) => setManualAmount(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Category</span>
              <input
                value={manualCategory}
                onChange={(event) => setManualCategory(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Salary"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Date</span>
              <input
                value={manualDate}
                onChange={(event) => setManualDate(event.target.value)}
                className="aw-input h-10 text-sm"
                type="date"
              />
            </label>
          </div>

          {manualError ? (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {manualError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setManualModalOpen(false)}
              className="aw-button-secondary h-10 px-4 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addManualEntry}
              className="aw-button-primary h-10 px-4 text-sm"
            >
              Save entry
            </button>
          </div>
        </div>
      </ManualEntryModal>
    </div>
  );
}
