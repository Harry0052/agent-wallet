"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Loader2,
  ListChecks,
  RefreshCw,
  X,
} from "lucide-react";
import {
  attemptTaskCenterAction,
  confirmTaskCenterAction,
  detectTaskCenterActions,
  dismissTaskCenterAction,
  fetchTaskCenterSnapshot,
  reopenTaskCenterAction,
  snoozeTaskCenterAction,
  updateTaskCenterPolicy,
  type TaskCenterSnapshot,
} from "@/services/taskCenter";
import type {
  AutomationActionRecord,
  AutomationActionStatus,
  AutomationPolicyMode,
} from "@/lib/types";
import { fmt } from "@/lib/utils";

function friendlyStatus(status: AutomationActionStatus): string {
  if (status === "pending_confirm") return "Needs your OK";
  if (status === "suggested") return "Suggested";
  if (status === "detected") return "New";
  if (status === "attempted") return "In progress";
  if (status === "completed") return "Done";
  if (status === "failed") return "Failed";
  if (status === "dismissed") return "Dismissed";
  return "Snoozed";
}

function friendlyActionType(value: AutomationActionRecord["actionType"]): string {
  if (value === "subscription_cancel") return "Cancel subscription";
  if (value === "subscription_negotiate") return "Negotiate subscription";
  if (value === "bill_pay") return "Pay bill";
  if (value === "savings_transfer") return "Move to savings";
  if (value === "debt_optimize") return "Optimize debt";
  if (value === "expense_categorization") return "Fix category";
  if (value === "refund_budget") return "Budget refund";
  if (value === "recurring_review") return "Review recurring charge";
  if (value === "trial_conversion_review") return "Free trial ending";
  return "Split expense";
}

function statusBadgeClass(status: AutomationActionStatus): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "pending_confirm") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "dismissed") return "border-zinc-200 bg-zinc-50 text-zinc-600";
  return "border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] text-[var(--aw-text)]";
}

function friendlyPolicyLabel(mode: AutomationPolicyMode): string {
  if (mode === "suggest_only") return "Suggest only";
  if (mode === "user_confirm_required") return "Ask me first";
  return "Let Calico act";
}

