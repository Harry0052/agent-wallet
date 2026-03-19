"use client";

import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  PencilLine,
  Plus,
  Target,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/utils";
import {
  ManualEntryModal,
} from "@/components/finance/ManualDataControls";
import { WorkspaceHeader, WorkspacePanel } from "@/components/finance/WorkspacePrimitives";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { MANUAL_STORAGE_KEYS } from "@/lib/manualMode";
import { contributionAmount, parseGoalContributionTarget } from "@/lib/manualTransactions";
import { useFinancialData } from "@/lib/useFinancialData";

type GoalSource = "manual" | "connected";
type GoalPriority = "high" | "medium" | "low";

const PRIORITY_SORT_ORDER: Record<GoalPriority, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABELS: Record<GoalPriority, string> = { high: "High", medium: "Medium", low: "Low" };
const PRIORITY_COLORS: Record<GoalPriority, string> = {
  high: "text-red-600 bg-red-50",
  medium: "text-amber-600 bg-amber-50",
  low: "text-violet-600 bg-violet-50",
};

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
  goalType?: "save-up" | "pay-down";
  priority?: GoalPriority;
  image?: string;
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

function normalizePriority(value: unknown): GoalPriority {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
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
      priority: normalizePriority(goal.priority),
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
    priority: "medium",
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

function getGoalStatus(goal: GoalWithMetrics): "on-track" | "at-risk" | "completed" {
  if (goal.progress >= 100) return "completed";

  if (!goal.recurringContribution && goal.transactionContributionCurrentMonth === 0) {
    return "at-risk";
  }

  if (goal.targetDate) {
    const targetDate = new Date(`${goal.targetDate}T12:00:00.000Z`);
    const now = new Date();
    const monthsUntilTarget = (targetDate.getFullYear() - now.getFullYear()) * 12 + (targetDate.getMonth() - now.getMonth());
    const monthlyPace = (goal.recurringContribution ?? 0) + goal.transactionContributionCurrentMonth;
    const monthsNeeded = monthlyPace > 0 ? Math.ceil(goal.remaining / monthlyPace) : Infinity;

    if (monthsNeeded > monthsUntilTarget) {
      return "at-risk";
    }
  }

  return "on-track";
}

export function GoalsView() {
  const financialData = useFinancialData();
  const [storedGoals, setStoredGoals] = useLocalStorageState<StoredGoal[]>(
    MANUAL_STORAGE_KEYS.goals,
    [],
  );

  const [activeTab, setActiveTab] = useState<"save-up" | "pay-down">("save-up");
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<"select" | "targets" | "contribution" | "budget">("select");
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalType, setGoalType] = useState<"save-up" | "pay-down">("save-up");
  const [goalName, setGoalName] = useState("");
  const [goalTargetAmount, setGoalTargetAmount] = useState("");
  const [goalCurrentSavedAmount, setGoalCurrentSavedAmount] = useState("");
  const [goalTargetDate, setGoalTargetDate] = useState("");
  const [goalLinkedAccount, setGoalLinkedAccount] = useState("");
  const [goalRecurringContribution, setGoalRecurringContribution] = useState("");
  const [goalIcon, setGoalIcon] = useState("");
  const [goalPriority, setGoalPriority] = useState<GoalPriority>("medium");
  const [goalNotes, setGoalNotes] = useState("");
  const [goalImage, setGoalImage] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);

  const [contributionModalGoalId, setContributionModalGoalId] = useState<string | null>(null);
  const [contributionAmountInput, setContributionAmountInput] = useState("");
  const [contributionError, setContributionError] = useState<string | null>(null);

  const goals = useMemo(() => {
    const local = storedGoals.map((goal) => toGoalRecord(goal));
    return local.sort((a, b) => {
      const aPriority = PRIORITY_SORT_ORDER[a.priority ?? "medium"];
      const bPriority = PRIORITY_SORT_ORDER[b.priority ?? "medium"];
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.name.localeCompare(b.name);
    });
  }, [storedGoals]);

  useEffect(() => {
    if (storedGoals.some((goal) => !isGoalRecord(goal))) {
      setStoredGoals((prev) => prev.map((goal) => toGoalRecord(goal)));
    }
  }, [setStoredGoals, storedGoals]);

  const contributions = useMemo(() => {
    const totalMap = new Map<string, number>();
    const monthMap = new Map<string, number>();
    const currentMonth = monthKeyFromDate(new Date());

    for (const tx of financialData.allTransactions) {
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
  }, [financialData.allTransactions]);

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

  const filteredGoals = useMemo(() => {
    return goalCards.filter((goal) => (goal.goalType ?? "save-up") === activeTab);
  }, [goalCards, activeTab]);

  const openCreateGoal = (type: "save-up" | "pay-down" = activeTab) => {
    setEditingGoalId(null);
    setGoalType(type);
    setModalStep("select");
    setGoalName("");
    setGoalTargetAmount("");
    setGoalCurrentSavedAmount("");
    setGoalTargetDate("");
    setGoalLinkedAccount("");
    setGoalRecurringContribution("");
    setGoalIcon("🎯");
    setGoalPriority("medium");
    setGoalImage("");
    setGoalNotes("");
    setGoalError(null);
    setGoalModalOpen(true);
  };

  const openEditGoal = (goal: GoalRecord) => {
    setEditingGoalId(goal.id);
    setGoalType(goal.goalType ?? "save-up");
    setModalStep("select");
    setGoalName(goal.name);
    setGoalTargetAmount(String(goal.targetAmount));
    setGoalCurrentSavedAmount(String(goal.currentSavedAmount));
    setGoalTargetDate(goal.targetDate ?? "");
    setGoalLinkedAccount(goal.linkedAccount ?? "");
    setGoalRecurringContribution(goal.recurringContribution ? String(goal.recurringContribution) : "");
    setGoalIcon(goal.icon ?? "");
    setGoalPriority(goal.priority ?? "medium");
    setGoalImage(goal.image ?? "");
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
        goalType,
        priority: goalPriority,
        targetDate: goalTargetDate || undefined,
        linkedAccount: goalLinkedAccount.trim() || undefined,
        recurringContribution: recurringContribution > 0 ? recurringContribution : undefined,
        icon: goalIcon.trim() || undefined,
        image: goalImage.trim() || undefined,
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
    setModalStep("select");
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

  if (financialData.loading) {
    return (
      <div className="aw-page flex items-center justify-center py-32">
        <Loader2 size={20} className="animate-spin text-[var(--calico-primary, #FDBA74)]" />
      </div>
    );
  }

  return (
    <div className="aw-page">
      <div className="px-4 py-6">
        <WorkspaceHeader
          title="Money Goals"
          subtitle="Track what you're saving for or paying down, with progress based on the same transaction history used across Calico."
          actions={(
            <button
              type="button"
              onClick={() => openCreateGoal()}
              className="aw-button-primary inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm"
            >
              <Plus size={16} />
              Add goal
            </button>
          )}
        />

        <div className="mb-6 flex gap-3 border-b border-[var(--aw-border)]">
          <button
            type="button"
            onClick={() => setActiveTab("save-up")}
            className={`pb-3 text-sm font-medium transition-colors ${
              activeTab === "save-up"
                ? "border-b-2 border-[var(--calico-primary, #FDBA74)] text-[var(--aw-text)]"
                : "text-[var(--aw-text-muted)] hover:text-[var(--aw-text)]"
            }`}
          >
            Saving up
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("pay-down")}
            className={`pb-3 text-sm font-medium transition-colors ${
              activeTab === "pay-down"
                ? "border-b-2 border-[var(--calico-primary, #FDBA74)] text-[var(--aw-text)]"
                : "text-[var(--aw-text-muted)] hover:text-[var(--aw-text)]"
            }`}
          >
            Paying off
          </button>
        </div>

        {activeTab === "save-up" && !goals.some((g) => {
          const n = g.name.toLowerCase();
          return n.includes("emergency") || n.includes("rainy day") || n.includes("safety");
        }) && filteredGoals.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-xl">🐱</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">Calico suggests: Start an emergency fund</p>
                <p className="mt-1 text-xs text-amber-700">
                  An emergency fund is the most important goal you can have. It helps when life gets expensive unexpectedly — car repairs, medical bills, or a surprise expense. Calico recommends building this before fun goals.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setGoalType("save-up");
                    setModalStep("targets");
                    setGoalName("Emergency Fund");
                    setGoalTargetAmount("1000");
                    setGoalCurrentSavedAmount("");
                    setGoalTargetDate("");
                    setGoalLinkedAccount("");
                    setGoalRecurringContribution("");
                    setGoalIcon("🛡️");
                    setGoalPriority("high");
                    setGoalImage("");
                    setGoalNotes("Safety cushion for unexpected expenses");
                    setGoalError(null);
                    setEditingGoalId(null);
                    setGoalModalOpen(true);
                  }}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-medium text-white hover:bg-amber-700"
                >
                  <Plus size={14} />
                  Create Emergency Fund
                </button>
              </div>
            </div>
          </div>
        )}

        {filteredGoals.length === 0 ? (
          <WorkspacePanel className="!p-0">
            <div className="aw-card !border-0 !shadow-none !p-8 text-center">
            <Target size={32} className="mx-auto mb-3 text-[var(--aw-text-muted)]" />
            <p className="text-[var(--aw-text)]">No {activeTab === "save-up" ? "savings" : "payoff"} goals yet</p>
            <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
              {activeTab === "save-up"
                ? "Start with an emergency fund — it's the most important goal to have."
                : "Add what you owe so Calico can help you pay it off faster."}
            </p>
            <button
              type="button"
              onClick={() => openCreateGoal()}
              className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--calico-primary, #FDBA74)] px-4 text-sm font-medium text-[var(--aw-text)]"
            >
              <Plus size={16} />
              Add a goal
            </button>
            </div>
          </WorkspacePanel>
        ) : (
          <WorkspacePanel className="!p-0">
            <div className="space-y-3 mb-8">
            {filteredGoals.map((goal) => {
              const status = getGoalStatus(goal);
              const statusColor = status === "completed" ? "text-green-600" : status === "at-risk" ? "text-orange-500" : "text-green-600";
              const statusBg = status === "completed" ? "bg-green-50" : status === "at-risk" ? "bg-orange-50" : "bg-green-50";
              const statusText = status === "completed" ? "Done!" : status === "at-risk" ? "Needs attention" : "Looking good";
              const priority = goal.priority ?? "medium";

              return (
                <div key={goal.id} className="aw-card !p-0 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="flex gap-4 p-4">
                    {goal.image && (
                      <div className="h-24 w-24 flex-shrink-0 rounded-lg bg-[var(--aw-surface-subtle)] overflow-hidden">
                        <img src={goal.image} alt={goal.name} className="h-full w-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {goal.icon && <span className="text-lg">{goal.icon}</span>}
                            <h3 className="truncate text-base font-semibold text-[var(--aw-text)]">{goal.name}</h3>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_COLORS[priority]}`}>
                              {PRIORITY_LABELS[priority]}
                            </span>
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusBg} ${statusColor}`}>
                              {status === "completed" ? <CheckCircle2 size={12} /> : status === "at-risk" ? <AlertCircle size={12} /> : null}
                              {statusText}
                            </span>
                          </div>
                          {goal.targetDate ? (
                            <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                              Finish by {goal.targetDate}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditGoal(goal)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--aw-surface-subtle)] text-[var(--aw-text-muted)]"
                            title="Edit goal"
                          >
                            <PencilLine size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openContributionModal(goal.id)}
                            className="inline-flex h-8 items-center px-2 rounded-lg hover:bg-[var(--aw-surface-subtle)] text-xs text-[var(--aw-text-muted)]"
                            title="Add contribution"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        <div>
                          <div className="flex justify-between gap-2 mb-1">
                            <span className="text-xs text-[var(--aw-text-muted)]">{fmt(goal.totalSaved)} of {fmt(goal.targetAmount)}</span>
                            <span className="text-xs font-medium text-[var(--aw-text)]">{goal.progress}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[var(--aw-border)]">
                            <div
                              className="h-full rounded-full bg-[var(--calico-primary, #FDBA74)]"
                              style={{ width: `${goal.progress}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex gap-4 text-xs text-[var(--aw-text-muted)]">
                          <span>{fmt(goal.remaining)} left to go</span>
                          <span>{fmt((goal.recurringContribution ?? 0) + goal.transactionContributionCurrentMonth)}/month</span>
                          <span>Done by {goal.estimatedCompletion}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </WorkspacePanel>
        )}

        {filteredGoals.length > 0 && (
          <WorkspacePanel className="mt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[var(--aw-text)]">
                  {activeTab === "save-up" ? "Keep going!" : "You're making progress"}
                </h3>
                <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
                  {activeTab === "save-up"
                    ? "Add more goals as you go. Calico suggests starting with safety, then fun."
                    : "Add everything you owe so Calico can help you plan the best payoff order."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openCreateGoal()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--calico-primary, #FDBA74)] px-4 text-sm font-medium text-[var(--aw-text)]"
              >
                <Plus size={16} />
                Add another goal
              </button>
            </div>
          </WorkspacePanel>
        )}
      </div>

      <ManualEntryModal
        open={goalModalOpen}
        onClose={() => setGoalModalOpen(false)}
        title={editingGoalId ? "Edit goal" : "New money goal"}
        description={
          modalStep === "select"
            ? "What kind of goal is this?"
            : modalStep === "targets"
              ? "How much do you need?"
              : modalStep === "contribution"
                ? "How will you save for it?"
                : "Connect it to an account (optional)"
        }
      >
        <div className="space-y-4">
          {modalStep === "select" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setGoalType("save-up");
                  setModalStep("targets");
                }}
                className="aw-card aw-card-interactive !p-4 w-full text-left"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-[var(--aw-text)]">Save up for something</h4>
                    <p className="mt-1 text-sm text-[var(--aw-text-muted)]">Emergency fund, vacation, new car, anything</p>
                  </div>
                  <ChevronRight size={20} className="text-[var(--aw-text-muted)]" />
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setGoalType("pay-down");
                  setModalStep("targets");
                }}
                className="aw-card aw-card-interactive !p-4 w-full text-left"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-[var(--aw-text)]">Pay off something you owe</h4>
                    <p className="mt-1 text-sm text-[var(--aw-text-muted)]">Credit card, student loan, car payment, etc.</p>
                  </div>
                  <ChevronRight size={20} className="text-[var(--aw-text-muted)]" />
                </div>
              </button>
            </div>
          )}

          {modalStep === "targets" && (
            <div className="space-y-4">
              <label className="space-y-1">
                <span className="text-xs text-[var(--aw-text-muted)]">Goal name</span>
                <input
                  value={goalName}
                  onChange={(event) => setGoalName(event.target.value)}
                  className="aw-input h-10 text-sm"
                  placeholder={goalType === "save-up" ? "Emergency fund" : "Credit card debt"}
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
                  <span className="text-xs text-[var(--aw-text-muted)]">Current amount</span>
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
                  <span className="text-xs text-[var(--aw-text-muted)]">Priority</span>
                  <select
                    value={goalPriority}
                    onChange={(event) => setGoalPriority(event.target.value as GoalPriority)}
                    className="aw-input h-10 text-sm"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--aw-text-muted)]">Target date (optional)</span>
                  <input
                    value={goalTargetDate}
                    onChange={(event) => setGoalTargetDate(event.target.value)}
                    className="aw-input h-10 text-sm"
                    type="date"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-[var(--aw-text-muted)]">Icon (optional)</span>
                  <input
                    value={goalIcon}
                    onChange={(event) => setGoalIcon(event.target.value)}
                    className="aw-input h-10 text-sm"
                    placeholder="🏡"
                  />
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-xs text-[var(--aw-text-muted)]">Photo URL (optional)</span>
                <input
                  value={goalImage}
                  onChange={(event) => setGoalImage(event.target.value)}
                  className="aw-input h-10 text-sm"
                  placeholder="https://example.com/image.jpg"
                />
              </label>
            </div>
          )}

          {modalStep === "contribution" && (
            <div className="space-y-4">
              <label className="space-y-1">
                <span className="text-xs text-[var(--aw-text-muted)]">Monthly contribution (optional)</span>
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
                <span className="text-xs text-[var(--aw-text-muted)]">Notes (optional)</span>
                <textarea
                  value={goalNotes}
                  onChange={(event) => setGoalNotes(event.target.value)}
                  className="aw-input min-h-[92px] py-2 text-sm"
                  placeholder="Optional notes about this goal"
                />
              </label>
            </div>
          )}

          {modalStep === "budget" && (
            <div className="space-y-4">
              <label className="space-y-1">
                <span className="text-xs text-[var(--aw-text-muted)]">Linked account (optional)</span>
                <input
                  value={goalLinkedAccount}
                  onChange={(event) => setGoalLinkedAccount(event.target.value)}
                  className="aw-input h-10 text-sm"
                  placeholder="Savings account, credit card, etc."
                />
              </label>

              <div className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
                <p className="text-sm text-[var(--aw-text-muted)]">
                  You can link this goal to a budget or account later for automatic tracking.
                </p>
              </div>
            </div>
          )}

          {goalError ? (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {goalError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            {editingGoalId && modalStep === "select" ? (
              <button
                type="button"
                onClick={deleteGoal}
                className="inline-flex h-10 items-center gap-1.5 px-4 text-sm text-[var(--aw-danger)]"
              >
                <Trash2 size={14} />
                Delete goal
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (modalStep === "select") {
                    setGoalModalOpen(false);
                  } else if (modalStep === "targets") {
                    setModalStep("select");
                  } else if (modalStep === "contribution") {
                    setModalStep("targets");
                  } else {
                    setModalStep("contribution");
                  }
                }}
                className="h-10 px-4 text-sm text-[var(--aw-text-muted)] hover:text-[var(--aw-text)]"
              >
                {modalStep === "select" ? "Cancel" : "Back"}
              </button>
              {modalStep !== "budget" && (
                <button
                  type="button"
                  onClick={() => {
                    if (modalStep === "targets") {
                      setModalStep("contribution");
                    } else if (modalStep === "contribution") {
                      setModalStep("budget");
                    }
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[var(--calico-primary, #FDBA74)] px-4 text-sm font-medium text-[var(--aw-text)]"
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              )}
              {modalStep === "budget" && (
                <button
                  type="button"
                  onClick={saveGoal}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[var(--calico-primary, #FDBA74)] px-4 text-sm font-medium text-[var(--aw-text)]"
                >
                  {editingGoalId ? "Save changes" : "Create goal"}
                </button>
              )}
            </div>
          </div>
        </div>
      </ManualEntryModal>

      <ManualEntryModal
        open={Boolean(contributionModalGoalId)}
        onClose={() => setContributionModalGoalId(null)}
        title="Add money to this goal"
        description="How much did you put toward this goal?"
      >
        <div className="space-y-4">
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Amount</span>
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
              Add it
            </button>
          </div>
        </div>
      </ManualEntryModal>
    </div>
  );
}
