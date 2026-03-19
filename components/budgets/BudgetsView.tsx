"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, PencilLine, PieChart, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/utils";
import {
  type DetectedSubscription,
} from "@/services/statements";
import {
  ToolbarButton,
  WorkspaceHeader,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import {
  ManualEntryButton,
  ManualEntryModal,
} from "@/components/finance/ManualDataControls";
import { ComboboxInput } from "@/components/finance/ComboboxInput";
import { useFinancialData } from "@/lib/useFinancialData";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { MANUAL_STORAGE_KEYS } from "@/lib/manualMode";
import { normalizeTransactionType } from "@/lib/manualTransactions";

type BudgetGroup = "income" | "fixed" | "variable";

interface LegacyBudgetRowData {
  id: string;
  label: string;
  budget: number;
  actual: number;
  type: BudgetGroup;
}

interface BudgetLineItem {
  id: string;
  month: string; // YYYY-MM
  category: string;
  group: BudgetGroup;
  plannedAmount: number;
  manualActual: number;
  rollover: boolean;
  notes?: string;
  isSpendingCategory: boolean;
}

type StoredBudgetRow = BudgetLineItem | LegacyBudgetRowData;

interface ComputedBudgetLineItem extends BudgetLineItem {
  transactionActual: number;
  combinedActual: number;
  remaining: number;
}

interface ManualRecurringItem extends DetectedSubscription {
  sourceType?: "manual";
  cashflowType?: "income" | "expense" | "transfer";
  startDate?: string;
  autopopulateForecast?: boolean;
}

const DEFAULT_CATEGORIES: Record<BudgetGroup, string[]> = {
  income: ["Paycheck", "Bonus", "Interest", "Freelance", "Other income"],
  fixed: ["Rent", "Mortgage", "Insurance", "Utilities", "Debt payment"],
  variable: ["Groceries", "Dining", "Travel", "Shopping", "Entertainment"],
};

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyFromIso(iso: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return monthKeyFromDate(parsed);
}

function formatMonthTitle(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function shiftMonth(monthKey: string, offset: number): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  return monthKeyFromDate(new Date(year, month - 1 + offset, 1));
}

function normalizeCategory(category: string): string {
  return category.trim().toLowerCase();
}

function recurringItemActiveForMonth(item: ManualRecurringItem, monthKey: string): boolean {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return true;

  const rawStart = item.startDate
    || item.explanation?.first_seen
    || item.last_seen;
  if (!rawStart) return true;

  const startDate = item.startDate
    ? new Date(`${item.startDate}T12:00:00.000Z`)
    : new Date(rawStart);
  if (Number.isNaN(startDate.getTime())) return true;

  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  return startDate <= monthEnd;
}

function isBudgetLineItem(row: StoredBudgetRow): row is BudgetLineItem {
  return (
    typeof (row as BudgetLineItem).category === "string"
    && typeof (row as BudgetLineItem).month === "string"
    && typeof (row as BudgetLineItem).group === "string"
    && typeof (row as BudgetLineItem).plannedAmount === "number"
  );
}

function toBudgetLineItem(row: StoredBudgetRow, fallbackMonth: string): BudgetLineItem {
  if (isBudgetLineItem(row)) {
    return {
      ...row,
      month: row.month || fallbackMonth,
      plannedAmount: Number.isFinite(row.plannedAmount) ? row.plannedAmount : 0,
      manualActual: Number.isFinite(row.manualActual) ? row.manualActual : 0,
      rollover: Boolean(row.rollover),
      notes: row.notes?.trim() || undefined,
      isSpendingCategory:
        typeof row.isSpendingCategory === "boolean"
          ? row.isSpendingCategory
          : row.group !== "income",
    };
  }

  return {
    id: row.id,
    month: fallbackMonth,
    category: row.label,
    group: row.type,
    plannedAmount: Number.isFinite(row.budget) ? row.budget : 0,
    manualActual: Number.isFinite(row.actual) ? row.actual : 0,
    rollover: false,
    notes: undefined,
    isSpendingCategory: row.type !== "income",
  };
}

function BudgetRow(props: {
  row: ComputedBudgetLineItem;
  onEdit: (row: BudgetLineItem) => void;
}) {
  const progress = props.row.plannedAmount > 0
    ? Math.min(Math.round((props.row.combinedActual / props.row.plannedAmount) * 100), 100)
    : 0;
  const isIncome = props.row.group === "income";
  const overBudget = !isIncome && props.row.remaining < 0;
  const barColor = isIncome
    ? "bg-[var(--aw-chart-positive-fill)]"
    : overBudget
      ? "bg-[var(--aw-chart-negative-fill)]"
      : "bg-[var(--aw-primary)]";

  return (
    <div className="aw-card aw-card-interactive !px-4 !py-4">
      <div className="grid grid-cols-[minmax(220px,1.4fr)_repeat(3,minmax(92px,0.6fr))_auto] items-center gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--aw-text)]">{props.row.category}</p>
            {props.row.rollover ? <span className="aw-pill">Rollover</span> : null}
          </div>
          <div className="mt-3 h-2 rounded-full bg-[var(--aw-border)]">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${progress}%` }} />
          </div>
          {props.row.notes ? (
            <p className="mt-2 truncate text-xs text-[var(--aw-text-muted)]">{props.row.notes}</p>
          ) : null}
        </div>
        <span className="aw-number text-sm text-[var(--aw-text-muted)]">{fmt(props.row.plannedAmount)}</span>
        <span className="aw-number text-sm text-[var(--aw-text-muted)]">{fmt(props.row.combinedActual)}</span>
        <span
          className={`aw-number text-sm font-semibold ${overBudget ? "text-[var(--aw-danger)]" : "text-[var(--aw-text)]"}`}
        >
          {fmt(props.row.remaining)}
        </span>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => props.onEdit(props.row)}
            className="aw-button-secondary inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs"
          >
            <PencilLine size={12} />
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function BudgetSection(props: {
  title: string;
  rows: ComputedBudgetLineItem[];
  onEdit: (row: BudgetLineItem) => void;
}) {
  return (
    <section>
      <p className="mb-4 text-sm font-semibold text-[var(--aw-text)]">{props.title}</p>
      <div className="space-y-3">
        {props.rows.length === 0 ? (
          <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-4 py-3 text-sm text-[var(--aw-text-muted)]">
            No categories yet.
          </div>
        ) : (
          props.rows.map((row) => (
            <BudgetRow key={row.id} row={row} onEdit={props.onEdit} />
          ))
        )}
      </div>
    </section>
  );
}

export function BudgetsView() {
  const financialData = useFinancialData();
  const currentMonthKey = useMemo(() => monthKeyFromDate(new Date()), []);
  const [activeMonth, setActiveMonth] = useState(currentMonthKey);
  const [storedRows, setStoredRows] = useLocalStorageState<StoredBudgetRow[]>(
    MANUAL_STORAGE_KEYS.budgets,
    [],
  );
  const [manualRecurringItems] = useLocalStorageState<ManualRecurringItem[]>(
    MANUAL_STORAGE_KEYS.recurring,
    [],
  );
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [formMonth, setFormMonth] = useState(currentMonthKey);
  const [formCategory, setFormCategory] = useState("");
  const [formGroup, setFormGroup] = useState<BudgetGroup>("variable");
  const [formPlannedAmount, setFormPlannedAmount] = useState("");
  const [formManualActual, setFormManualActual] = useState("");
  const [formRollover, setFormRollover] = useState(false);
  const [formNotes, setFormNotes] = useState("");
  const [formSpendingCategory, setFormSpendingCategory] = useState(true);
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    if (storedRows.some((row) => !isBudgetLineItem(row))) {
      setStoredRows((prev) => prev.map((row) => toBudgetLineItem(row, currentMonthKey)));
    }
  }, [currentMonthKey, setStoredRows, storedRows]);

  const budgetRows = useMemo(() => {
    return storedRows
      .map((row) => toBudgetLineItem(row, currentMonthKey))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [currentMonthKey, storedRows]);

  const transactionActuals = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();

    for (const tx of financialData.allTransactions) {
      const txMonth = monthKeyFromIso(tx.occurred_at);
      if (!txMonth || txMonth !== activeMonth) continue;

      const key = normalizeCategory(tx.category || "");
      if (!key) continue;

      const txType = normalizeTransactionType(tx);
      if (txType === "transfer") continue;

      const existing = map.get(key) ?? { income: 0, expense: 0 };
      if (txType === "income") {
        existing.income += Math.abs(tx.amount);
      } else {
        existing.expense += Math.abs(tx.amount);
      }
      map.set(key, existing);
    }

    return map;
  }, [activeMonth, financialData.allTransactions]);

  const rowsForActiveMonth = useMemo(() => {
    return budgetRows.filter((row) => row.month === activeMonth);
  }, [activeMonth, budgetRows]);

  const computedRows = useMemo<ComputedBudgetLineItem[]>(() => {
    return rowsForActiveMonth.map((row) => {
      const key = normalizeCategory(row.category);
      const actualFromTransactions = transactionActuals.get(key);
      if (!actualFromTransactions) return row;

      const transactionActual = row.group === "income"
        ? actualFromTransactions.income
        : row.isSpendingCategory
          ? actualFromTransactions.expense
          : 0;
      const combinedActual = row.manualActual + transactionActual;

      return {
        ...row,
        transactionActual,
        combinedActual,
        remaining: row.plannedAmount - combinedActual,
      };
    }).map((row) => {
      if ("transactionActual" in row && "combinedActual" in row && "remaining" in row) {
        return row;
      }
      return {
        ...row,
        transactionActual: 0,
        combinedActual: row.manualActual,
        remaining: row.plannedAmount - row.manualActual,
      };
    });
  }, [rowsForActiveMonth, transactionActuals]);

  const grouped = useMemo(() => {
    return {
      income: computedRows.filter((row) => row.group === "income"),
      fixed: computedRows.filter((row) => row.group === "fixed"),
      variable: computedRows.filter((row) => row.group === "variable"),
    };
  }, [computedRows]);

  const summary = useMemo(() => {
    const incomeBudget = grouped.income.reduce((sum, row) => sum + row.plannedAmount, 0);
    const incomeActual = grouped.income.reduce((sum, row) => sum + row.combinedActual, 0);

    const fixedBudget = grouped.fixed.reduce((sum, row) => sum + row.plannedAmount, 0);
    const fixedActual = grouped.fixed.reduce((sum, row) => sum + row.combinedActual, 0);

    const variableBudget = grouped.variable.reduce((sum, row) => sum + row.plannedAmount, 0);
    const variableActual = grouped.variable.reduce((sum, row) => sum + row.combinedActual, 0);
    const totalPlanned = incomeBudget + fixedBudget + variableBudget;
    const totalActual = incomeActual + fixedActual + variableActual;
    const manualActual = computedRows.reduce((sum, row) => sum + row.manualActual, 0);
    const transactionActual = computedRows.reduce((sum, row) => sum + row.transactionActual, 0);
    const expensesBudget = fixedBudget + variableBudget;
    const expensesActual = fixedActual + variableActual;
    const plannedSavings = incomeBudget - expensesBudget;
    const actualSavings = incomeActual - expensesActual;
    const recurringExpected = manualRecurringItems.reduce(
      (acc, item) => {
        if (item.autopopulateForecast === false) return acc;
        if (!recurringItemActiveForMonth(item, activeMonth)) return acc;
        const amount = Math.abs(item.estimated_monthly_cost || 0);
        if (!amount) return acc;

        if (item.cashflowType === "income") {
          acc.income += amount;
        } else if (item.cashflowType === "transfer") {
          acc.transfer += amount;
        } else {
          acc.expense += amount;
        }
        return acc;
      },
      { income: 0, expense: 0, transfer: 0 },
    );

    return {
      incomeBudget,
      incomeActual,
      fixedBudget,
      fixedActual,
      variableBudget,
      variableActual,
      totalPlanned,
      totalActual,
      manualActual,
      transactionActual,
      expensesBudget,
      expensesActual,
      plannedSavings,
      actualSavings,
      remaining: incomeBudget - expensesActual,
      rolloverCount: computedRows.filter((row) => row.rollover).length,
      recurringExpectedIncome: recurringExpected.income,
      recurringExpectedExpense: recurringExpected.expense,
      recurringExpectedTransfer: recurringExpected.transfer,
      recurringExpectedNet: recurringExpected.income - recurringExpected.expense,
    };
  }, [activeMonth, computedRows, grouped.fixed, grouped.income, grouped.variable, manualRecurringItems]);

  const categoryOptions = useMemo(() => {
    const existing = budgetRows
      .filter((row) => row.group === formGroup)
      .map((row) => row.category);
    return Array.from(new Set([...DEFAULT_CATEGORIES[formGroup], ...existing])).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [budgetRows, formGroup]);

  // Custom category detection is now handled by ComboboxInput internally

  const openCreateModal = () => {
    setEditingRowId(null);
    setFormMonth(activeMonth);
    setFormCategory("");
    setFormGroup("variable");
    setFormPlannedAmount("");
    setFormManualActual("");
    setFormRollover(false);
    setFormNotes("");
    setFormSpendingCategory(true);
    setManualError(null);
    setBudgetModalOpen(true);
  };

  const openEditModal = (row: BudgetLineItem) => {
    setEditingRowId(row.id);
    setFormMonth(row.month);
    setFormCategory(row.category);
    setFormGroup(row.group);
    setFormPlannedAmount(String(row.plannedAmount));
    setFormManualActual(row.manualActual > 0 ? String(row.manualActual) : "");
    setFormRollover(row.rollover);
    setFormNotes(row.notes ?? "");
    setFormSpendingCategory(row.isSpendingCategory);
    setManualError(null);
    setBudgetModalOpen(true);
  };

  const saveBudgetRow = () => {
    setManualError(null);
    const month = formMonth.trim();
    const category = formCategory.trim();
    const plannedAmount = Number(formPlannedAmount);
    const manualActual = Number(formManualActual || "0");

    if (!/^\d{4}-\d{2}$/.test(month)) {
      setManualError("Budget month is required.");
      return;
    }

    if (!category) {
      setManualError("Category name is required.");
      return;
    }

    if (!Number.isFinite(plannedAmount) || plannedAmount < 0) {
      setManualError("Planned amount must be zero or greater.");
      return;
    }

    if (!Number.isFinite(manualActual) || manualActual < 0) {
      setManualError("Manual actual must be zero or greater.");
      return;
    }

    setStoredRows((prev) => {
      const normalized = prev.map((row) => toBudgetLineItem(row, currentMonthKey));
      const payload: BudgetLineItem = {
        id: editingRowId ?? `budget-${Date.now()}`,
        month,
        category,
        group: formGroup,
        plannedAmount,
        manualActual,
        rollover: formRollover,
        notes: formNotes.trim() || undefined,
        isSpendingCategory: formGroup === "income" ? false : formSpendingCategory,
      };

      if (!editingRowId) {
        return [payload, ...normalized];
      }

      return normalized.map((row) => (row.id === editingRowId ? payload : row));
    });

    setBudgetModalOpen(false);
    setEditingRowId(null);
  };

  const deleteBudgetRow = () => {
    if (!editingRowId) return;
    setStoredRows((prev) =>
      prev
        .map((row) => toBudgetLineItem(row, currentMonthKey))
        .filter((row) => row.id !== editingRowId),
    );
    setBudgetModalOpen(false);
    setEditingRowId(null);
  };

  if (financialData.loading) {
    return (
      <div className="aw-workspace-page flex items-center justify-center py-32">
        <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
      </div>
    );
  }

  return (
    <div className="aw-workspace-page">
      <WorkspaceHeader
        title={formatMonthTitle(activeMonth)}
        subtitle="Plan your spending by category. Calico tracks what you actually spend."
        actions={(
          <>
            <ToolbarButton icon={<ChevronLeft size={14} />} onClick={() => setActiveMonth((prev) => shiftMonth(prev, -1))} />
            <ToolbarButton icon={<ChevronRight size={14} />} onClick={() => setActiveMonth((prev) => shiftMonth(prev, 1))} />
            <ToolbarButton onClick={() => setActiveMonth(currentMonthKey)}>Today</ToolbarButton>
            <ManualEntryButton onClick={openCreateModal}>
              Create budget
            </ManualEntryButton>
          </>
        )}
      />

      <div className="aw-workspace-grid" data-columns="2-1">
        <WorkspacePanel title="Spending plan">
          <div className="grid grid-cols-[minmax(220px,1.4fr)_repeat(3,minmax(92px,0.6fr))_auto] gap-4 border-b border-[var(--aw-border)] px-2 pb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
            <span>Category</span>
            <span>Planned</span>
            <span>Spent</span>
            <span>Left</span>
            <span className="text-right" />
          </div>

          <div className="space-y-8 pt-5">
            <BudgetSection title="Income" rows={grouped.income} onEdit={openEditModal} />
            <BudgetSection title="Fixed expenses" rows={grouped.fixed} onEdit={openEditModal} />
            <BudgetSection title="Variable expenses" rows={grouped.variable} onEdit={openEditModal} />
          </div>

          {computedRows.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
              <div className="aw-card-modal pointer-events-auto w-full max-w-md">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--aw-primary-soft)] text-[var(--aw-primary)]">
                  <PieChart size={22} />
                </div>
                <p className="text-2xl font-semibold tracking-[-0.03em] text-[var(--aw-text)]">
                  Create your first budget
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--aw-text-muted)]">
                  Import transactions later if you connect accounts. Start planning today with manual categories.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    href="/connect"
                    className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Connect an account
                  </Link>
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Create budget
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </WorkspacePanel>

        <WorkspacePanel title="Summary">
          <div className="space-y-5">
            <div className="rounded-[16px] border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Budget remaining</p>
              <p className={`aw-number mt-2 text-3xl font-semibold ${summary.remaining < 0 ? "text-[var(--aw-danger)]" : "text-[var(--aw-text)]"}`}>
                {fmt(summary.remaining)}
              </p>
              <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                {fmt(summary.incomeBudget)} planned income · {fmt(summary.expensesActual)} spent
              </p>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--aw-text-muted)]">Income planned</span>
                <span className="aw-number text-[var(--aw-text)]">{fmt(summary.incomeBudget)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--aw-text-muted)]">Income received</span>
                <span className="aw-number text-[var(--aw-success)]">{fmt(summary.incomeActual)}</span>
              </div>
              <div className="my-2 border-t border-[var(--aw-border)]" />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--aw-text-muted)]">Expenses planned</span>
                <span className="aw-number text-[var(--aw-text)]">{fmt(summary.expensesBudget)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--aw-text-muted)]">Expenses spent</span>
                <span className={`aw-number ${summary.expensesActual > summary.expensesBudget ? "text-[var(--aw-danger)]" : "text-[var(--aw-text)]"}`}>
                  {fmt(summary.expensesActual)}
                </span>
              </div>
              <div className="my-2 border-t border-[var(--aw-border)]" />
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-[var(--aw-text)]">Saved this month</span>
                <span className={`aw-number font-semibold ${summary.actualSavings >= 0 ? "text-[var(--aw-text)]" : "text-[var(--aw-danger)]"}`}>
                  {fmt(summary.actualSavings)}
                </span>
              </div>
            </div>
          </div>
        </WorkspacePanel>
      </div>

      <ManualEntryModal
        open={budgetModalOpen}
        onClose={() => setBudgetModalOpen(false)}
        title={editingRowId ? "Edit category" : "Add a budget category"}
        description="Set how much you plan to spend or earn in this category."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Month</span>
              <input
                value={formMonth}
                onChange={(event) => setFormMonth(event.target.value)}
                className="aw-input h-10 text-sm"
                type="month"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Type</span>
              <select
                value={formGroup}
                onChange={(event) => {
                  const nextGroup = event.target.value as BudgetGroup;
                  setFormGroup(nextGroup);
                  if (nextGroup === "income") {
                    setFormSpendingCategory(false);
                  } else if (!editingRowId) {
                    setFormSpendingCategory(true);
                  }
                }}
                className="aw-input h-10 text-sm"
              >
                <option value="income">Income</option>
                <option value="fixed">Fixed</option>
                <option value="variable">Variable</option>
              </select>
            </label>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Category</span>
            <ComboboxInput
              value={formCategory}
              onChange={setFormCategory}
              options={categoryOptions}
              placeholder="Select or type a category"
              allowCustom
              customLabel="Add new category"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Planned</span>
              <input
                value={formPlannedAmount}
                onChange={(event) => setFormPlannedAmount(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Already spent (optional)</span>
              <input
                value={formManualActual}
                onChange={(event) => setFormManualActual(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5 text-sm text-[var(--aw-text)]">
            <input
              checked={formRollover}
              onChange={(event) => setFormRollover(event.target.checked)}
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--aw-border)] text-[var(--aw-primary)] focus:ring-[var(--aw-primary)]"
            />
            Roll unused budget to next month
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Notes (optional)</span>
            <textarea
              value={formNotes}
              onChange={(event) => setFormNotes(event.target.value)}
              className="aw-input min-h-[92px] py-2 text-sm"
              placeholder="Optional notes"
            />
          </label>

          {manualError ? (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {manualError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            {editingRowId ? (
              <button
                type="button"
                onClick={deleteBudgetRow}
                className="aw-button-danger inline-flex h-10 items-center gap-1.5 px-4 text-sm"
              >
                <Trash2 size={14} />
                Delete line
              </button>
            ) : <span />}

            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBudgetModalOpen(false)}
              className="aw-button-secondary h-10 px-4 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveBudgetRow}
              className="aw-button-primary h-10 px-4 text-sm"
            >
              {editingRowId ? "Save changes" : "Save budget"}
            </button>
            </div>
          </div>
        </div>
      </ManualEntryModal>
    </div>
  );
}
