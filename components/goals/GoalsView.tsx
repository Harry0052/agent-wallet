"use client";

import {
  CalendarClock,
  Loader2,
  PencilLine,
  Plus,
  Target,
  Trash2,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/utils";
import {
  fetchUnifiedStatement,
  type StatementTransaction,
} from "@/services/statements";
import {
  ToolbarButton,
  WorkspaceHeader,
  WorkspaceEmpty,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import {
  ManualEntryButton,
  ManualEntryModal,
} from "@/components/finance/ManualDataControls";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { MANUAL_STORAGE_KEYS } from "@/lib/manualMode";
import { contributionAmount, parseGoalContributionTarget } from "@/lib/manualTransactions";

type GoalSource = "manual" | "connected";

interface LegacyGoalItem {
  id: string;
  label: string;
  saved: number;
  target: number;
  badge: string;
  image: string;
}

interface GoalRecord {
  id: string;
  name: string;
  targetAmount: number;
  currentSavedAmount: number;
  targetDate?: string;
  linkedAccount?: string;
  recurringContribution?: number;
  icon?: string;
  notes?: string;
  manualContributionTotal: number;
  sourceType: GoalSource;
  createdAt: string;
}

interface GoalWithMetrics extends GoalRecord {
  transactionContributionTotal: number;
  transactionContributionCurrentMonth: number;
  totalSaved: number;
  remaining: number;
  progress: number;
  estimatedCompletion: string;
}

type StoredGoal = GoalRecord | LegacyGoalItem;

function normalizeGoalName(name: string): string {
  return name.trim().toLowerCase();
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatCompletionDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function isGoalRecord(goal: StoredGoal): goal is GoalRecord {
  return (
    typeof (goal as GoalRecord).name === "string"
    && typeof (goal as GoalRecord).targetAmount === "number"
    && typeof (goal as GoalRecord).currentSavedAmount === "number"
  );
}

function toGoalRecord(goal: StoredGoal): GoalRecord {
  if (isGoalRecord(goal)) {
    return {
      ...goal,
      targetAmount: Math.max(0, Number(goal.targetAmount) || 0),
      currentSavedAmount: Math.max(0, Number(goal.currentSavedAmount) || 0),
      recurringContribution: goal.recurringContribution
        ? Math.max(0, Number(goal.recurringContribution) || 0)
        : undefined,
      manualContributionTotal: Math.max(0, Number(goal.manualContributionTotal) || 0),
      sourceType: goal.sourceType || "manual",
      createdAt: goal.createdAt || new Date().toISOString(),
      notes: goal.notes?.trim() || undefined,
      linkedAccount: goal.linkedAccount?.trim() || undefined,
      icon: goal.icon?.trim() || undefined,
    };
  }

  return {
    id: goal.id,
    name: goal.label,
    targetAmount: Math.max(0, Number(goal.target) || 0),
    currentSavedAmount: Math.max(0, Number(goal.saved) || 0),
    manualContributionTotal: 0,
    sourceType: "manual",
    createdAt: new Date().toISOString(),
    icon: "🎯",
    notes: goal.badge ? `${goal.badge} goal` : undefined,
  };
}

function estimateCompletion(goal: GoalRecord, remaining: number, monthlyPace: number): string {
  if (remaining <= 0) return "Completed";

  if (goal.targetDate) {
    const targetDate = new Date(`${goal.targetDate}T12:00:00.000Z`);
    if (!Number.isNaN(targetDate.getTime())) {
      return formatCompletionDate(targetDate);
    }
  }

  if (monthlyPace <= 0) {
    return "Add recurring contribution";
  }

  const monthsNeeded = Math.ceil(remaining / monthlyPace);
  const completionDate = new Date();
  completionDate.setMonth(completionDate.getMonth() + monthsNeeded);
  return formatCompletionDate(completionDate);
}

export function GoalsView() {
  const [loading, setLoading] = useState(true);
  const [connectedTransactions, setConnectedTransactions] = useState<StatementTransaction[]>([]);
  const [manualTransactions] = useLocalStorageState<StatementTransaction[]>(
    MANUAL_STORAGE_KEYS.transactions,
    [],
  );
  const [storedGoals, setStoredGoals] = useLocalStorageState<StoredGoal[]>(
    MANUAL_STORAGE_KEYS.goals,
    [],
  );

  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalName, setGoalName] = useState("");
  const [goalTargetAmount, setGoalTargetAmount] = useState("");
  const [goalCurrentSavedAmount, setGoalCurrentSavedAmount] = useState("");
  const [goalTargetDate, setGoalTargetDate] = useState("");
  const [goalLinkedAccount, setGoalLinkedAccount] = useState("");
  const [goalRecurringContribution, setGoalRecurringContribution] = useState("");
  const [goalIcon, setGoalIcon] = useState("");
  const [goalNotes, setGoalNotes] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);

  const [contributionModalGoalId, setContributionModalGoalId] = useState<string | null>(null);
  const [contributionAmountInput, setContributionAmountInput] = useState("");
  const [contributionError, setContributionError] = useState<string | null>(null);

  const goals = useMemo(() => {
    const local = storedGoals.map((goal) => toGoalRecord(goal));
    return local.sort((a, b) => a.name.localeCompare(b.name));
  }, [storedGoals]);

  useEffect(() => {
    if (storedGoals.some((goal) => !isGoalRecord(goal))) {
      setStoredGoals((prev) => prev.map((goal) => toGoalRecord(goal)));
    }
  }, [setStoredGoals, storedGoals]);

  const loadConnectedTransactions = useCallback(async () => {
    const result = await Promise.allSettled([
      fetchUnifiedStatement({ page_size: 160 }),
    ]);

    const statementResult = result[0];
    if (statementResult.status === "fulfilled") {
      setConnectedTransactions(statementResult.value.transactions ?? []);
    } else {
      setConnectedTransactions([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadConnectedTransactions();
  }, [loadConnectedTransactions]);

  const contributions = useMemo(() => {
    const all = [...connectedTransactions, ...manualTransactions];
    const totalMap = new Map<string, number>();
    const monthMap = new Map<string, number>();
    const currentMonth = monthKeyFromDate(new Date());

    for (const tx of all) {
      const goalTarget = parseGoalContributionTarget(tx);
      if (!goalTarget) continue;
      const key = normalizeGoalName(goalTarget);
      const amount = contributionAmount(tx);

      totalMap.set(key, (totalMap.get(key) ?? 0) + amount);

      const occurred = new Date(tx.occurred_at);
      if (!Number.isNaN(occurred.getTime()) && monthKeyFromDate(occurred) === currentMonth) {
        monthMap.set(key, (monthMap.get(key) ?? 0) + amount);
      }
    }

    return { totalMap, monthMap };
  }, [connectedTransactions, manualTransactions]);

  const goalCards = useMemo<GoalWithMetrics[]>(() => {
    return goals.map((goal) => {
      const key = normalizeGoalName(goal.name);
      const txTotal = contributions.totalMap.get(key) ?? 0;
      const txCurrentMonth = contributions.monthMap.get(key) ?? 0;
      const totalSaved = goal.currentSavedAmount + goal.manualContributionTotal + txTotal;
      const remaining = Math.max(goal.targetAmount - totalSaved, 0);
      const progress = goal.targetAmount > 0
        ? Math.min(Math.round((totalSaved / goal.targetAmount) * 100), 100)
        : 0;

      const monthlyPace = (goal.recurringContribution ?? 0) + txCurrentMonth;
      const estimatedCompletion = estimateCompletion(goal, remaining, monthlyPace);

      return {
        ...goal,
        transactionContributionTotal: txTotal,
        transactionContributionCurrentMonth: txCurrentMonth,
        totalSaved,
        remaining,
        progress,
        estimatedCompletion,
      };
    });
  }, [contributions.monthMap, contributions.totalMap, goals]);

  const totals = useMemo(() => {
    const target = goalCards.reduce((sum, goal) => sum + goal.targetAmount, 0);
    const saved = goalCards.reduce((sum, goal) => sum + goal.totalSaved, 0);
    const remaining = Math.max(target - saved, 0);
    const progress = target > 0 ? Math.round((saved / target) * 100) : 0;

    const manualContributions = goalCards.reduce((sum, goal) => sum + goal.manualContributionTotal, 0);
    const syncedAndManualTx = goalCards.reduce((sum, goal) => sum + goal.transactionContributionTotal, 0);

    return {
      target,
      saved,
      remaining,
      progress,
      manualContributions,
      syncedAndManualTx,
    };
  }, [goalCards]);

  const openCreateGoal = () => {
    setEditingGoalId(null);
    setGoalName("");
    setGoalTargetAmount("");
    setGoalCurrentSavedAmount("");
    setGoalTargetDate("");
    setGoalLinkedAccount("");
    setGoalRecurringContribution("");
    setGoalIcon("🎯");
    setGoalNotes("");
    setGoalError(null);
    setGoalModalOpen(true);
  };

  const openEditGoal = (goal: GoalRecord) => {
    setEditingGoalId(goal.id);
    setGoalName(goal.name);
    setGoalTargetAmount(String(goal.targetAmount));
    setGoalCurrentSavedAmount(String(goal.currentSavedAmount));
    setGoalTargetDate(goal.targetDate ?? "");
    setGoalLinkedAccount(goal.linkedAccount ?? "");
    setGoalRecurringContribution(goal.recurringContribution ? String(goal.recurringContribution) : "");
    setGoalIcon(goal.icon ?? "");
    setGoalNotes(goal.notes ?? "");
    setGoalError(null);
    setGoalModalOpen(true);
  };

  const saveGoal = () => {
    setGoalError(null);

    const name = goalName.trim();
    const targetAmount = Number(goalTargetAmount);
    const currentSavedAmount = Number(goalCurrentSavedAmount || "0");
    const recurringContribution = Number(goalRecurringContribution || "0");

    if (!name) {
      setGoalError("Goal name is required.");
      return;
    }

    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      setGoalError("Target amount must be greater than zero.");
      return;
    }

    if (!Number.isFinite(currentSavedAmount) || currentSavedAmount < 0) {
      setGoalError("Current saved amount must be zero or greater.");
      return;
    }

    if (!Number.isFinite(recurringContribution) || recurringContribution < 0) {
      setGoalError("Recurring contribution must be zero or greater.");
      return;
    }

    setStoredGoals((prev) => {
      const normalized = prev.map((goal) => toGoalRecord(goal));
      const existing = editingGoalId
        ? normalized.find((goal) => goal.id === editingGoalId)
        : null;

      const payload: GoalRecord = {
        id: editingGoalId ?? `goal-${Date.now()}`,
        name,
        targetAmount,
        currentSavedAmount,
        targetDate: goalTargetDate || undefined,
        linkedAccount: goalLinkedAccount.trim() || undefined,
        recurringContribution: recurringContribution > 0 ? recurringContribution : undefined,
        icon: goalIcon.trim() || undefined,
        notes: goalNotes.trim() || undefined,
        manualContributionTotal: existing?.manualContributionTotal ?? 0,
        sourceType: "manual",
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };

      if (!editingGoalId) {
        return [payload, ...normalized];
      }

      return normalized.map((goal) => (goal.id === editingGoalId ? payload : goal));
    });

    setGoalModalOpen(false);
    setEditingGoalId(null);
  };

  const deleteGoal = () => {
    if (!editingGoalId) return;
    setStoredGoals((prev) => prev.map((goal) => toGoalRecord(goal)).filter((goal) => goal.id !== editingGoalId));
    setGoalModalOpen(false);
    setEditingGoalId(null);
  };

  const openContributionModal = (goalId: string) => {
    setContributionModalGoalId(goalId);
    setContributionAmountInput("");
    setContributionError(null);
  };

  const saveManualContribution = () => {
    if (!contributionModalGoalId) return;

    const amount = Number(contributionAmountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setContributionError("Contribution must be greater than zero.");
      return;
    }

    setStoredGoals((prev) =>
      prev.map((goal) => toGoalRecord(goal)).map((goal) =>
        goal.id === contributionModalGoalId
          ? {
              ...goal,
              manualContributionTotal: goal.manualContributionTotal + amount,
            }
          : goal,
      ),
    );

    setContributionModalGoalId(null);
    setContributionAmountInput("");
    setContributionError(null);
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
        title="Goals"
        tabs={[
          { label: "Goals", active: true },
          { label: "Milestones" },
        ]}
        actions={(
          <>
            <ToolbarButton icon={<Wallet size={14} />}>Goal accounts</ToolbarButton>
            <ToolbarButton icon={<CalendarClock size={14} />}>Timeline</ToolbarButton>
            <button
              type="button"
              onClick={openCreateGoal}
              className="aw-button-primary inline-flex h-[38px] items-center gap-1.5 rounded-xl px-4 text-sm"
            >
              <Plus size={14} />
              Add goal
            </button>
            <ManualEntryButton onClick={openCreateGoal}>Add goal</ManualEntryButton>
          </>
        )}
      />

      <div className="aw-workspace-grid" data-columns="2-1">
        <WorkspacePanel title="Goals list">
          {goalCards.length === 0 ? (
            <WorkspaceEmpty
              icon={<Target size={22} />}
              title="No goals yet"
              description="Connect an account for automatic funding signals, or continue manually with contributions and transactions."
              action={(
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "/connect";
                    }}
                    className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Connect an account
                  </button>
                  <button
                    type="button"
                    onClick={openCreateGoal}
                    className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Start goal
                  </button>
                </div>
              )}
              className="min-h-[340px]"
            />
          ) : (
            <div className="space-y-4">
              {goalCards.map((goal) => (
                <div key={goal.id} className="aw-card aw-card-interactive !p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-lg" aria-hidden>
                          {goal.icon || "🎯"}
                        </span>
                        <p className="truncate text-lg font-semibold text-[var(--aw-text)]">{goal.name}</p>
                        {goal.sourceType === "manual" ? <span className="aw-pill">Manual</span> : null}
                      </div>
                      <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
                        {goal.linkedAccount ? `Linked: ${goal.linkedAccount}` : "No linked account"}
                        {goal.targetDate ? ` • Target ${goal.targetDate}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openContributionModal(goal.id)}
                        className="aw-button-secondary inline-flex h-9 items-center rounded-[10px] px-3 text-xs"
                      >
                        Add contribution
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditGoal(goal)}
                        className="aw-button-secondary inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs"
                      >
                        <PencilLine size={12} />
                        Edit
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 h-2 rounded-full bg-[var(--aw-border)]">
                    <div className="h-full rounded-full bg-[var(--aw-primary)]" style={{ width: `${goal.progress}%` }} />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Saved so far</p>
                      <p className="aw-number mt-1 text-sm text-[var(--aw-text)]">{fmt(goal.totalSaved)}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Amount remaining</p>
                      <p className="aw-number mt-1 text-sm text-[var(--aw-text)]">{fmt(goal.remaining)}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Estimated completion</p>
                      <p className="aw-number mt-1 text-sm text-[var(--aw-text)]">{goal.estimatedCompletion}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Monthly contributions</p>
                      <p className="aw-number mt-1 text-sm text-[var(--aw-text)]">
                        {fmt((goal.recurringContribution ?? 0) + goal.transactionContributionCurrentMonth)}
                      </p>
                    </div>
                  </div>

                  {goal.notes ? (
                    <p className="mt-3 text-sm text-[var(--aw-text-muted)]">{goal.notes}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel title="Goal cards" heading={`${totals.progress}%`} action={<span className="aw-pill">Portfolio progress</span>}>
          <div className="space-y-4">
            {goalCards.length === 0 ? (
              <WorkspaceEmpty
                title="No goal cards yet"
                description="Start your first goal manually, or connect an account for automatic funding signals."
                action={(
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = "/connect";
                      }}
                      className="aw-button-secondary inline-flex h-10 items-center rounded-xl px-4 text-sm"
                    >
                      Connect an account
                    </button>
                    <button
                      type="button"
                      onClick={openCreateGoal}
                      className="aw-button-primary inline-flex h-10 items-center rounded-xl px-4 text-sm"
                    >
                      Start goal
                    </button>
                  </div>
                )}
                className="min-h-[210px]"
              />
            ) : (
              goalCards.map((goal) => (
                <div key={`mini-${goal.id}`} className="aw-card aw-card-compact">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-[var(--aw-text)]">
                      {goal.icon || "🎯"} {goal.name}
                    </p>
                    <span className="text-sm font-semibold text-[var(--aw-primary)]">{goal.progress}%</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-[var(--aw-border)]">
                    <div className="h-full rounded-full bg-[var(--aw-primary)]" style={{ width: `${goal.progress}%` }} />
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-[var(--aw-text-muted)]">
                    <p className="aw-number">Saved {fmt(goal.totalSaved)}</p>
                    <p className="aw-number">Remaining {fmt(goal.remaining)}</p>
                    <p>Estimated completion {goal.estimatedCompletion}</p>
                  </div>
                </div>
              ))
            )}

            <div className="aw-card !p-4">
              <p className="text-sm font-semibold text-[var(--aw-text)]">Funding sources</p>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--aw-text-muted)]">Synced + manual transactions</span>
                  <span className="aw-number text-[var(--aw-text)]">{fmt(totals.syncedAndManualTx)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--aw-text-muted)]">Manual contributions</span>
                  <span className="aw-number text-[var(--aw-text)]">{fmt(totals.manualContributions)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--aw-text-muted)]">Total saved across goals</span>
                  <span className="aw-number text-[var(--aw-text)]">{fmt(totals.saved)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--aw-text-muted)]">Total target</span>
                  <span className="aw-number text-[var(--aw-text)]">{fmt(totals.target)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--aw-text-muted)]">Remaining</span>
                  <span className="aw-number text-[var(--aw-text)]">{fmt(totals.remaining)}</span>
                </div>
              </div>
            </div>
          </div>
        </WorkspacePanel>
      </div>

      <ManualEntryModal
        open={goalModalOpen}
        onClose={() => setGoalModalOpen(false)}
        title={editingGoalId ? "Edit goal" : "Add goal"}
        description="Create goals manually from day one, with optional recurring contributions and linked accounts."
      >
        <div className="space-y-4">
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Goal name</span>
            <input
              value={goalName}
              onChange={(event) => setGoalName(event.target.value)}
              className="aw-input h-10 text-sm"
              placeholder="Emergency fund"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Target amount</span>
              <input
                value={goalTargetAmount}
                onChange={(event) => setGoalTargetAmount(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Current saved amount</span>
              <input
                value={goalCurrentSavedAmount}
                onChange={(event) => setGoalCurrentSavedAmount(event.target.value)}
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
              <span className="text-xs text-[var(--aw-text-muted)]">Target date (optional)</span>
              <input
                value={goalTargetDate}
                onChange={(event) => setGoalTargetDate(event.target.value)}
                className="aw-input h-10 text-sm"
                type="date"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Linked account (optional)</span>
              <input
                value={goalLinkedAccount}
                onChange={(event) => setGoalLinkedAccount(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Savings account"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Recurring contribution (optional)</span>
              <input
                value={goalRecurringContribution}
                onChange={(event) => setGoalRecurringContribution(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Emoji or icon (optional)</span>
              <input
                value={goalIcon}
                onChange={(event) => setGoalIcon(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="🏡"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Notes (optional)</span>
            <textarea
              value={goalNotes}
              onChange={(event) => setGoalNotes(event.target.value)}
              className="aw-input min-h-[92px] py-2 text-sm"
              placeholder="Optional notes"
            />
          </label>

          {goalError ? (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {goalError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            {editingGoalId ? (
              <button
                type="button"
                onClick={deleteGoal}
                className="aw-button-danger inline-flex h-10 items-center gap-1.5 px-4 text-sm"
              >
                <Trash2 size={14} />
                Delete goal
              </button>
            ) : <span />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGoalModalOpen(false)}
                className="aw-button-secondary h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveGoal}
                className="aw-button-primary h-10 px-4 text-sm"
              >
                {editingGoalId ? "Save changes" : "Save goal"}
              </button>
            </div>
          </div>
        </div>
      </ManualEntryModal>

      <ManualEntryModal
        open={Boolean(contributionModalGoalId)}
        onClose={() => setContributionModalGoalId(null)}
        title="Add manual contribution"
        description="Record a manual contribution toward this goal."
      >
        <div className="space-y-4">
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Contribution amount</span>
            <input
              value={contributionAmountInput}
              onChange={(event) => setContributionAmountInput(event.target.value)}
              className="aw-input h-10 text-sm"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
            />
          </label>

          {contributionError ? (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {contributionError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setContributionModalGoalId(null)}
              className="aw-button-secondary h-10 px-4 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveManualContribution}
              className="aw-button-primary h-10 px-4 text-sm"
            >
              Add contribution
            </button>
          </div>
        </div>
      </ManualEntryModal>
    </div>
  );
}
