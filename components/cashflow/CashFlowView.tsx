"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fmt, fmtDate } from "@/lib/utils";
import { SankeyDiagram } from "@/components/cashflow/SankeyDiagram";
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

  const upcomingForecastEntries = useMemo(() => {
    const now = Date.now();
    return recurringForecastEntries
      .filter((entry) => Date.parse(entry.occurredAt) >= now)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
      .slice(0, 6);
  }, [recurringForecastEntries]);

  const rangeLabel = range === "month" ? "this month" : range === "quarter" ? "the last 3 months" : "the last 12 months";

  // Compute range-specific income/expenses for KPI cards
  const rangeIncome = actualRangeEntries
    .filter((e) => e.type === "income")
    .reduce((s, e) => s + e.amount, 0);
  const rangeExpenses = actualRangeEntries
    .filter((e) => e.type === "expense")
    .reduce((s, e) => s + e.amount, 0);
  const rangeNet = rangeIncome - rangeExpenses;
  const rangeSavingsRate = rangeIncome > 0 ? Math.round((rangeNet / rangeIncome) * 100) : 0;

  // Category breakdown for Sankey diagram
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of actualRangeEntries) {
      if (entry.type !== "expense") continue;
      const cat = entry.category || "Uncategorized";
      map.set(cat, (map.get(cat) ?? 0) + entry.amount);
    }
    return [...map.entries()]
      .map(([category, amount]) => ({ category, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount);
  }, [actualRangeEntries]);

  // Income source breakdown for Sankey
  const incomeBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of actualRangeEntries) {
      if (entry.type !== "income") continue;
      const source = entry.label || "Income";
      map.set(source, (map.get(source) ?? 0) + entry.amount);
    }
    return [...map.entries()]
      .map(([source, amount]) => ({ source, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount);
  }, [actualRangeEntries]);

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

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-[var(--aw-surface-1)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">Income</p>
          <p className="aw-number mt-2 text-xl font-semibold text-[var(--aw-success)]">{fmt(rangeIncome)}</p>
        </div>
        <div className="rounded-2xl bg-[var(--aw-surface-1)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">Expenses</p>
          <p className="aw-number mt-2 text-xl font-semibold text-[var(--aw-text)]">{fmt(rangeExpenses)}</p>
        </div>
        <div className="rounded-2xl bg-[var(--aw-surface-1)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">Net</p>
          <p className={`aw-number mt-2 text-xl font-semibold ${rangeNet >= 0 ? "text-[var(--aw-success)]" : "text-[var(--aw-danger)]"}`}>
            {fmt(rangeNet)}
          </p>
        </div>
        <div className="rounded-2xl bg-[var(--aw-surface-1)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">Savings rate</p>
          <p className="aw-number mt-2 text-xl font-semibold text-[var(--aw-text)]">{rangeSavingsRate}%</p>
        </div>
      </div>

      {/* Hero Sankey */}
      <WorkspacePanel
        title="Where your money goes"
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
              Showing cash flow for {rangeLabel}. Income flows left to right into your spending categories.
            </p>
            <div className="rounded-2xl bg-[var(--aw-surface-1)] p-4">
              <SankeyDiagram
                income={Math.round(rangeIncome)}
                expenses={Math.round(rangeExpenses)}
                categoryBreakdown={categoryBreakdown}
                incomeBreakdown={incomeBreakdown}
              />
            </div>
          </>
        )}
      </WorkspacePanel>

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