export function TaskCenterView() {
  const [snapshot, setSnapshot] = useState<TaskCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [lastNotice, setLastNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchTaskCenterSnapshot();
      setSnapshot(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = snapshot?.actions || [];
  const activeActions = useMemo(
    () => actions.filter((action) => action.status !== "completed" && action.status !== "dismissed"),
    [actions],
  );
  const needsAttention = useMemo(
    () => activeActions.filter((a) => a.status === "pending_confirm" || a.status === "detected" || a.status === "suggested"),
    [activeActions],
  );

  const runDetect = async () => {
    setError(null);
    setLastNotice(null);
    try {
      const result = await detectTaskCenterActions();
      const count = result.result.detected;
      setLastNotice(count > 0 ? `Found ${count} new thing${count === 1 ? "" : "s"} to look at.` : "Nothing new right now.");
      await load();
    } catch (detectError) {
      setError(detectError instanceof Error ? detectError.message : "Check failed.");
    }
  };

  const withBusy = async (actionId: string, fn: () => Promise<void>) => {
    setBusyActionId(actionId);
    setError(null);
    setLastNotice(null);
    try {
      await fn();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setBusyActionId(null);
    }
  };

  const updateDefaultPolicy = async (next: AutomationPolicyMode) => {
    setPolicySaving(true);
    setError(null);
    try {
      await updateTaskCenterPolicy({ defaultMode: next });
      await load();
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : "Failed to update.");
    } finally {
      setPolicySaving(false);
    }
  };

  return (
    <div className="aw-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--aw-text)]">To-Do</h1>
          <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
            Things Calico found that might save you money or need your attention.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void runDetect(); }}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--aw-border)] bg-white px-4 text-sm font-semibold text-[var(--aw-text)] transition hover:bg-[var(--aw-surface-subtle)]"
        >
          <RefreshCw size={15} />
          Check for new items
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {lastNotice ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {lastNotice}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
        </div>
      ) : (
        <>
          {needsAttention.length > 0 ? (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">
                {needsAttention.length} item{needsAttention.length === 1 ? " needs" : "s need"} your attention
              </p>
            </div>
          ) : null}

          <section className="mt-5 rounded-xl border border-[var(--aw-border)] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--aw-text)]">When Calico finds something</p>
                <p className="text-xs text-[var(--aw-text-muted)]">Choose how much control you want.</p>
              </div>
              <select
                value={snapshot?.policy.defaultMode || "user_confirm_required"}
                onChange={(event) => { void updateDefaultPolicy(event.target.value as AutomationPolicyMode); }}
                disabled={policySaving}
                className="h-9 rounded-lg border border-[var(--aw-border)] bg-white px-3 text-sm text-[var(--aw-text)]"
              >
                <option value="suggest_only">{friendlyPolicyLabel("suggest_only")}</option>
                <option value="user_confirm_required">{friendlyPolicyLabel("user_confirm_required")}</option>
                <option value="autopilot_allowed">{friendlyPolicyLabel("autopilot_allowed")}</option>
              </select>
            </div>
          </section>

          <section className="mt-5 space-y-3">
            {activeActions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--aw-border)] bg-white px-4 py-16 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--aw-surface-subtle)]">
                  <ListChecks size={22} className="text-[var(--aw-text-muted)]" />
                </div>
                <p className="text-sm font-semibold text-[var(--aw-text)]">You're all caught up</p>
                <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
                  Calico will add items here when it spots something worth doing.
                </p>
              </div>
            ) : (
              activeActions.map((action) => {
                const busy = busyActionId === action.id;
                return (
                  <article key={action.id} className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--aw-text)]">{action.title}</p>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(action.status)}`}>
                            {friendlyStatus(action.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                          {friendlyActionType(action.actionType)}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-[var(--aw-text-muted)]">{action.summary}</p>

                    {action.amount !== null ? (
                      <p className="mt-2 text-sm font-semibold text-[var(--aw-text)]">
                        {fmt(action.amount)}{action.currency ? ` ${action.currency.toUpperCase()}` : ""}
                      </p>
                    ) : null}

                    {action.explainability.factors.length > 0 ? (
                      <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
                        {action.explainability.factors[0]}
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {(action.status === "pending_confirm" || action.status === "suggested" || action.status === "detected") ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { void withBusy(action.id, async () => { await confirmTaskCenterAction(action.id); }); }}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--aw-primary)] px-3 text-xs font-semibold text-[var(--aw-text)]"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                          Do it
                        </button>
                      ) : null}

                      {(action.status === "pending_confirm" || action.status === "suggested" || action.status === "failed") ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { void withBusy(action.id, async () => { const result = await attemptTaskCenterAction(action.id); setLastNotice(result.result.message); }); }}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--aw-border)] bg-white px-3 text-xs font-semibold text-[var(--aw-text)]"
                        >
                          Review details
                        </button>
                      ) : null}

                      {action.status === "snoozed" || action.status === "failed" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { void withBusy(action.id, async () => { await reopenTaskCenterAction(action.id); }); }}
                          className="inline-flex h-9 items-center rounded-lg border border-[var(--aw-border)] bg-white px-3 text-xs font-semibold text-[var(--aw-text)]"
                        >
                          Try again
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { void withBusy(action.id, async () => { await snoozeTaskCenterAction(action.id, 3); }); }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--aw-border)] bg-white px-3 text-xs font-semibold text-[var(--aw-text-muted)]"
                      >
                        <Clock size={13} />
                        Later
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { void withBusy(action.id, async () => { await dismissTaskCenterAction(action.id); }); }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--aw-border)] bg-white px-3 text-xs font-semibold text-[var(--aw-text-muted)]"
                      >
                        <X size={13} />
                        Not interested
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </>
      )}
    </div>
  );
}
