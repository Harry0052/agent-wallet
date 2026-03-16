"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  ShieldCheck,
  TimerReset,
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

function statusLabel(status: AutomationActionStatus): string {
  if (status === "pending_confirm") return "Pending confirmation";
  if (status === "suggested") return "Suggested";
  if (status === "detected") return "Detected";
  if (status === "attempted") return "Attempted";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "dismissed") return "Dismissed";
  return "Snoozed";
}

function actionTypeLabel(value: AutomationActionRecord["actionType"]): string {
  if (value === "subscription_cancel") return "Subscription cancel";
  if (value === "subscription_negotiate") return "Subscription negotiation";
  if (value === "bill_pay") return "Bill pay";
  if (value === "savings_transfer") return "Savings transfer";
  if (value === "debt_optimize") return "Debt optimization";
  if (value === "expense_categorization") return "Expense categorization";
  if (value === "refund_budget") return "Refund budgeting";
  if (value === "recurring_review") return "Recurring detection";
  if (value === "trial_conversion_review") return "Trial conversion detection";
  return "Bill splitting";
}

function statusClass(status: AutomationActionStatus): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "pending_confirm") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "dismissed") return "border-zinc-200 bg-zinc-50 text-zinc-600";
  return "border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] text-[var(--aw-text)]";
}

