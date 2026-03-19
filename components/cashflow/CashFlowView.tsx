"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { useFinancialData } from "@/lib/useFinancialData";
import { ComboboxInput } from "@/components/finance/ComboboxInput";
import { buildCategoryOptions } from "@/lib/formOptions";
import type {
  ManualCashflowEntry,
  ManualRecurringItem,
  CashFlowEntry,
} from "@/lib/financialTypes";

type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

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
  const financialData = useFinancialData();
  const [range, setRange] = useState<TimeRange>("month");

  // Manual cashflow entry form still writes to its own localStorage key.
  // Read value unused — we consume merged data from useFinancialData instead.
  const [, setManualEntries] = useLocalStorageState<ManualCashflowEntry[]>(
    MANUAL_STORAGE_KEYS.cashflow,
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

  const loading = financialData.loading;
  const error = financialData.error;
  const connectedAccountCount = financialData.connectedAccounts.length;

  // Convert all merged transactions to CashFlowEntry format
  const transactionEntries = useMemo<CashFlowEntry[]>(() => {
    return financialData.allTransactions.reduce<CashFlowEntry[]>((rows, tx) => {
      const txType = normalizeTransactionType(tx);
      if (txType !== "income" && txType !== "expense") return rows;

      rows.push({
        id: tx.id,
        label: tx.merchant_name || tx.normalized_merchant || "Transaction",
        type: txType,
        amount: Math.abs(tx.amount),
        category: tx.category || "Uncategorized",
        occurredAt: tx.occurred_at,
        sourceType: tx.sourceType === "manual" ? "manual" : "connected",
        entryKind: "actual",
      });
      return rows;
    }, []);
  }, [financialData.allTransactions]);

  const recurringForecastEntries = useMemo<CashFlowEntry[]>(() => {
    return buildRecurringForecastEntries(manualRecurringItems);
  }, [manualRecurringItems]);

  const actualRangeEntries = useMemo(() => {
    return transactionEntries.filter((entry) => {
      const date = new Date(entry.occurredAt);
      if (Number.isNaN(date.getTime())) return false;
      return inRange(date, range);
    });
  }, [range, transactionEntries]);

  const monthActualEntries = useMemo(() => {
    return transactionEntries.filter((entry) => {
      const date = new Date(entry.occurredAt);
      return inRange(date, "month");
    });
  }, [transactionEntries]);

  const upcomingForecastEntries = useMemo(() => {
    const now = Date.now();
    return recurringForecastEntries
      .filter((entry) => Date.parse(entry.occurredAt) >= now)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
      .slice(0, 6);
  }, [recurringForecastEntries]);

  const monthIncome = monthActualEntries
    .filter((entry) => entry.type === "income")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const monthExpenses = monthActualEntries
    .filter((entry) => entry.type === "expense")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const monthNet = monthIncome - monthExpenses;
  const savingsRate = monthIncome > 0 ? Math.round((monthNet / monthIncome) * 100) : 0;
  const chartData = useMemo(() => buildChartData(actualRangeEntries, range), [actualRangeEntries, range]);
  const rangeLabel = range === "month" ? "this month" : range === "quarter" ? "the last 3 months" : "the last 12 months";

  const openManualEntry = (type?: "income" | "expense") => {
    setManualType(type ?? "expense");
    setManualLabel("");
    setManualAmount("");
    setManualCategory("");
    setManualDate(new Date().toISOString().slice(0, 10));
    setManualError(null);
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
        title="Cash Flow"
        subtitle="Actual posted money in and out, plus your next recurring items."
        actions={(
          <button
            type="button"
            onClick={() => openManualEntry()}
            className="aw-button-primary inline-flex h-[38px] items-center gap-1.5 rounded-xl px-4 text-sm"
          >
            Add cash flow entry
          </button>
        )}
      />

      <WorkspacePanel
        title="Cash flow history"
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
        {actualRangeEntries.length === 0 ? (
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
            <p className="mb-4 text-sm text-[var(--aw-text-muted)]">
              Showing actual income and expenses for {rangeLabel}. Savings rate this month: {savingsRate}%.
            </p>
            <div className="mb-3 flex items-center gap-5">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--aw-chart-positive-fill)" }} />
                <span className="text-xs text-[var(--aw-text-muted)]">Income</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--aw-chart-negative-fill)" }} />
                <span className="text-xs text-[var(--aw-text-muted)]">Expenses</span>
              </div>
            </div>
            <div className="h-[280px] rounded-2xl bg-[var(--aw-surface-1)] px-3 py-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 12, left: 4, bottom: 4 }} barGap={2}>
                  <CartesianGrid stroke="var(--aw-chart-grid)" strokeDasharray="3 4" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--aw-text-muted)", fontSize: 10, fontWeight: 500 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "var(--aw-text-muted)", fontSize: 10, fontWeight: 500 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip
                    formatter={(value, name) => [fmt(Number(value ?? 0)), name === "income" ? "Income" : "Expenses"]}
                    labelStyle={{ color: "var(--aw-text-muted)", fontSize: 11 }}
                    itemStyle={{ color: "var(--aw-text)", fontSize: 12, fontWeight: 500 }}
                    contentStyle={{
                      background: "var(--aw-surface-1)",
                      border: "1px solid var(--aw-border)",
                      borderRadius: 14,
                      boxShadow: "0 4px 16px rgba(17,17,17,0.06)",
                      padding: "10px 14px",
                    }}
                    cursor={{ fill: "rgba(253,186,116,0.06)" }}
                  />
                  <Bar dataKey="income" fill="var(--aw-chart-positive-fill)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expense" fill="var(--aw-chart-negative-fill)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </WorkspacePanel>

      <div className="aw-workspace-grid mt-4" data-columns="2">
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
      </div>

      <WorkspacePanel className="mt-4" title="Upcoming recurring">
        <div className="aw-card-table">
          {upcomingForecastEntries.length === 0 ? (
            <WorkspaceEmpty
              title="No upcoming recurring items"
              description={connectedAccountCount === 0
                ? "Connect an account or add recurring bills and paychecks to preview what is coming next."
                : "Recurring bills and paychecks will appear here when Calico detects them or when you add them manually."}
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
                    className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                    onClick={() => openManualEntry()}
                  >
                    Add cash flow entry
                  </button>
                </div>
              )}
              className="min-h-[220px] text-[var(--aw-text-muted)]"
            />
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1.4fr)_120px_120px_140px] gap-4 border-b border-[var(--aw-border)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
                <span>Item</span>
                <span>Type</span>
                <span>Date</span>
                <span className="text-right">Amount</span>
              </div>
              {upcomingForecastEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1.4fr)_120px_120px_140px] gap-4 border-t border-[var(--aw-border)] px-4 py-4 transition hover:bg-[var(--aw-primary-soft)]/40 first:border-t-0"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--aw-text)]">{entry.label}</p>
                      {entry.entryKind === "forecast" ? <span className="aw-pill">Forecast</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-[var(--aw-text-muted)]">{entry.category}</p>
                  </div>
                  <span className="text-sm text-[var(--aw-text-muted)]">
                    {entry.type === "income" ? "Income" : entry.type === "expense" ? "Expense" : "Transfer"}
                  </span>
                  <span className="text-sm text-[var(--aw-text-muted)]">{fmtDate(entry.occurredAt)}</span>
                  <span
                    className={`aw-number text-right text-sm ${
                      entry.type === "income" ? "text-[var(--aw-success)]" : "text-[var(--aw-text)]"
                    }`}
                  >
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
            <div className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Category</span>
              <ComboboxInput
                value={manualCategory}
                onChange={setManualCategory}
                options={buildCategoryOptions(financialData.connectedTransactions, manualType)}
                placeholder="Select or type a category"
                allowCustom
                customLabel="Add new category"
              />
            </div>
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
