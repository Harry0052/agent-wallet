"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  PencilLine,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { fmt } from "@/lib/utils";
import {
  fetchSuspectedSubscriptions,
  setRecurringLifecycle,
  type DetectedSubscription,
} from "@/services/statements";
import {
  ToolbarButton,
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import {
  DataSourceToggle,
  ManualEntryButton,
  ManualEntryModal,
  type DataSourceMode,
} from "@/components/finance/ManualDataControls";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { MANUAL_STORAGE_KEYS } from "@/lib/manualMode";

type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
type RecurringCashflowType = "income" | "expense" | "transfer";
type ManualRecurringType =
  | "recurring_income"
  | "recurring_bill"
  | "subscription"
  | "debt_payment"
  | "transfer"
  | "credit_card_payment_reminder";

interface ManualRecurringItem extends DetectedSubscription {
  sourceType?: "manual";
  cashflowType?: RecurringCashflowType;
  manualType?: ManualRecurringType;
  title?: string;
  amount?: number;
  frequency?: RecurringFrequency;
  startDate?: string;
  accountName?: string;
  category?: string;
  notes?: string;
  autopopulateForecast?: boolean;
}

interface ManualTypeOption {
  value: ManualRecurringType;
  label: string;
  cashflowType: RecurringCashflowType;
  defaultCategory: string;
}

const MANUAL_TYPE_OPTIONS: ManualTypeOption[] = [
  {
    value: "recurring_income",
    label: "Recurring income",
    cashflowType: "income",
    defaultCategory: "Income",
  },
  {
    value: "recurring_bill",
    label: "Recurring bill",
    cashflowType: "expense",
    defaultCategory: "Bills",
  },
  {
    value: "subscription",
    label: "Subscription",
    cashflowType: "expense",
    defaultCategory: "Subscriptions",
  },
  {
    value: "debt_payment",
    label: "Debt payment",
    cashflowType: "expense",
    defaultCategory: "Debt",
  },
  {
    value: "transfer",
    label: "Transfer",
    cashflowType: "transfer",
    defaultCategory: "Transfers",
  },
  {
    value: "credit_card_payment_reminder",
    label: "Credit card payment reminder",
    cashflowType: "expense",
    defaultCategory: "Credit card",
  },
];

const FREQUENCY_OPTIONS: Array<{ value: RecurringFrequency; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
];

function frequencyLabel(interval: string): string {
  const map: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Bi-weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
  };
  return map[interval] ?? interval;
}

function monthlyMultiplier(frequency: RecurringFrequency): number {
  const map: Record<RecurringFrequency, number> = {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    monthly: 1,
    quarterly: 1 / 3,
    annual: 1 / 12,
  };
  return map[frequency];
}

function monthlyEstimate(amount: number, frequency: RecurringFrequency): number {
  return Math.round(amount * monthlyMultiplier(frequency) * 100) / 100;
}

function formatDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toIsoFromDateInput(dateInput: string): string {
  return new Date(`${dateInput}T12:00:00.000Z`).toISOString();
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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

function daysByFrequency(frequency: RecurringFrequency): number {
  const map: Record<RecurringFrequency, number> = {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    quarterly: 90,
    annual: 365,
  };
  return map[frequency];
}

function addInterval(date: Date, frequency: RecurringFrequency): Date {
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

function nextOccurrence(startDate: string, frequency: RecurringFrequency, now: Date): Date | null {
  const start = new Date(`${startDate}T12:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;

  let cursor = new Date(start);
  let guard = 0;
  while (cursor < now && guard < 600) {
    cursor = addInterval(cursor, frequency);
    guard += 1;
  }
  return cursor;
}

function manualTypeOption(type: ManualRecurringType): ManualTypeOption {
  return MANUAL_TYPE_OPTIONS.find((option) => option.value === type) ?? MANUAL_TYPE_OPTIONS[2];
}

function inferManualType(item: Partial<ManualRecurringItem>): ManualRecurringType {
  if (item.manualType) return item.manualType;
  if (item.cashflowType === "income") return "recurring_income";
  if (item.cashflowType === "transfer") return "transfer";
  const category = (item.category || "").toLowerCase();
  if (category.includes("debt")) return "debt_payment";
  if (category.includes("credit")) return "credit_card_payment_reminder";
  if (category.includes("bill")) return "recurring_bill";
  return "subscription";
}

function normalizeManualItem(item: ManualRecurringItem): ManualRecurringItem {
  const manualType = inferManualType(item);
  const frequency = (item.frequency || item.recurrence_interval || "monthly") as RecurringFrequency;
  const amount = item.amount ?? item.estimated_monthly_cost;
  const startDateRaw = item.startDate
    || item.explanation?.first_seen
    || item.last_seen
    || new Date().toISOString();
  const startDate = startDateRaw.slice(0, 10);
  const typeMeta = manualTypeOption(manualType);

  return {
    ...item,
    sourceType: "manual",
    title: item.title || item.merchant,
    merchant: item.merchant || item.title || "Manual recurring",
    amount,
    frequency,
    recurrence_interval: frequency,
    startDate,
    category: item.category || typeMeta.defaultCategory,
    cashflowType: item.cashflowType || typeMeta.cashflowType,
    manualType,
    autopopulateForecast: item.autopopulateForecast ?? true,
    accountName: item.accountName,
    notes: item.notes,
    estimated_monthly_cost: Number.isFinite(item.estimated_monthly_cost)
      ? item.estimated_monthly_cost
      : monthlyEstimate(amount, frequency),
  };
}

function recurringCashflowType(item: DetectedSubscription): RecurringCashflowType {
  const maybeManual = item as ManualRecurringItem;
  if (maybeManual.cashflowType === "income") return "income";
  if (maybeManual.cashflowType === "transfer") return "transfer";
  return "expense";
}

function estimateNextDate(sub: DetectedSubscription): string | null {
  const maybeManual = sub as ManualRecurringItem;
  if (maybeManual.startDate) {
    const frequency = (maybeManual.frequency || maybeManual.recurrence_interval || "monthly") as RecurringFrequency;
    const next = nextOccurrence(maybeManual.startDate, frequency, new Date());
    if (!next) return null;
    return next.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  if (!sub.explanation?.average_interval_days || !sub.last_seen) return null;
  const last = new Date(sub.last_seen);
  if (Number.isNaN(last.getTime())) return null;
  const next = new Date(last.getTime() + sub.explanation.average_interval_days * 86400000);
  if (next <= new Date()) return null;
  return next.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isRecentlyDetected(sub: DetectedSubscription): boolean {
  if (sub.lifecycle_status !== "detected") return false;
  if (!sub.explanation?.first_seen) return false;
  const first = new Date(sub.explanation.first_seen);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
  return first >= fourteenDaysAgo;
}

function shouldApplyToMonth(item: ManualRecurringItem, monthKey: string): boolean {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return true;

  const startDate = item.startDate
    ? new Date(`${item.startDate}T12:00:00.000Z`)
    : item.explanation?.first_seen
      ? new Date(item.explanation.first_seen)
      : item.last_seen
        ? new Date(item.last_seen)
        : null;

  if (!startDate || Number.isNaN(startDate.getTime())) return true;
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  return startDate <= monthEnd;
}

function SummarySection(props: {
  title: string;
  value: string;
  action: string;
  onAction: () => void;
  className?: string;
}) {
  return (
    <div className={`aw-card aw-card-compact ${props.className ?? ""}`}>
      <p className="text-sm font-semibold text-[var(--aw-text)]">{props.title}</p>
      <p className="aw-number mt-3 text-[28px] leading-none text-[var(--aw-text)]">{props.value}</p>
      <button
        type="button"
        onClick={props.onAction}
        className="mt-3 inline-block text-xs font-semibold text-[var(--aw-primary)]"
      >
        {props.action}
      </button>
    </div>
  );
}

export function SubscriptionsView() {
  const [subscriptions, setSubscriptions] = useState<DetectedSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const currentMonthKey = useMemo(() => monthKeyFromDate(new Date()), []);
  const [activeMonth, setActiveMonth] = useState(currentMonthKey);
  const [sourceMode, setSourceMode] = useState<DataSourceMode>("connected");

  const [manualSubscriptions, setManualSubscriptions] =
    useLocalStorageState<ManualRecurringItem[]>(MANUAL_STORAGE_KEYS.recurring, []);

  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualEditId, setManualEditId] = useState<string | null>(null);

  const [manualType, setManualType] = useState<ManualRecurringType>("subscription");
  const [manualTitle, setManualTitle] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualFrequency, setManualFrequency] = useState<RecurringFrequency>("monthly");
  const [manualStartDate, setManualStartDate] = useState(() => formatDateInputValue(new Date()));
  const [manualAccount, setManualAccount] = useState("");
  const [manualCategory, setManualCategory] = useState("Subscriptions");
  const [manualNotes, setManualNotes] = useState("");
  const [manualAutopopulateForecast, setManualAutopopulateForecast] = useState(true);
  const [manualError, setManualError] = useState<string | null>(null);

  const normalizedManualSubscriptions = useMemo(
    () => manualSubscriptions.map((item) => normalizeManualItem(item)),
    [manualSubscriptions],
  );

  useEffect(() => {
    if (manualSubscriptions.some((item) => item.sourceType !== "manual" || !item.manualType)) {
      setManualSubscriptions((prev) => prev.map((item) => normalizeManualItem(item)));
    }
  }, [manualSubscriptions, setManualSubscriptions]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setSubscriptions(await fetchSuspectedSubscriptions());
    } catch (err) {
      setSubscriptions([]);
      const message = err instanceof Error ? err.message : "Failed to load recurring items.";
      const safeNoDataError = /no\s+connected|no\s+account|not\s+connected|empty/i.test(message);
      if (!safeNoDataError) {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAction = async (id: string, status: "confirmed" | "ignored") => {
    setActionLoading(id);
    try {
      await setRecurringLifecycle({ subscriptionId: id, status });
      await load();
    } catch {
      // noop by design
    } finally {
      setActionLoading(null);
    }
  };

  const openCreateManualRecurring = (type?: ManualRecurringType) => {
    const selectedType = type ?? "subscription";
    const meta = manualTypeOption(selectedType);

    setManualEditId(null);
    setManualType(selectedType);
    setManualTitle("");
    setManualAmount("");
    setManualFrequency("monthly");
    setManualStartDate(formatDateInputValue(new Date()));
    setManualAccount("");
    setManualCategory(meta.defaultCategory);
    setManualNotes("");
    setManualAutopopulateForecast(true);
    setManualError(null);
    setManualModalOpen(true);
  };

  const openEditManualRecurring = (item: ManualRecurringItem) => {
    const normalized = normalizeManualItem(item);
    setManualEditId(normalized.id);
    setManualType(normalized.manualType || "subscription");
    setManualTitle(normalized.title || normalized.merchant);
    setManualAmount(String(normalized.amount ?? normalized.estimated_monthly_cost));
    setManualFrequency((normalized.frequency || normalized.recurrence_interval || "monthly") as RecurringFrequency);
    setManualStartDate(normalized.startDate || formatDateInputValue(new Date()));
    setManualAccount(normalized.accountName || "");
    setManualCategory(normalized.category || "");
    setManualNotes(normalized.notes || "");
    setManualAutopopulateForecast(normalized.autopopulateForecast ?? true);
    setManualError(null);
    setManualModalOpen(true);
  };

  const removeManualRecurring = (id: string) => {
    setManualSubscriptions((prev) => prev.filter((item) => item.id !== id));
  };

  const saveManualRecurring = () => {
    setManualError(null);
    const title = manualTitle.trim();
    const amount = Number(manualAmount);
    const category = manualCategory.trim();

    if (!title) {
      setManualError("Title is required.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setManualError("Amount must be greater than zero.");
      return;
    }

    if (!manualStartDate) {
      setManualError("Start date is required.");
      return;
    }

    if (!category) {
      setManualError("Category is required.");
      return;
    }

    const typeMeta = manualTypeOption(manualType);
    const monthlyCost = monthlyEstimate(amount, manualFrequency);
    const startedAtISO = toIsoFromDateInput(manualStartDate);

    const payload: ManualRecurringItem = {
      id: manualEditId ?? `manual-${Date.now()}`,
      user_id: "manual",
      merchant: title,
      estimated_monthly_cost: monthlyCost,
      recurrence_interval: manualFrequency,
      confidence: 1,
      last_seen: startedAtISO,
      status: "active",
      lifecycle_status: "manual",
      source_state: "Manual",
      explanation: {
        summary: manualNotes.trim() || "Manual recurring entry",
        transaction_count: 1,
        first_seen: startedAtISO,
        last_seen: startedAtISO,
        average_interval_days: daysByFrequency(manualFrequency),
        average_amount: amount,
      },
      sourceType: "manual",
      cashflowType: typeMeta.cashflowType,
      manualType,
      title,
      amount,
      frequency: manualFrequency,
      startDate: manualStartDate,
      accountName: manualAccount.trim() || undefined,
      category,
      notes: manualNotes.trim() || undefined,
      autopopulateForecast: manualAutopopulateForecast,
    };

    setManualSubscriptions((prev) => {
      const normalized = prev.map((item) => normalizeManualItem(item));
      if (!manualEditId) {
        return [payload, ...normalized];
      }
      return normalized.map((item) => (item.id === manualEditId ? payload : item));
    });

    setManualModalOpen(false);
    setManageModalOpen(false);
    setManualEditId(null);
  };

  const visibleSubscriptions = sourceMode === "manual"
    ? normalizedManualSubscriptions
    : [...subscriptions, ...normalizedManualSubscriptions];

  const activeItems = useMemo(() => {
    return visibleSubscriptions.filter(
      (item) => item.lifecycle_status === "detected"
        || item.lifecycle_status === "confirmed"
        || item.lifecycle_status === "manual",
    );
  }, [visibleSubscriptions]);

  const monthTotals = useMemo(() => {
    return activeItems.reduce(
      (acc, item) => {
        const recurringType = recurringCashflowType(item);
        const manualItem = item as ManualRecurringItem;

        if (manualItem.sourceType === "manual" && !shouldApplyToMonth(manualItem, activeMonth)) {
          return acc;
        }

        const amount = item.estimated_monthly_cost;
        if (recurringType === "income") {
          acc.income += amount;
        } else if (recurringType === "transfer") {
          acc.transfer += amount;
        } else {
          acc.expenses += amount;
        }
        return acc;
      },
      { income: 0, expenses: 0, transfer: 0 },
    );
  }, [activeItems, activeMonth]);

  const netExpected = monthTotals.income - monthTotals.expenses;

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
        title="Recurring"
        tabs={[
          { label: "Recurring", active: true },
          { label: "Calendar" },
        ]}
        actions={(
          <>
            <DataSourceToggle
              mode={sourceMode}
              onChange={setSourceMode}
              connectedLabel="All items"
              manualLabel="Manual only"
            />
            <ToolbarButton icon={<Filter size={14} />}>Filters</ToolbarButton>
            <ToolbarButton
              variant="primary"
              icon={<RefreshCw size={14} />}
              onClick={() => setManageModalOpen(true)}
            >
              Manage recurring
            </ToolbarButton>
            <ManualEntryButton onClick={() => openCreateManualRecurring()}>
              Add recurring item
            </ManualEntryButton>
          </>
        )}
      />

      {error ? (
        <div className="mb-4 rounded-2xl border border-[var(--aw-border)] bg-white px-4 py-3 text-sm text-[var(--aw-text)]">
          {error}
        </div>
      ) : null}

      <WorkspacePanel
        title="Month controls"
        heading={formatMonthTitle(activeMonth)}
        action={(
          <div className="aw-toolbar">
            <ToolbarButton
              icon={<ChevronLeft size={14} />}
              onClick={() => setActiveMonth((prev) => shiftMonth(prev, -1))}
            />
            <ToolbarButton
              icon={<ChevronRight size={14} />}
              onClick={() => setActiveMonth((prev) => shiftMonth(prev, 1))}
            />
            <ToolbarButton onClick={() => setActiveMonth(currentMonthKey)}>Today</ToolbarButton>
          </div>
        )}
      >
        <div className="aw-workspace-grid" data-columns="4">
          <SummarySection
            title="Recurring income"
            value={fmt(monthTotals.income)}
            action="Add recurring item"
            onAction={() => openCreateManualRecurring("recurring_income")}
          />
          <SummarySection
            title="Recurring expenses"
            value={fmt(monthTotals.expenses)}
            action="Add recurring item"
            onAction={() => openCreateManualRecurring("subscription")}
          />
          <SummarySection
            title="Transfers"
            value={fmt(monthTotals.transfer)}
            action="Add transfer"
            onAction={() => openCreateManualRecurring("transfer")}
          />
          <SummarySection
            title="Net expected"
            value={fmt(netExpected)}
            action="Manage recurring"
            onAction={() => setManageModalOpen(true)}
          />
        </div>
      </WorkspacePanel>

      <WorkspacePanel className="mt-4" title="Recurring list">
        {activeItems.length === 0 ? (
          <div className="aw-card-table">
            <WorkspaceEmpty
              title="No recurring items yet"
              description={sourceMode === "manual"
                ? "Connect an account when ready, or add recurring income, bills, subscriptions, debt payments, transfers, and reminders manually."
                : "Track recurring income and expenses from connected data and manual entries in one place."}
              action={(
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/connect"
                    className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Connect an account
                  </Link>
                  <button
                    type="button"
                    onClick={() => setManageModalOpen(true)}
                    className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Manage recurring
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreateManualRecurring()}
                    className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Add recurring item
                  </button>
                </div>
              )}
              className="min-h-[320px]"
            />
          </div>
        ) : (
          <div className="aw-card-table">
            <div className="grid grid-cols-[minmax(0,1.35fr)_160px_220px_220px] gap-4 border-b border-[var(--aw-border)] px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
              <span>Recurring item</span>
              <span>Amount</span>
              <span>Schedule</span>
              <span className="text-right">Actions</span>
            </div>
            {activeItems.map((item) => {
              const recurringType = recurringCashflowType(item);
              const manualItem = item as ManualRecurringItem;
              const isManual = item.lifecycle_status === "manual";
              const isNew = isRecentlyDetected(item);
              const nextDate = estimateNextDate(item);
              const typeLabel = isManual
                ? manualTypeOption(inferManualType(manualItem)).label
                : recurringType === "income"
                  ? "Recurring income"
                  : recurringType === "transfer"
                    ? "Transfer"
                    : "Recurring expense";

              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1.35fr)_160px_220px_220px] items-center gap-4 border-t border-[var(--aw-border)] px-5 py-4 transition duration-150 ease-in-out hover:bg-[var(--aw-primary-soft)]/40 first:border-t-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--aw-text)]">
                        {manualItem.title || item.merchant}
                      </p>
                      {isNew ? <span className="aw-pill">New</span> : null}
                      {isManual ? <span className="aw-pill">Manual</span> : null}
                      <span className="aw-pill">{typeLabel}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--aw-text-muted)]">
                      {manualItem.category || "Recurring"}
                      {manualItem.accountName ? ` • ${manualItem.accountName}` : ""}
                      {manualItem.notes ? ` • ${manualItem.notes}` : ""}
                    </p>
                  </div>
                  <p
                    className={`aw-number text-sm font-semibold ${
                      recurringType === "income"
                        ? "text-[var(--aw-success)]"
                        : recurringType === "transfer"
                          ? "text-[var(--aw-primary)]"
                          : "text-[var(--aw-text)]"
                    }`}
                  >
                    {recurringType === "income" ? "+" : recurringType === "transfer" ? "~" : "-"}
                    {fmt(manualItem.amount ?? item.estimated_monthly_cost)}
                  </p>
                  <div className="text-sm text-[var(--aw-text-muted)]">
                    <p>{frequencyLabel(manualItem.frequency || item.recurrence_interval)}</p>
                    <p className="mt-1 text-xs">
                      {nextDate ? `Next ${nextDate}` : "No next date"}
                      {manualItem.autopopulateForecast ? " • Forecast on" : " • Forecast off"}
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    {isManual ? (
                      <>
                        <button
                          type="button"
                          className="aw-toolbar-btn"
                          onClick={() => openEditManualRecurring(manualItem)}
                        >
                          <PencilLine size={13} />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="aw-toolbar-btn"
                          onClick={() => removeManualRecurring(item.id)}
                        >
                          <Trash2 size={13} />
                          Remove
                        </button>
                      </>
                    ) : item.lifecycle_status === "detected" ? (
                      <>
                        <button
                          type="button"
                          className="aw-toolbar-btn"
                          onClick={() => {
                            void handleAction(item.id, "confirmed");
                          }}
                          disabled={actionLoading === item.id}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="aw-toolbar-btn"
                          onClick={() => {
                            void handleAction(item.id, "ignored");
                          }}
                          disabled={actionLoading === item.id}
                        >
                          Not this
                        </button>
                      </>
                    ) : (
                      <span className="text-sm text-[var(--aw-text-muted)]">Tracked</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </WorkspacePanel>

      <ManualEntryModal
        open={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        title="Manage recurring"
        description="Manage connected detections and manual recurring items in one place."
        maxWidthClassName="max-w-3xl"
      >
        <div className="space-y-4">
          {sourceMode === "connected" ? (
            <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3 text-sm text-[var(--aw-text-muted)]">
              Connected detections and manual recurring items are shown together. Switch to manual-only when you need to focus local entries.
            </div>
          ) : null}

          <div className="aw-card-table">
            <div className="grid grid-cols-[minmax(0,1.2fr)_120px_160px_200px] gap-4 border-b border-[var(--aw-border)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
              <span>Manual item</span>
              <span>Type</span>
              <span>Forecast</span>
              <span className="text-right">Actions</span>
            </div>
            {normalizedManualSubscriptions.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--aw-text-muted)]">
                No manual recurring items yet.
              </div>
            ) : (
              normalizedManualSubscriptions.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1.2fr)_120px_160px_200px] items-center gap-4 border-t border-[var(--aw-border)] px-4 py-3 first:border-t-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--aw-text)]">{item.title || item.merchant}</p>
                    <p className="mt-1 truncate text-xs text-[var(--aw-text-muted)]">{item.category || "Recurring"}</p>
                  </div>
                  <span className="text-xs text-[var(--aw-text-muted)]">{frequencyLabel(item.frequency || item.recurrence_interval)}</span>
                  <button
                    type="button"
                    className="aw-toolbar-btn"
                    onClick={() => {
                      setManualSubscriptions((prev) =>
                        prev.map((entry) =>
                          entry.id === item.id
                            ? { ...normalizeManualItem(entry), autopopulateForecast: !(normalizeManualItem(entry).autopopulateForecast ?? true) }
                            : normalizeManualItem(entry),
                        ),
                      );
                    }}
                  >
                    {item.autopopulateForecast ? "Forecast on" : "Forecast off"}
                  </button>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="aw-toolbar-btn"
                      onClick={() => openEditManualRecurring(item)}
                    >
                      <PencilLine size={13} />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="aw-toolbar-btn"
                      onClick={() => removeManualRecurring(item.id)}
                    >
                      <Trash2 size={13} />
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setManageModalOpen(false)}
              className="aw-button-secondary h-10 px-4 text-sm"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => openCreateManualRecurring()}
              className="aw-button-primary h-10 px-4 text-sm"
            >
              Add recurring item
            </button>
          </div>
        </div>
      </ManualEntryModal>

      <ManualEntryModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title={manualEditId ? "Edit recurring item" : "Add recurring item"}
        description="Recurring items feed cash flow forecast, reports, and budget expected values."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Type</span>
              <select
                value={manualType}
                onChange={(event) => {
                  const nextType = event.target.value as ManualRecurringType;
                  setManualType(nextType);
                  if (!manualCategory.trim()) {
                    setManualCategory(manualTypeOption(nextType).defaultCategory);
                  }
                }}
                className="aw-input h-10 text-sm"
              >
                {MANUAL_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Title</span>
              <input
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Rent payment"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Frequency</span>
              <select
                value={manualFrequency}
                onChange={(event) => setManualFrequency(event.target.value as RecurringFrequency)}
                className="aw-input h-10 text-sm"
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Start date</span>
              <input
                value={manualStartDate}
                onChange={(event) => setManualStartDate(event.target.value)}
                className="aw-input h-10 text-sm"
                type="date"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Account (optional)</span>
              <input
                value={manualAccount}
                onChange={(event) => setManualAccount(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Checking"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Category</span>
            <input
              value={manualCategory}
              onChange={(event) => setManualCategory(event.target.value)}
              className="aw-input h-10 text-sm"
              placeholder="Housing"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Notes</span>
            <textarea
              value={manualNotes}
              onChange={(event) => setManualNotes(event.target.value)}
              className="aw-input min-h-[92px] py-2 text-sm"
              placeholder="Optional notes"
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5 text-sm text-[var(--aw-text)]">
            <input
              checked={manualAutopopulateForecast}
              onChange={(event) => setManualAutopopulateForecast(event.target.checked)}
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--aw-border)] text-[var(--aw-primary)] focus:ring-[var(--aw-primary)]"
            />
            Autopopulate forecast
          </label>

          <p className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2 text-xs text-[var(--aw-text-muted)]">
            Estimated monthly value: {fmt(monthlyEstimate(Number(manualAmount || "0"), manualFrequency))}
          </p>

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
              onClick={saveManualRecurring}
              className="aw-button-primary h-10 px-4 text-sm"
            >
              {manualEditId ? "Save changes" : "Add recurring item"}
            </button>
          </div>
        </div>
      </ManualEntryModal>
    </div>
  );
}