function policyLabel(mode: AutomationPolicyMode): string {
  if (mode === "suggest_only") return "Suggest only";
  if (mode === "user_confirm_required") return "User confirm required";
  return "Autopilot allowed";
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
      setError(loadError instanceof Error ? loadError.message : "Failed to load task center.");
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

  const runDetect = async () => {
    setError(null);
    setLastNotice(null);
    try {
      const result = await detectTaskCenterActions();
      setLastNotice(`Detected ${result.result.detected} action(s), suppressed ${result.result.suppressed}.`);
      await load();
    } catch (detectError) {
      setError(detectError instanceof Error ? detectError.message : "Detection failed.");
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
      setError(policyError instanceof Error ? policyError.message : "Policy update failed.");
    } finally {
      setPolicySaving(false);
    }
  };

  const toggleAutopilot = async (action: AutomationActionRecord, enabled: boolean) => {
    setPolicySaving(true);
    setError(null);
    try {
      await updateTaskCenterPolicy({
        autopilotEnabledActions: {
          [action.actionType]: enabled,
        },
        explicitConfirmEnabledActions: action.requiresExplicitConfirmation
          ? {
              [action.actionType]: enabled,
            }
          : undefined,
      });
      await load();
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : "Policy update failed.");
    } finally {
      setPolicySaving(false);
    }
  };

  return (
    <div className="aw-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--aw-text)]">Task Center</h1>
          <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
            Every automation action is permission-aware, explainable, and auditable before execution.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void runDetect();
          }}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--aw-border)] bg-white px-4 text-sm font-semibold text-[var(--aw-text)] transition hover:bg-[var(--aw-surface-subtle)]"
        >
          <TimerReset size={16} />
          Detect actions
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
          <section className="mt-6 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--aw-text-muted)]">Active</p>
              <p className="mt-2 text-2xl font-semibold text-[var(--aw-text)]">{snapshot?.summary.activeCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--aw-text-muted)]">Need confirm</p>
              <p className="mt-2 text-2xl font-semibold text-[var(--aw-text)]">{snapshot?.summary.pendingConfirmCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--aw-text-muted)]">Completed (7d)</p>
              <p className="mt-2 text-2xl font-semibold text-[var(--aw-text)]">{snapshot?.summary.completed7dCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--aw-text-muted)]">Failed (7d)</p>
              <p className="mt-2 text-2xl font-semibold text-[var(--aw-text)]">{snapshot?.summary.failed7dCount ?? 0}</p>
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-[var(--aw-border)] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--aw-text)]">Automation policy</p>
                <p className="text-xs text-[var(--aw-text-muted)]">Controls suggest-only, confirmation, and autopilot behavior.</p>
              </div>
              <select
                value={snapshot?.policy.defaultMode || "user_confirm_required"}
                onChange={(event) => {
                  void updateDefaultPolicy(event.target.value as AutomationPolicyMode);
                }}
                disabled={policySaving}
                className="h-9 rounded-lg border border-[var(--aw-border)] bg-white px-3 text-sm text-[var(--aw-text)]"
              >
                <option value="suggest_only">Suggest only</option>
                <option value="user_confirm_required">User confirm required</option>
                <option value="autopilot_allowed">Autopilot allowed</option>
              </select>
            </div>
          </section>

          <section className="mt-6 space-y-3">
            {activeActions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--aw-border)] bg-white px-4 py-16 text-center text-sm text-[var(--aw-text-muted)]">
                No active actions right now. Run detection to refresh deterministic opportunities.
              </div>
            ) : (
              activeActions.map((action) => {
                const busy = busyActionId === action.id;
                const autopilotEnabled = Boolean(snapshot?.policy.autopilotEnabledActions[action.actionType]);
                return (
                  <article key={action.id} className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--aw-text)]">{action.title}</p>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(action.status)}`}>
                            {statusLabel(action.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                          {actionTypeLabel(action.actionType)} · {policyLabel(action.policy)} · Confidence {Math.round(action.confidence * 100)}%
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs text-[var(--aw-text-muted)]">
                        <input
                          type="checkbox"
                          checked={autopilotEnabled}
                          disabled={policySaving}
                          onChange={(event) => {
                            void toggleAutopilot(action, event.target.checked);
                          }}
                        />
                        Autopilot
                      </label>
                    </div>

                    <p className="mt-3 text-sm text-[var(--aw-text-muted)]">{action.summary}</p>
                    {action.payload.source === "advanced_intelligence" ? (
                      <p className="mt-1 text-xs font-semibold text-[var(--aw-primary)]">
                        Source: Advanced Intelligence
                      </p>
                    ) : null}

                    {action.amount !== null ? (
                      <p className="mt-1 text-sm font-semibold text-[var(--aw-text)]">
                        Amount: {fmt(action.amount)} {action.currency ? action.currency.toUpperCase() : ""}
                      </p>
                    ) : null}

                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[var(--aw-text-muted)]">
                      {action.explainability.factors.slice(0, 3).map((factor) => (
                        <li key={factor}>{factor}</li>
                      ))}
                    </ul>

                    {action.requiresExplicitConfirmation ? (
                      <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        <ShieldCheck size={14} />
                        Explicit confirmation controls required for this action type.
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {(action.status === "pending_confirm" || action.status === "suggested" || action.status === "detected") ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void withBusy(action.id, async () => {
                              await confirmTaskCenterAction(action.id);
                            });
                          }}
                          className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--aw-border)] bg-white px-3 text-xs font-semibold text-[var(--aw-text)]"
                        >
                          <CheckCircle2 size={14} />
                          Confirm
                        </button>
                      ) : null}

                      {(action.status === "pending_confirm" || action.status === "suggested" || action.status === "failed") ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void withBusy(action.id, async () => {
                              const result = await attemptTaskCenterAction(action.id);
                              setLastNotice(result.result.message);
                            });
                          }}
                          className="inline-flex h-9 items-center gap-1 rounded-lg bg-[var(--aw-primary)] px-3 text-xs font-semibold text-[var(--aw-text)]"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                          Attempt
                        </button>
                      ) : null}

                      {action.status === "snoozed" || action.status === "failed" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void withBusy(action.id, async () => {
                              await reopenTaskCenterAction(action.id);
                            });
                          }}
                          className="inline-flex h-9 items-center rounded-lg border border-[var(--aw-border)] bg-white px-3 text-xs font-semibold text-[var(--aw-text)]"
                        >
                          Reopen
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void withBusy(action.id, async () => {
                            await snoozeTaskCenterAction(action.id, 3);
                          });
                        }}
                        className="inline-flex h-9 items-center rounded-lg border border-[var(--aw-border)] bg-white px-3 text-xs font-semibold text-[var(--aw-text-muted)]"
                      >
                        Snooze 3d
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void withBusy(action.id, async () => {
                            await dismissTaskCenterAction(action.id);
                          });
                        }}
                        className="inline-flex h-9 items-center rounded-lg border border-[var(--aw-border)] bg-white px-3 text-xs font-semibold text-[var(--aw-text-muted)]"
                      >
                        Dismiss
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </section>

          <section className="mt-6 rounded-xl border border-[var(--aw-border)] bg-white p-4">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="text-[var(--aw-text-muted)]" />
              <p className="text-sm font-semibold text-[var(--aw-text)]">Recent audit events</p>
            </div>
            <div className="mt-3 space-y-2">
              {(snapshot?.events || []).slice(0, 8).map((event) => (
                <div key={event.id} className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2 text-xs">
                  <p className="font-medium text-[var(--aw-text)]">
                    {event.eventType} · {new Date(event.createdAt).toLocaleString()}
                  </p>
                  {event.reason ? <p className="mt-1 text-[var(--aw-text-muted)]">{event.reason}</p> : null}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
