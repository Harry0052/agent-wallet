"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, Loader2 } from "lucide-react";
import { fmt } from "@/lib/utils";
import type { Insight } from "@/lib/types";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { MANUAL_STORAGE_KEYS, type ManualAccountRecord } from "@/lib/manualMode";
import type { StatementTransaction } from "@/services/statements";
import { normalizeTransactionType } from "@/lib/manualTransactions";
import { useFinancialData } from "@/lib/useFinancialData";

interface LocalInsight {
  id: string;
  title: string;
  summary: string;
  severity: "info" | "warning" | "action_needed";
  amountImpact?: number;
}

function generateLocalInsights(
  accounts: ManualAccountRecord[],
  transactions: StatementTransaction[],
  goals: Array<{ name?: string; label?: string; targetAmount?: number; currentSavedAmount?: number; saved?: number }>,
): LocalInsight[] {
  const insights: LocalInsight[] = [];

  // Spending patterns from manual transactions
  const expenses = transactions.filter((tx) => normalizeTransactionType(tx) === "expense");
  const income = transactions.filter((tx) => normalizeTransactionType(tx) === "income");
  const totalExpenses = expenses.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const totalIncome = income.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  if (totalIncome > 0 && totalExpenses > 0) {
    const savingsRate = Math.round(((totalIncome - totalExpenses) / totalIncome) * 100);
    if (savingsRate < 10) {
      insights.push({
        id: "local-low-savings-rate",
        title: "Your savings rate is low",
        summary: `You're saving about ${savingsRate}% of your income. Aim for 20% or more to build a cushion faster.`,
        severity: "warning",
      });
    } else if (savingsRate >= 20) {
      insights.push({
        id: "local-good-savings-rate",
        title: "Solid savings rate",
        summary: `You're saving about ${savingsRate}% of your income — that's a healthy pace. Keep it up.`,
        severity: "info",
      });
    }
  }

  // Top spending category
  if (expenses.length >= 3) {
    const categoryMap = new Map<string, number>();
    for (const tx of expenses) {
      const cat = (tx.category || "uncategorized").trim().toLowerCase().replace(/_/g, " ");
      categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + Math.abs(tx.amount));
    }
    const sorted = [...categoryMap.entries()].sort((a, b) => b[1] - a[1]);
    const topCategory = sorted[0];
    if (topCategory && topCategory[1] > 0) {
      const pct = totalExpenses > 0 ? Math.round((topCategory[1] / totalExpenses) * 100) : 0;
      if (pct >= 40) {
        insights.push({
          id: "local-top-category-heavy",
          title: `${topCategory[0].charAt(0).toUpperCase() + topCategory[0].slice(1)} is your biggest expense`,
          summary: `${pct}% of your spending goes to ${topCategory[0]}. See if there's room to trim.`,
          severity: "info",
          amountImpact: topCategory[1],
        });
      }
    }
  }

  // Goal progress
  for (const goal of goals) {
    const name = goal.name ?? goal.label ?? "";
    const target = Number(goal.targetAmount ?? 0);
    const saved = Number(goal.currentSavedAmount ?? goal.saved ?? 0);
    if (!name || target <= 0) continue;
    const progress = Math.round((saved / target) * 100);
    if (progress >= 75 && progress < 100) {
      insights.push({
        id: `local-goal-close-${name}`,
        title: `Almost there on "${name}"`,
        summary: `You're ${progress}% of the way to your ${fmt(target)} goal. ${fmt(target - saved)} left to go.`,
        severity: "info",
        amountImpact: target - saved,
      });
    }
  }

  // Liability awareness
  const liabilities = accounts.filter((a) => a.balance < 0);
  const totalDebt = liabilities.reduce((sum, a) => sum + Math.abs(a.balance), 0);
  if (totalDebt > 0) {
    insights.push({
      id: "local-debt-awareness",
      title: `You have ${fmt(totalDebt)} in tracked debt`,
      summary: `Across ${liabilities.length} account${liabilities.length === 1 ? "" : "s"}. Consider setting a payoff goal to track progress.`,
      severity: liabilities.length >= 3 ? "warning" : "info",
      amountImpact: totalDebt,
    });
  }

  // No data nudge
  if (accounts.length === 0 && transactions.length === 0 && goals.length === 0) {
    insights.push({
      id: "local-getting-started",
      title: "Start tracking to get insights",
      summary: "Add an account, transaction, or goal and Calico will start spotting patterns in your money.",
      severity: "info",
    });
  } else if (transactions.length < 3 && accounts.length > 0) {
    insights.push({
      id: "local-more-data-needed",
      title: "Calico needs more data",
      summary: "Add a few more transactions — manual or connected — and insights will get more specific and useful.",
      severity: "info",
    });
  }

  return insights;
}

