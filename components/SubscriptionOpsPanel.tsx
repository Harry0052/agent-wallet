"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type {
  ActiveSubscriptionTask,
  ProcurementLifecycleState,
  ProcurementResearchLog,
  SubscriptionActionRecord,
  SubscriptionOperationType,
} from "@/lib/types";
import { fmt, fmtTime } from "@/lib/utils";
import {
  fetchSubscriptionStatus,
  runSubscriptionOperation,
} from "@/services/subscriptions";

const OPERATION_LABELS: Record<SubscriptionOperationType, string> = {
  inspect_billing: "Inspect Billing",
  renewal_check: "Find Renewal",
  downgrade: "Downgrade",
  cancel: "Cancel",
  switch_billing: "Switch Billing",
};

function amountLabel(subscription: ActiveSubscriptionTask): string {
  if (subscription.amount === null) return "N/A";
  return `${fmt(subscription.amount)} ${subscription.amountBasis}`;
}

function statusClass(status: SubscriptionActionRecord["status"]): string {
  if (status === "completed") return "text-[var(--aw-success)]";
  if (status === "blocked") return "text-[var(--aw-warning)]";
  if (status === "failed") return "text-[var(--aw-danger)]";
  return "text-[var(--aw-text-soft)]";
}

export function SubscriptionOpsPanel({ alwaysShow: _alwaysShow }: { alwaysShow?: boolean } = {}) {
  const [subscriptions, setSubscriptions] = useState<ActiveSubscriptionTask[]>(
    [],
  );
  const [actions, setActions] = useState<SubscriptionActionRecord[]>([]);
  const [logs, setLogs] = useState<ProcurementResearchLog[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(
    undefined,
  );
  const [lifecycle, setLifecycle] = useState<ProcurementLifecycleState | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningOperation, setIsRunningOperation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (taskIdOverride?: string) => {
      const status = await fetchSubscriptionStatus(
        taskIdOverride || selectedTaskId,
      );
      setSubscriptions(status.activeSubscriptions);
      setActions(status.actions);
      setLogs(status.logs);
      setLifecycle(status.lifecycle || null);
      setSelectedTaskId(
        status.selectedTaskId || status.activeSubscriptions[0]?.taskId,
      );
    },
    [selectedTaskId],
  );

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        await refresh();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load subscription operations",
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const runningExists = useMemo(
    () => actions.some((action) => action.status === "running"),
    [actions],
  );

  useEffect(() => {
    if (!runningExists) return;
    const handle = window.setInterval(() => {
      void refresh().catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to refresh subscription operations",
        );
      });
    }, 2200);

    return () => window.clearInterval(handle);
  }, [runningExists, refresh]);

  const selectedSubscription = useMemo(
    () =>
      subscriptions.find(
        (subscription) => subscription.taskId === selectedTaskId,
      ) ||
      subscriptions[0] ||
      null,
    [subscriptions, selectedTaskId],
  );

  const selectedActions = useMemo(() => {
    if (!selectedSubscription) return [];
    return actions
      .filter((action) => action.taskId === selectedSubscription.taskId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [actions, selectedSubscription]);

  const selectedRunning = selectedActions.some(
    (action) => action.status === "running",
  );

  const runOperation = async (operation: SubscriptionOperationType) => {
    if (!selectedSubscription) return;
    setIsRunningOperation(true);
    setError(null);
    try {
      const result = await runSubscriptionOperation({
        taskId: selectedSubscription.taskId,
        operation,
      });
      await refresh(result.taskId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to run subscription operation",
      );
    } finally {
      setIsRunningOperation(false);
    }
  };

  return (
    <section className="aw-surface p-4 md:p-5 animate-sheet-rise">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="aw-kicker">Billing</p>
          <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
            Subscription Tasks
          </h3>
        </div>
        <button
          onClick={() => {
            void refresh();
          }}
          className="aw-button-secondary px-3 py-1.5 text-xs"
          disabled={isLoading}
        >
          <span className="inline-flex items-center gap-1">
            <RefreshCw size={12} />
            Refresh
          </span>
        </button>
      </div>

      {isLoading ? (
        <div className="mt-4 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-4 text-sm text-[var(--aw-text-muted)] inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading subscriptions...
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="aw-empty-state mt-4 px-3 py-5">
          <p className="text-sm text-[var(--aw-text-soft)]">
            No active subscriptions yet.
          </p>
          <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
            Approve a procurement recommendation first, then subscription
            actions will appear here.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-2">
            {subscriptions.map((subscription) => (
              <button
                key={subscription.taskId}
                onClick={() => {
                  setSelectedTaskId(subscription.taskId);
                  void refresh(subscription.taskId).catch((err) => {
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Failed to load subscription task",
                    );
                  });
                }}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  selectedSubscription?.taskId === subscription.taskId
                    ? "border-[var(--aw-border-strong)] bg-[var(--aw-primary-soft)]"
                    : "border-[var(--aw-border)] bg-[var(--aw-surface-muted)] hover:bg-[var(--aw-surface-subtle)]"
                }`}
              >
                <p className="text-sm font-semibold text-[var(--aw-text)]">
                  {subscription.vendorName}
                </p>
                <p className="mt-0.5 text-xs text-[var(--aw-text-soft)]">
                  {subscription.planName}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-[var(--aw-text-muted)]">
                    {amountLabel(subscription)} ·{" "}
                    {subscription.billingFrequency}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                    {subscription.taskStatus}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {selectedSubscription && (
            <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                Selected Subscription
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--aw-text)]">
                {selectedSubscription.vendorName} ·{" "}
                {selectedSubscription.planName}
              </p>
              <a
                href={selectedSubscription.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-xs text-[var(--aw-primary)] hover:text-[var(--aw-primary-strong)] transition-colors"
              >
                {selectedSubscription.sourceUrl}
              </a>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {(
                  Object.keys(OPERATION_LABELS) as SubscriptionOperationType[]
                ).map((operation) => (
                  <button
                    key={operation}
                    onClick={() => {
                      void runOperation(operation);
                    }}
                    disabled={isRunningOperation || selectedRunning}
                    className="aw-button-secondary py-1.5 text-xs disabled:opacity-60"
                  >
                    {OPERATION_LABELS[operation]}
                  </button>
                ))}
              </div>

              {selectedActions.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                    Action Status + Proof
                  </p>
                  <div className="aw-scroll mt-1.5 max-h-36 space-y-2 overflow-y-auto pr-1">
                    {selectedActions.map((action) => (
                      <article
                        key={action.id}
                        className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-[var(--aw-text)]">
                            {OPERATION_LABELS[action.operation]}
                          </p>
                          <p
                            className={`text-[10px] uppercase tracking-[0.08em] ${statusClass(action.status)}`}
                          >
                            {action.status}
                          </p>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[var(--aw-text-soft)]">
                          {action.summary ||
                            action.error ||
                            "No summary provided by TinyFish."}
                        </p>
                        {action.projectedSavings !== null &&
                          action.projectedSavings > 0 && (
                            <p className="mt-0.5 text-[11px] text-[var(--aw-success)]">
                              Projected savings: {fmt(action.projectedSavings)}{" "}
                              {action.projectedSavingsBasis}
                            </p>
                          )}
                        {action.renewalDate && (
                          <p className="mt-0.5 text-[10px] text-[var(--aw-text-muted)]">
                            Renewal: {fmtTime(action.renewalDate)}
                          </p>
                        )}
                        {action.evidenceUrls.length > 0 && (
                          <div className="mt-1 space-y-1">
                            {action.evidenceUrls.slice(0, 2).map((proof) => (
                              <a
                                key={proof}
                                href={proof}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 truncate text-[10px] text-[var(--aw-primary)] hover:text-[var(--aw-primary-strong)] transition-colors"
                              >
                                <ExternalLink size={10} />
                                {proof}
                              </a>
                            ))}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {logs.length > 0 && (
                <div className="mt-3 border-t border-[var(--aw-border)] pt-2.5">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)] inline-flex items-center gap-1">
                    <ShieldCheck size={11} />
                    Live Operation Logs
                  </p>
                  <div className="aw-scroll mt-1.5 max-h-28 overflow-y-auto space-y-1.5 pr-1">
                    {logs.slice(-10).map((log) => (
                      <div
                        key={log.id}
                        className="rounded-md border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                            {log.actionType}
                          </p>
                          <p className="text-[10px] text-[var(--aw-text-muted)]">
                            {fmtTime(log.createdAt)}
                          </p>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[var(--aw-text-soft)]">
                          {log.message}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.1)] px-3 py-2 text-xs text-[var(--aw-danger)]">
          {error}
        </p>
      )}
      {lifecycle?.retryHint && (
        <p className="mt-2 text-[11px] text-[var(--aw-text-muted)]">
          Recovery: {lifecycle.retryHint}
        </p>
      )}
    </section>
  );
}
