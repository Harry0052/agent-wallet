"use client";

import { Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/utils";
import {
  fetchUnifiedStatement,
  fetchSuspectedSubscriptions,
  type DetectedSubscription,
  type StatementTransaction,
} from "@/services/statements";
import {
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import { ManualEntryModal } from "@/components/finance/ManualDataControls";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { MANUAL_STORAGE_KEYS } from "@/lib/manualMode";
import { normalizeTransactionType } from "@/lib/manualTransactions";

type ReportType = "overview" | "cashflow" | "income" | "expenses";
type RecordType = "income" | "expense" | "transfer";

interface ManualReportEntry {
  id: string;
  label: string;
  type: "income" | "expense";
  amount: number;
  date: string;
}

interface ManualCashflowEntry {
  id: string;
  label: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  occurredAt: string;
}

interface ManualBudgetRow {
  id: string;
  label?: string;
  category?: string;
  budget?: number;
  plannedAmount?: number;
  actual?: number;
  manualActual?: number;
  type?: "income" | "fixed" | "variable";
  group?: "income" | "fixed" | "variable";
  month?: string;
  isSpendingCategory?: boolean;
}

interface ManualRecurringItem extends DetectedSubscription {
  cashflowType?: "income" | "expense" | "transfer";
  manualType?: string;
  autopopulateForecast?: boolean;
  category?: string;
}

interface SourceRecord {
  id: string;
  label: string;
  type: RecordType;
  amount: number;
  dateISO: string;
  sourceLabel: string;
  category?: string;
}

interface AggregateTotals {
  income: number;
  expenses: number;
  transfer: number;
  net: number;
  savingsRate: number;
}

const REPORT_TABS: Array<{ key: ReportType; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "cashflow", label: "Cash Flow" },
  { key: "income", label: "Income" },
  { key: "expenses", label: "Expenses" },
];

const sankeyLinks = [
  {
    key: "income-center",
    d: "M 74 128 C 205 128, 296 128, 438 128 L 438 170 C 296 170, 205 170, 74 170 Z",
  },
  {
    key: "center-expenses",
    d: "M 462 88 C 592 88, 706 72, 840 72 L 840 112 C 706 112, 592 136, 462 150 Z",
  },
  {
    key: "center-saved",
    d: "M 462 150 C 592 164, 706 186, 840 186 L 840 210 C 706 210, 592 202, 462 194 Z",
  },
];

function formatDateOnly(dateISO: string): string {
  const date = new Date(dateISO);
  if (Number.isNaN(date.getTime())) return dateISO;
  return date.toISOString().slice(0, 10);
}

function startOfCurrentMonthISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

function monthKeyToISOStart(month?: string): string {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return startOfCurrentMonthISO();
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return startOfCurrentMonthISO();
  return new Date(year, monthIndex, 1).toISOString();
}

function recurringKind(recurring: DetectedSubscription): RecordType {
  const maybeManual = recurring as ManualRecurringItem;
  if (maybeManual.cashflowType === "income") return "income";
  if (maybeManual.cashflowType === "transfer") return "transfer";
  return "expense";
}

function toTotals(records: SourceRecord[]): AggregateTotals {
  const income = records
    .filter((record) => record.type === "income")
    .reduce((sum, record) => sum + record.amount, 0);
  const expenses = records
    .filter((record) => record.type === "expense")
    .reduce((sum, record) => sum + record.amount, 0);
  const transfer = records
    .filter((record) => record.type === "transfer")
    .reduce((sum, record) => sum + record.amount, 0);

  const net = income - expenses;
  const savingsRate = income > 0 ? Math.round((net / income) * 100) : 0;

  return { income, expenses, transfer, net, savingsRate };
}

function MetricCard(props: {
  label: string;
  value: string;
  tone?: "income" | "expense" | "neutral";
  meta: string;
}) {
  const toneClassName =
    props.tone === "income"
      ? "text-[var(--aw-success)]"
      : props.tone === "expense"
        ? "text-[var(--aw-danger)]"
        : "text-[var(--aw-text)]";

  return (
    <div className="aw-card">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
        {props.label}
      </p>
      <p className={`aw-number mt-3 text-[30px] leading-none ${toneClassName}`}>{props.value}</p>
      <p className="mt-3 text-sm text-[var(--aw-text-muted)]">{props.meta}</p>
    </div>
  );
}

function SankeyVisualization(props: {
  income: number;
  expenses: number;
  net: number;
  reportType: ReportType;
}) {
  const saved = Math.max(props.net, 0);

  const sankeyNodes = [
    { key: "income", label: "Income", value: fmt(props.income), color: "var(--aw-chart-positive)", x: 40, y: 84, height: 88 },
    { key: "center", label: "Cash flow", value: fmt(props.net), color: "var(--aw-chart-primary)", x: 438, y: 62, height: 132 },
    { key: "expenses", label: "Expenses", value: fmt(props.expenses), color: "var(--aw-chart-negative)", x: 840, y: 56, height: 72 },
    { key: "saved", label: "Saved", value: fmt(saved), color: "var(--aw-chart-positive)", x: 840, y: 164, height: 48 },
  ];

  const title =
    props.reportType === "income"
      ? "Income focus"
      : props.reportType === "expenses"
        ? "Expense focus"
        : "All sources";

  return (
    <div className="aw-card overflow-hidden bg-[linear-gradient(180deg,var(--aw-surface-1)_0%,var(--aw-surface-subtle)_100%)]">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">
            Cash flow map
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--aw-text)]">
            {title}
          </h3>
        </div>
        <div className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--aw-text-muted)]">
          Connected + manual
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="grid gap-3">
          <div className="aw-card !p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
              Incoming
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-[var(--aw-success)]" />
              <span className="text-sm text-[var(--aw-text)]">Income streams</span>
            </div>
            <p className="aw-number mt-4 text-2xl text-[var(--aw-success)]">{fmt(props.income)}</p>
          </div>
          <div className="aw-card !p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
              Outgoing
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-[var(--aw-danger)]" />
              <span className="text-sm text-[var(--aw-text)]">Expenses and allocations</span>
            </div>
            <p className="aw-number mt-4 text-2xl text-[var(--aw-danger)]">{fmt(props.expenses)}</p>
          </div>
        </div>

        <div className="aw-card !overflow-hidden !p-4">
          <svg viewBox="0 0 940 270" className="h-[320px] w-full">
            <defs>
              <linearGradient id="incomeFlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(253,186,116,0.24)" />
                <stop offset="100%" stopColor="rgba(251,207,232,0.18)" />
              </linearGradient>
              <linearGradient id="expenseFlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(251,207,232,0.2)" />
                <stop offset="100%" stopColor="rgba(239,68,68,0.18)" />
              </linearGradient>
              <linearGradient id="savedFlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(253,186,116,0.2)" />
                <stop offset="100%" stopColor="rgba(253,230,138,0.24)" />
              </linearGradient>
            </defs>

            <rect x="0" y="0" width="940" height="270" rx="20" fill="var(--aw-surface-subtle)" />
            <path d={sankeyLinks[0].d} fill="url(#incomeFlow)" />
            <path d={sankeyLinks[1].d} fill="url(#expenseFlow)" />
            <path d={sankeyLinks[2].d} fill="url(#savedFlow)" />

            {sankeyNodes.map((node) => (
              <g key={node.key}>
                <rect x={node.x} y={node.y} width="22" height={node.height} rx="11" fill={node.color} />
                <text x={node.x + 34} y={node.y + 16} fill="var(--aw-text-muted)" fontSize="12" fontWeight="600" letterSpacing="0.08em">
                  {node.label.toUpperCase()}
                </text>
                <text x={node.x + 34} y={node.y + 42} fill="var(--aw-text)" fontSize="22" fontWeight="600">
                  {node.value}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

function ManualReportActions(props: {
  onConnect: () => void;
  onAddTransaction: () => void;
  onCreateIncome: () => void;
  onCreateExpense: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={props.onConnect}
        className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
      >
        Connect an account
      </button>
      <button
        type="button"
        onClick={props.onAddTransaction}
        className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
      >
        Add manual transactions
      </button>
      <button
        type="button"
        onClick={props.onCreateIncome}
        className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
      >
        Create manual income
      </button>
      <button
        type="button"
        onClick={props.onCreateExpense}
        className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
      >
        Create manual expenses
      </button>
    </div>
  );
}

function TransactionsPanel(props: {
  rows: SourceRecord[];
  onConnect: () => void;
  onAddTransaction: () => void;
  onCreateIncome: () => void;
  onCreateExpense: () => void;
}) {
  if (props.rows.length === 0) {
    return (
      <WorkspaceEmpty
        title="No report transactions yet"
        description="Add manual entries to generate report rows even without connected accounts."
        action={(
          <ManualReportActions
            onConnect={props.onConnect}
            onAddTransaction={props.onAddTransaction}
            onCreateIncome={props.onCreateIncome}
            onCreateExpense={props.onCreateExpense}
          />
        )}
        className="min-h-[240px]"
      />
    );
  }

  return (
    <div className="aw-card-table">
      <div className="grid grid-cols-[minmax(0,1.2fr)_170px_120px_120px] gap-4 border-b border-[var(--aw-border)] px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
        <span>Transaction</span>
        <span>Source</span>
        <span>Date</span>
        <span className="text-right">Amount</span>
      </div>
      {props.rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(0,1.2fr)_170px_120px_120px] gap-4 border-t border-[var(--aw-border)] px-5 py-4 first:border-t-0 hover:bg-[var(--aw-primary-soft)]/40"
        >
          <div>
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-[var(--aw-text)]">{row.label}</p>
              <span className="aw-pill">{row.type}</span>
            </div>
            <p className="mt-1 text-xs text-[var(--aw-text-muted)]">{row.category || "General"}</p>
          </div>
          <span className="text-sm text-[var(--aw-text-muted)]">{row.sourceLabel}</span>
          <span className="text-sm text-[var(--aw-text-muted)]">{formatDateOnly(row.dateISO)}</span>
          <span
            className={`aw-number text-right text-sm ${
              row.type === "income"
                ? "text-[var(--aw-success)]"
                : row.type === "transfer"
                  ? "text-[var(--aw-primary)]"
                  : "text-[var(--aw-text)]"
            }`}
          >
            {fmt(row.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SummaryPanel(props: {
  totals: AggregateTotals;
  connectedTotals: AggregateTotals;
  manualTotals: AggregateTotals;
  recurringTotals: AggregateTotals;
  budgetTotals: AggregateTotals;
}) {
  const rows = [
    { label: "Connected records", value: fmt(props.connectedTotals.net) },
    { label: "Manual records", value: fmt(props.manualTotals.net) },
    { label: "Recurring signals", value: fmt(props.recurringTotals.net) },
    { label: "Manual budget actuals", value: fmt(props.budgetTotals.net) },
  ];

  return (
    <div className="aw-card aw-card-compact">
      <p className="text-sm font-semibold text-[var(--aw-text)]">Summary panel</p>
      <p className="mt-1 text-sm leading-6 text-[var(--aw-text-muted)]">
        Report totals include connected and manual transactions, recurring items, and manual budget actuals.
      </p>

      <div className="mt-5 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-[var(--aw-text-muted)]">{row.label}</span>
            <span className="aw-number text-[var(--aw-text)]">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-[var(--aw-text-muted)]">Net income</span>
          <span className="aw-number text-[var(--aw-text)]">{fmt(props.totals.net)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-[var(--aw-text-muted)]">Savings rate</span>
          <span className="aw-number text-[var(--aw-text)]">{props.totals.savingsRate}%</span>
        </div>
      </div>
    </div>
  );
}

export function ReportsView() {
  const [reportType, setReportType] = useState<ReportType>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [connectedTransactions, setConnectedTransactions] = useState<StatementTransaction[]>([]);
  const [connectedRecurring, setConnectedRecurring] = useState<DetectedSubscription[]>([]);

  const [manualTransactions, setManualTransactions] = useLocalStorageState<StatementTransaction[]>(
    MANUAL_STORAGE_KEYS.transactions,
    [],
  );
  const [manualCashflowEntries] = useLocalStorageState<ManualCashflowEntry[]>(
    MANUAL_STORAGE_KEYS.cashflow,
    [],
  );
  const [manualReportEntries] = useLocalStorageState<ManualReportEntry[]>(
    MANUAL_STORAGE_KEYS.reports,
    [],
  );
  const [manualRecurringItems] = useLocalStorageState<ManualRecurringItem[]>(
    MANUAL_STORAGE_KEYS.recurring,
    [],
  );
  const [manualBudgetRows] = useLocalStorageState<ManualBudgetRow[]>(
    MANUAL_STORAGE_KEYS.budgets,
    [],
  );

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualLabel, setManualLabel] = useState("");
  const [manualType, setManualType] = useState<RecordType>("expense");
  const [manualCategory, setManualCategory] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualNotes, setManualNotes] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [statementResult, recurringResult] = await Promise.allSettled([
      fetchUnifiedStatement({ page_size: 160 }),
      fetchSuspectedSubscriptions(),
    ]);

    if (statementResult.status === "fulfilled") {
      setConnectedTransactions(statementResult.value.transactions ?? []);
    } else {
      setConnectedTransactions([]);
      const message = statementResult.reason instanceof Error
        ? statementResult.reason.message
        : "Failed to load connected report transactions.";
      const safeNoDataError = /no\s+connected|no\s+account|not\s+connected|empty/i.test(message);
      if (!safeNoDataError) {
        setError(message);
      }
    }

    if (recurringResult.status === "fulfilled") {
      setConnectedRecurring(recurringResult.value);
    } else {
      setConnectedRecurring([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedTransactionRecords = useMemo<SourceRecord[]>(() => {
    return connectedTransactions.map((tx) => ({
      id: `connected-tx-${tx.id}`,
      label: tx.merchant_name || tx.normalized_merchant || "Connected transaction",
      type: normalizeTransactionType(tx),
      amount: Math.abs(tx.amount),
      dateISO: tx.occurred_at,
      sourceLabel: "Connected transactions",
      category: tx.category,
    }));
  }, [connectedTransactions]);

  const manualTransactionRecords = useMemo<SourceRecord[]>(() => {
    return manualTransactions.map((tx) => ({
      id: `manual-tx-${tx.id}`,
      label: tx.merchant_name || tx.normalized_merchant || "Manual transaction",
      type: normalizeTransactionType(tx),
      amount: Math.abs(tx.amount),
      dateISO: tx.occurred_at,
      sourceLabel: "Manual transactions",
      category: tx.category,
    }));
  }, [manualTransactions]);

  const manualCashflowRecords = useMemo<SourceRecord[]>(() => {
    return manualCashflowEntries.map((entry) => ({
      id: `manual-cashflow-${entry.id}`,
      label: entry.label,
      type: entry.type,
      amount: entry.amount,
      dateISO: entry.occurredAt,
      sourceLabel: "Manual cash flow",
      category: entry.category,
    }));
  }, [manualCashflowEntries]);

  const manualReportRecords = useMemo<SourceRecord[]>(() => {
    return manualReportEntries.map((entry) => ({
      id: `manual-report-${entry.id}`,
      label: entry.label,
      type: entry.type,
      amount: entry.amount,
      dateISO: new Date(`${entry.date}T12:00:00.000Z`).toISOString(),
      sourceLabel: "Manual reports",
      category: "Manual report",
    }));
  }, [manualReportEntries]);

  const connectedRecurringRecords = useMemo<SourceRecord[]>(() => {
    return connectedRecurring
      .filter((item) => item.lifecycle_status !== "ignored" && item.lifecycle_status !== "inactive")
      .map((item) => ({
        id: `connected-recurring-${item.id}`,
        label: item.merchant,
        type: recurringKind(item),
        amount: item.estimated_monthly_cost,
        dateISO: item.last_seen || startOfCurrentMonthISO(),
        sourceLabel: "Connected recurring",
        category: item.recurrence_interval,
      }));
  }, [connectedRecurring]);

  const manualRecurringRecords = useMemo<SourceRecord[]>(() => {
    return manualRecurringItems.map((item) => ({
      id: `manual-recurring-${item.id}`,
      label: item.merchant,
      type: recurringKind(item),
      amount: item.estimated_monthly_cost,
      dateISO: item.last_seen || startOfCurrentMonthISO(),
      sourceLabel: "Manual recurring",
      category: item.recurrence_interval,
    }));
  }, [manualRecurringItems]);

  const budgetRecords = useMemo<SourceRecord[]>(() => {
    return manualBudgetRows.map((row) => ({
      id: `manual-budget-${row.id}`,
      label: row.category || row.label || "Manual budget",
      type: (row.group || row.type) === "income" ? "income" : "expense",
      amount: (row.manualActual ?? row.actual ?? 0) > 0
        ? (row.manualActual ?? row.actual ?? 0)
        : (row.plannedAmount ?? row.budget ?? 0),
      dateISO: monthKeyToISOStart(row.month),
      sourceLabel: "Manual budget",
      category: row.group || row.type || "variable",
    }));
  }, [manualBudgetRows]);

  const allRecords = useMemo<SourceRecord[]>(() => {
    return [
      ...connectedTransactionRecords,
      ...manualTransactionRecords,
      ...manualCashflowRecords,
      ...manualReportRecords,
      ...connectedRecurringRecords,
      ...manualRecurringRecords,
      ...budgetRecords,
    ].sort((a, b) => Date.parse(b.dateISO) - Date.parse(a.dateISO));
  }, [
    budgetRecords,
    connectedRecurringRecords,
    connectedTransactionRecords,
    manualCashflowRecords,
    manualRecurringRecords,
    manualReportRecords,
    manualTransactionRecords,
  ]);

  const visibleRecords = useMemo(() => {
    if (reportType === "income") return allRecords.filter((record) => record.type === "income");
    if (reportType === "expenses") return allRecords.filter((record) => record.type === "expense");
    return allRecords;
  }, [allRecords, reportType]);

  const totals = useMemo(() => toTotals(allRecords), [allRecords]);
  const viewTotals = useMemo(() => toTotals(visibleRecords), [visibleRecords]);

  const connectedTotals = useMemo(
    () => toTotals([...connectedTransactionRecords, ...connectedRecurringRecords]),
    [connectedRecurringRecords, connectedTransactionRecords],
  );
  const manualTotals = useMemo(
    () => toTotals([...manualTransactionRecords, ...manualCashflowRecords, ...manualReportRecords]),
    [manualCashflowRecords, manualReportRecords, manualTransactionRecords],
  );
  const recurringTotals = useMemo(
    () => toTotals([...connectedRecurringRecords, ...manualRecurringRecords]),
    [connectedRecurringRecords, manualRecurringRecords],
  );
  const budgetTotals = useMemo(() => toTotals(budgetRecords), [budgetRecords]);

  const openManualTransaction = (presetType?: RecordType) => {
    if (presetType) {
      setManualType(presetType === "transfer" ? "expense" : presetType);
    }
    setManualModalOpen(true);
  };

  const addManualTransaction = () => {
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

    const signedAmount = manualType === "income" ? Math.abs(amount) : -Math.abs(amount);

    setManualTransactions((prev) => [
      {
        id: `manual-report-${Date.now()}`,
        user_id: "manual",
        linked_account_id: "manual",
        merchant_name: label,
        normalized_merchant: label.toLowerCase(),
        amount: signedAmount,
        currency: "USD",
        category: manualCategory.trim() || "Manual",
        pending: false,
        occurred_at: new Date(`${manualDate}T12:00:00.000Z`).toISOString(),
        transaction_type: manualType,
        notes: manualNotes.trim() || undefined,
        sourceType: "manual",
      },
      ...prev,
    ]);

    setManualLabel("");
    setManualAmount("");
    setManualCategory("");
    setManualDate(new Date().toISOString().slice(0, 10));
    setManualType("expense");
    setManualNotes("");
    setManualModalOpen(false);
  };

  if (loading) {
    return (
      <div className="aw-workspace-page flex items-center justify-center py-32">
        <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
      </div>
    );
  }

  return (
    <div className="aw-workspace-page">
      <WorkspaceHeader
        title="Reports"
        actions={(
          <button
            type="button"
            onClick={() => openManualTransaction()}
            className="aw-button-primary inline-flex h-[38px] items-center gap-1.5 rounded-xl px-4 text-sm"
          >
            <Plus size={14} />
            Add manual transactions
          </button>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="aw-segmented">
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              data-active={reportType === tab.key}
              onClick={() => setReportType(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-[var(--aw-border)] bg-white px-4 py-3 text-sm text-[var(--aw-text)]">
          {error}
        </div>
      ) : null}

      <div className="aw-workspace-grid" data-columns="4">
        <MetricCard label="Total income" value={fmt(totals.income)} tone="income" meta="All connected + manual sources" />
        <MetricCard label="Total expenses" value={fmt(totals.expenses)} tone="expense" meta="All connected + manual sources" />
        <MetricCard label="Net income" value={fmt(totals.net)} tone="neutral" meta="Income minus expenses" />
        <MetricCard label="Savings rate" value={`${totals.savingsRate}%`} tone="neutral" meta="Across all report sources" />
      </div>

      <WorkspacePanel className="mt-4" title="Main visualization">
        {allRecords.length === 0 ? (
          <WorkspaceEmpty
            title="No report data yet"
            description="Reports can run without connected accounts using manual transactions, manual budgets, and manual recurring items."
            action={(
              <ManualReportActions
                onConnect={() => {
                  window.location.href = "/connect";
                }}
                onAddTransaction={() => openManualTransaction()}
                onCreateIncome={() => openManualTransaction("income")}
                onCreateExpense={() => openManualTransaction("expense")}
              />
            )}
            className="min-h-[260px]"
          />
        ) : (
          <SankeyVisualization
            income={viewTotals.income}
            expenses={viewTotals.expenses}
            net={viewTotals.net}
            reportType={reportType}
          />
        )}
      </WorkspacePanel>

      <div className="aw-workspace-grid mt-4" data-columns="2-1">
        <WorkspacePanel title="Transactions panel">
          <TransactionsPanel
            rows={visibleRecords}
            onConnect={() => {
              window.location.href = "/connect";
            }}
            onAddTransaction={() => openManualTransaction()}
            onCreateIncome={() => openManualTransaction("income")}
            onCreateExpense={() => openManualTransaction("expense")}
          />
        </WorkspacePanel>

        <SummaryPanel
          totals={totals}
          connectedTotals={connectedTotals}
          manualTotals={manualTotals}
          recurringTotals={recurringTotals}
          budgetTotals={budgetTotals}
        />
      </div>

      <ManualEntryModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Add manual transaction"
        description="Create a manual transaction for reports."
      >
        <div className="space-y-4">
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Label</span>
            <input
              value={manualLabel}
              onChange={(event) => setManualLabel(event.target.value)}
              className="aw-input h-10 text-sm"
              placeholder="Consulting invoice"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Type</span>
              <select
                value={manualType}
                onChange={(event) => setManualType(event.target.value as RecordType)}
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
                placeholder="Income"
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

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Notes</span>
            <textarea
              value={manualNotes}
              onChange={(event) => setManualNotes(event.target.value)}
              className="aw-input min-h-[92px] py-2 text-sm"
              placeholder="Optional notes"
            />
          </label>

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
              onClick={addManualTransaction}
              className="aw-button-primary h-10 px-4 text-sm"
            >
              Save transaction
            </button>
          </div>
        </div>
      </ManualEntryModal>
    </div>
  );
}
