"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { InlineSpinner } from "@/components/skeleton";
import { fmtFull } from "@/lib/utils";
import {
  fetchSubscriptionStatus,
  runSubscriptionOperation,
} from "@/services/subscriptions";

type SubscriptionOperationStatus = 'running' | 'completed' | 'blocked' | 'failed';

interface ActiveSubscriptionTask {
  taskId: string;
  title: string;
  vendorName: string;
  planName: string;
  amount: number | null;
  amountBasis: 'monthly' | 'annual' | 'unknown';
  billingFrequency: string;
  sourceUrl: string;
  approvedAt?: string;
  taskStatus: string;
}

interface SubscriptionActionRecord {
  id: string;
  userId: string;
  taskId: string;
  operation: string;
  status: SubscriptionOperationStatus;
  summary?: string;
  evidenceUrls: string[];
  projectedSavings: number | null;
  projectedSavingsBasis: 'monthly' | 'annual' | 'unknown';
  currency: string | null;
  renewalDate?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
import { SettingsModal } from "@/components/settings/SettingsModal";

function statusClass(status: SubscriptionActionRecord["status"]): string {
  if (status === "completed") return "text-[var(--aw-success)]";
  if (status === "failed") return "text-[var(--aw-danger)]";
  if (status === "blocked") return "text-[var(--aw-warning)]";
  return "text-[var(--aw-text-soft)]";
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

interface NotificationSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationSettingsModal({
  open,
  onClose,
}: NotificationSettingsModalProps) {
  const [subscriptions, setSubscriptions] = useState<ActiveSubscriptionTask[]>([]);
  const [actions, setActions] = useState<SubscriptionActionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelingTaskId, setCancelingTaskId] = useState<string | null>(null);

  const latestCancelByTask = useMemo(() => {
    const map = new Map<string, SubscriptionActionRecord>();
    for (const action of actions) {
      if (action.operation !== "cancel") continue;
      const prev = map.get(action.taskId);
      if (!prev || Date.parse(action.createdAt) > Date.parse(prev.createdAt)) {
        map.set(action.taskId, action);
      }
    }
    return map;
  }, [actions]);

  const loadSubscriptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSubscriptionStatus();
      setSubscriptions(result.activeSubscriptions);
      setActions(result.actions);
    } catch (loadError) {
      setError(toErrorMessage(loadError, "Failed to load subscription settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadSubscriptions();
  }, [loadSubscriptions, open]);

  const cancelSubscription = async (taskId: string, vendorName: string) => {
    setCancelingTaskId(taskId);
    setError(null);
    setNotice(null);
    try {
      await runSubscriptionOperation({ taskId, operation: "cancel" });
      setNotice(`Cancellation flow started for ${vendorName}.`);
      await loadSubscriptions();
    } catch (cancelError) {
      setError(toErrorMessage(cancelError, "Failed to start cancellation flow."));
    } finally {
      setCancelingTaskId(null);
    }
  };

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="Notification Settings"
      description="Manage subscription operation alerts and cancellation actions."
      maxWidthClassName="max-w-3xl"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--aw-text-soft)]">
          Subscriptions tied to your wallet can be canceled from here.
        </p>
        <button
          type="button"
          className="aw-button-secondary h-8 px-3 text-xs"
          onClick={() => {
            void loadSubscriptions();
          }}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--aw-text-muted)]">
          <InlineSpinner size={12} />
          Loading subscriptions...
        </p>
      ) : subscriptions.length === 0 ? (
        <div className="aw-empty-state mt-3 space-y-2 px-3 py-3">
          <p className="text-sm">No active subscriptions available to cancel.</p>
          <Link
            href="/subscriptions"
            className="aw-button-secondary inline-flex h-8 items-center px-3 text-xs"
          >
            Open Subscriptions Workspace
          </Link>
        </div>
      ) : (
        <div className="aw-scroll mt-3 max-h-[320px] space-y-2 overflow-y-auto pr-1">
          {subscriptions.map((subscription) => {
            const latestCancel = latestCancelByTask.get(subscription.taskId);
            const isRunning =
              cancelingTaskId === subscription.taskId
              || latestCancel?.status === "running";

            return (
              <article
                key={subscription.taskId}
                className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--aw-text)]">
                      {subscription.vendorName}
                    </p>
                    <p className="text-[11px] text-[var(--aw-text-soft)]">
                      {subscription.planName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void cancelSubscription(
                        subscription.taskId,
                        subscription.vendorName,
                      );
                    }}
                    className="aw-button-secondary h-8 px-3 text-xs"
                    disabled={isRunning}
                  >
                    {isRunning ? "Canceling..." : "Cancel"}
                  </button>
                </div>

                {latestCancel ? (
                  <p className={`mt-1 text-[11px] ${statusClass(latestCancel.status)}`}>
                    Latest cancel status: {latestCancel.status}
                    {latestCancel.updatedAt ? ` · ${fmtFull(latestCancel.updatedAt)}` : ""}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {notice ? (
        <p className="mt-3 rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
          {error}
        </p>
      ) : null}
    </SettingsModal>
  );
}