export function InsightsView() {
  const [serverInsights, setServerInsights] = useState<Insight[]>([]);
  const [serverLoading, setServerLoading] = useState(true);
  const [, setServerFailed] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [dismissing, setDismissing] = useState<string | null>(null);

  // Use the shared financial data hook so insights reflect ALL data
  const financialData = useFinancialData();

  const [storedGoals] = useLocalStorageState<Array<{ name?: string; label?: string; targetAmount?: number; currentSavedAmount?: number; saved?: number }>>(
    MANUAL_STORAGE_KEYS.goals,
    [],
  );

  const load = useCallback(async () => {
    setServerLoading(true);
    setServerFailed(false);
    try {
      const res = await fetch("/api/insights", { cache: "no-store" });
      if (!res.ok) {
        setServerFailed(true);
        setServerInsights([]);
      } else {
        const body = (await res.json()) as { insights?: Insight[] };
        setServerInsights(body.insights ?? []);
      }
    } catch {
      setServerFailed(true);
      setServerInsights([]);
    } finally {
      setServerLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loading = serverLoading || financialData.loading;

  // Use ALL merged transactions (connected + manual + cashflow + reports)
  // and ALL merged accounts for insight generation
  const localInsights = useMemo(
    () => generateLocalInsights(financialData.manualAccounts, financialData.allTransactions, storedGoals),
    [financialData.manualAccounts, financialData.allTransactions, storedGoals],
  );

  const activeServerInsights = serverInsights
    .filter((i) => i.status === "active" && !dismissedIds.has(i.id))
    .slice(0, 6);

  const activeLocalInsights = localInsights.filter((i) => !dismissedIds.has(i.id));

  // Server insights first, then local insights that don't duplicate server ones
  const allInsights = useMemo(() => {
    const serverIds = new Set(activeServerInsights.map((i) => i.id));
    const uniqueLocal = activeLocalInsights.filter((i) => !serverIds.has(i.id));
    return [
      ...activeServerInsights.map((i) => ({ id: i.id, title: i.title, summary: i.summary, severity: i.severity, amountImpact: i.amountImpact, isServer: true })),
      ...uniqueLocal.map((i) => ({ ...i, isServer: false })),
    ];
  }, [activeLocalInsights, activeServerInsights]);

  const dismiss = async (id: string, isServer: boolean) => {
    setDismissedIds((prev) => new Set([...prev, id]));

    if (isServer) {
      setDismissing(id);
      try {
        await fetch("/api/insights", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "dismiss" }),
        });
      } catch {
        // Silent — already removed from UI
      } finally {
        setDismissing(null);
      }
    }
  };

  const severityStyle = (severity: string) => {
    if (severity === "warning" || severity === "action_needed") {
      return "border-amber-200 bg-amber-50/50";
    }
    return "border-[var(--aw-border)] bg-white";
  };

  return (
    <div className="aw-page">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--aw-text)]">What Calico Noticed</h1>
        <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
          Patterns and suggestions based on your accounts, transactions, and goals.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
        </div>
      ) : allInsights.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--aw-surface-subtle)]">
            <Lightbulb size={24} className="text-[var(--aw-text-muted)]" />
          </div>
          <p className="text-sm font-semibold text-[var(--aw-text)]">Nothing to report yet</p>
          <p className="mt-1 max-w-xs text-sm leading-relaxed text-[var(--aw-text-muted)]">
            Calico generates insights from your accounts, transactions, and goals. Add more data and check back.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/accounts"
              className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold"
            >
              Add an account
            </Link>
            <Link
              href="/transactions"
              className="aw-button-primary inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold"
            >
              Add a transaction
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {allInsights.map((insight) => (
            <article
              key={insight.id}
              className={`rounded-xl border px-4 py-3.5 ${severityStyle(insight.severity)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--aw-text)]">{insight.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--aw-text-muted)]">
                    {insight.summary}
                  </p>
                  {insight.amountImpact ? (
                    <p className="mt-1.5 text-xs font-semibold text-[var(--aw-text)]">
                      {fmt(insight.amountImpact)}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => { void dismiss(insight.id, insight.isServer); }}
                  disabled={dismissing === insight.id}
                  className="shrink-0 rounded-lg bg-[var(--aw-surface-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--aw-text-muted)] transition hover:bg-[var(--aw-border)]"
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
