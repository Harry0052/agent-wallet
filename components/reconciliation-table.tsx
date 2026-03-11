"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Filter, RefreshCw, Search } from "lucide-react";
import {
  type ReconciliationAuthStatus,
  type ReconciliationActivationStatus,
  type ReconciliationCaptureStatus,
  type ReconciliationData,
  type ReconciliationRecord,
  type ReconciliationRefundStatus,
} from "@/lib/dashboard/getReconciliationData";
import { ReconciliationDetail } from "@/components/reconciliation-detail";

type SortKey =
  | "merchant"
  | "user"
  | "task"
  | "authStatus"
  | "captureStatus"
  | "activationStatus"
  | "refundStatus"
  | "blockerCode"
  | "riskScore"
  | "lastEvidenceUpdate"
  | "nextRecommendedAction";

function fmtDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function fmtAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  }).format(amount);
}

function isActionRequired(record: ReconciliationRecord): boolean {
  return record.nextRecommendedAction !== "No action needed";
}

function isRefundRetryStatus(status: ReconciliationRefundStatus): boolean {
  return (
    status === "refund_requested"
    || status === "refund_in_progress"
    || status === "dispute_prepared"
    || status === "service_not_activated"
  );
}

function canInitiateRefund(record: ReconciliationRecord): boolean {
  if (record.refundStatus === "refund_completed" || record.refundStatus === "dispute_submitted") {
    return false;
  }

  if (record.captureStatus !== "captured") return false;

  return record.activationStatus === "failed" || record.activationStatus === "unverified" || Boolean(record.blockerCode);
}

function toComparableValue(record: ReconciliationRecord, key: SortKey): string | number {
  if (key === "riskScore") return record.riskScore ?? -1;
  if (key === "lastEvidenceUpdate") return Date.parse(record.lastEvidenceUpdate) || 0;

  const value = record[key];
  if (typeof value === "string") return value.toLowerCase();
  if (value === null) return "";
  return String(value).toLowerCase();
}

function statusChipClass(status: string): string {
  const normalized = status.toLowerCase();
  if (
    normalized.includes("captured")
    || normalized.includes("authorized")
    || normalized.includes("active")
    || normalized.includes("completed")
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (
    normalized.includes("failed")
    || normalized.includes("blocked")
    || normalized.includes("dispute")
  ) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (
    normalized.includes("pending")
    || normalized.includes("requested")
    || normalized.includes("unverified")
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: { message?: string };
    message?: string;
  } | null;

  if (!response.ok || (payload && payload.ok === false)) {
    const message = payload?.error?.message || payload?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

export function ReconciliationTable({ data }: { data: ReconciliationData }) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [authFilter, setAuthFilter] = useState<ReconciliationAuthStatus | "all">("all");
  const [captureFilter, setCaptureFilter] = useState<ReconciliationCaptureStatus | "all">("all");
  const [activationFilter, setActivationFilter] = useState<ReconciliationActivationStatus | "all">("all");
  const [refundFilter, setRefundFilter] = useState<ReconciliationRefundStatus | "all">("all");
  const [actionRequiredOnly, setActionRequiredOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("lastEvidenceUpdate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ flowId: string; type: "retry" | "refund" } | null>(null);

  const filteredAndSorted = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = data.records.filter((record) => {
      if (authFilter !== "all" && record.authStatus !== authFilter) return false;
      if (captureFilter !== "all" && record.captureStatus !== captureFilter) return false;
      if (activationFilter !== "all" && record.activationStatus !== activationFilter) return false;
      if (refundFilter !== "all" && record.refundStatus !== refundFilter) return false;
      if (actionRequiredOnly && !isActionRequired(record)) return false;

      if (!normalizedSearch) return true;
      const haystack = [
        record.merchant,
        record.user,
        record.task,
        record.blockerCode || "",
        record.nextRecommendedAction,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });

    filtered.sort((a, b) => {
      const aValue = toComparableValue(a, sortKey);
      const bValue = toComparableValue(b, sortKey);

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [
    data.records,
    search,
    authFilter,
    captureFilter,
    activationFilter,
    refundFilter,
    actionRequiredOnly,
    sortKey,
    sortDirection,
  ]);

  const selectedRecord = useMemo(
    () => data.records.find((record) => record.paymentFlowId === selectedFlowId) || null,
    [data.records, selectedFlowId],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(key === "lastEvidenceUpdate" || key === "riskScore" ? "desc" : "asc");
  };

  const refresh = () => {
    router.refresh();
  };

  const runRetry = async (record: ReconciliationRecord) => {
    setError(null);
    setNotice(null);
    setPendingAction({ flowId: record.paymentFlowId, type: "retry" });

    try {
      if (isRefundRetryStatus(record.refundStatus)) {
        await postJson("/api/refunds/status", { limit: 50 });
        setNotice(`Retry scheduler triggered for ${record.merchant}.`);
      } else if (canInitiateRefund(record)) {
        await postJson("/api/refunds/initiate", {
          paymentFlowId: record.paymentFlowId,
          idempotencyKey: `recon_retry_${record.paymentFlowId}_${Date.now()}`,
          activationFailureReason: `Manual retry from reconciliation dashboard for ${record.merchant}`,
          allowWithoutActivationFailure: true,
        });
        setNotice(`Refund retry initiated for ${record.merchant}.`);
      } else {
        setNotice(`No retry action available for ${record.merchant}; data has been refreshed.`);
      }

      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Retry request failed");
    } finally {
      setPendingAction(null);
    }
  };

  const runRefund = async (record: ReconciliationRecord) => {
    setError(null);
    setNotice(null);
    setPendingAction({ flowId: record.paymentFlowId, type: "refund" });

    try {
      await postJson("/api/refunds/initiate", {
        paymentFlowId: record.paymentFlowId,
        idempotencyKey: `recon_refund_${record.paymentFlowId}_${Date.now()}`,
        activationFailureReason: record.activationFailureReason || `Manual refund requested from reconciliation dashboard (${record.merchant})`,
        allowWithoutActivationFailure: true,
      });
      setNotice(`Refund workflow started for ${record.merchant}.`);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Refund request failed");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="aw-surface-elevated p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="aw-kicker">Operations Reconciliation</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.01em] text-[var(--aw-text)]">
            Autonomous Purchase Reconciliation
          </h2>
          <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
            Financial and operational settlement health across autonomous tasks.
          </p>
        </div>

        <button
          className="aw-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
          onClick={refresh}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
          <p className="text-xs text-[var(--aw-text-muted)]">Total Flows</p>
          <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">{data.stats.total}</p>
        </div>
        <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
          <p className="text-xs text-[var(--aw-text-muted)]">Action Required</p>
          <p className="mt-1 text-xl font-semibold text-amber-600">{data.stats.actionRequired}</p>
        </div>
        <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
          <p className="text-xs text-[var(--aw-text-muted)]">Blocked</p>
          <p className="mt-1 text-xl font-semibold text-rose-600">{data.stats.blocked}</p>
        </div>
        <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
          <p className="text-xs text-[var(--aw-text-muted)]">Refunded / Disputed</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600">{data.stats.refundedOrDisputed}</p>
        </div>
      </div>

      <div className="mt-4 aw-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--aw-text-muted)]" />
            <input
              className="aw-input pl-9 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search merchant, user, task, blocker"
            />
          </label>

          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2 py-1 text-xs text-[var(--aw-text-muted)]">
            <Filter size={12} /> Filters
          </span>

          <select className="aw-input w-auto min-w-[120px] text-sm" value={authFilter} onChange={(event) => setAuthFilter(event.target.value as ReconciliationAuthStatus | "all") }>
            <option value="all">Auth: all</option>
            <option value="authorized">authorized</option>
            <option value="pending">pending</option>
            <option value="failed">failed</option>
          </select>

          <select className="aw-input w-auto min-w-[130px] text-sm" value={captureFilter} onChange={(event) => setCaptureFilter(event.target.value as ReconciliationCaptureStatus | "all") }>
            <option value="all">Capture: all</option>
            <option value="captured">captured</option>
            <option value="pending">pending</option>
            <option value="not_captured">not_captured</option>
            <option value="failed">failed</option>
          </select>

          <select className="aw-input w-auto min-w-[140px] text-sm" value={activationFilter} onChange={(event) => setActivationFilter(event.target.value as ReconciliationActivationStatus | "all") }>
            <option value="all">Activation: all</option>
            <option value="active">active</option>
            <option value="pending">pending</option>
            <option value="failed">failed</option>
            <option value="unverified">unverified</option>
            <option value="not_required">not_required</option>
          </select>

          <select className="aw-input w-auto min-w-[150px] text-sm" value={refundFilter} onChange={(event) => setRefundFilter(event.target.value as ReconciliationRefundStatus | "all") }>
            <option value="all">Refund: all</option>
            <option value="not_requested">not_requested</option>
            <option value="refund_requested">refund_requested</option>
            <option value="refund_in_progress">refund_in_progress</option>
            <option value="refund_completed">refund_completed</option>
            <option value="dispute_prepared">dispute_prepared</option>
            <option value="dispute_submitted">dispute_submitted</option>
          </select>

          <label className="inline-flex items-center gap-1.5 rounded-md border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-2 text-xs text-[var(--aw-text-soft)]">
            <input
              type="checkbox"
              checked={actionRequiredOnly}
              onChange={(event) => setActionRequiredOnly(event.target.checked)}
            />
            Action required only
          </label>
        </div>

        <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
          Showing {filteredAndSorted.length} of {data.records.length} flows · Updated {fmtDateTime(data.generatedAt)}
        </p>
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div className="mt-4 overflow-x-auto aw-scroll rounded-xl border border-[var(--aw-border)] bg-white">
        <table className="min-w-[1650px] w-full text-sm">
          <thead className="bg-[var(--aw-surface-muted)]">
            <tr className="text-left text-xs uppercase tracking-[0.06em] text-[var(--aw-text-muted)]">
              {[
                ["merchant", "merchant"],
                ["user", "user"],
                ["task", "task"],
                ["auth", "authStatus"],
                ["capture", "captureStatus"],
                ["activation", "activationStatus"],
                ["refund", "refundStatus"],
                ["blocker", "blockerCode"],
                ["risk", "riskScore"],
                ["last evidence", "lastEvidenceUpdate"],
                ["next action", "nextRecommendedAction"],
              ].map(([label, key]) => (
                <th key={key} className="px-3 py-2 font-semibold">
                  <button
                    className="inline-flex items-center gap-1 hover:text-[var(--aw-primary-strong)]"
                    onClick={() => toggleSort(key as SortKey)}
                  >
                    {label}
                    <ArrowUpDown size={12} />
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 font-semibold">amount</th>
              <th className="px-3 py-2 font-semibold">actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredAndSorted.map((record) => {
              const retryBusy = pendingAction?.flowId === record.paymentFlowId && pendingAction.type === "retry";
              const refundBusy = pendingAction?.flowId === record.paymentFlowId && pendingAction.type === "refund";

              return (
                <tr
                  key={record.paymentFlowId}
                  className="border-t border-[var(--aw-border)] align-top hover:bg-[var(--aw-surface-muted)]"
                >
                  <td className="px-3 py-2.5 font-semibold text-[var(--aw-text)]">{record.merchant}</td>
                  <td className="px-3 py-2.5 text-[var(--aw-text-soft)]">{record.user}</td>
                  <td className="px-3 py-2.5 text-[var(--aw-text-soft)] max-w-[220px] truncate" title={record.task}>{record.task}</td>
                  <td className="px-3 py-2.5"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusChipClass(record.authStatus)}`}>{record.authStatus}</span></td>
                  <td className="px-3 py-2.5"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusChipClass(record.captureStatus)}`}>{record.captureStatus}</span></td>
                  <td className="px-3 py-2.5"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusChipClass(record.activationStatus)}`}>{record.activationStatus}</span></td>
                  <td className="px-3 py-2.5"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusChipClass(record.refundStatus)}`}>{record.refundStatus}</span></td>
                  <td className="px-3 py-2.5 text-xs text-[var(--aw-text-soft)]">{record.blockerCode || "-"}</td>
                  <td className="px-3 py-2.5 text-[var(--aw-text-soft)]">{record.riskScore ?? "-"}</td>
                  <td className="px-3 py-2.5 text-xs text-[var(--aw-text-muted)]">{fmtDateTime(record.lastEvidenceUpdate)}</td>
                  <td className="px-3 py-2.5 text-xs text-[var(--aw-text-soft)] max-w-[270px] truncate" title={record.nextRecommendedAction}>{record.nextRecommendedAction}</td>
                  <td className="px-3 py-2.5 text-[var(--aw-text-soft)]">{fmtAmount(record.amount, record.currency)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        className="aw-button-secondary px-2.5 py-1 text-xs"
                        onClick={() => {
                          void runRetry(record);
                        }}
                        disabled={retryBusy || refundBusy}
                      >
                        {retryBusy ? "Retrying..." : "Retry"}
                      </button>
                      <button
                        className="aw-button-primary px-2.5 py-1 text-xs"
                        onClick={() => {
                          void runRefund(record);
                        }}
                        disabled={retryBusy || refundBusy || !canInitiateRefund(record)}
                      >
                        {refundBusy ? "Starting..." : "Refund"}
                      </button>
                      <button
                        className="aw-button-ghost px-2.5 py-1 text-xs"
                        onClick={() => setSelectedFlowId(record.paymentFlowId)}
                      >
                        Details
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredAndSorted.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-sm text-[var(--aw-text-muted)]">
                  No records match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ReconciliationDetail
        open={Boolean(selectedRecord)}
        record={selectedRecord}
        onClose={() => setSelectedFlowId(null)}
        onRetry={(record) => {
          void runRetry(record);
        }}
        onRefund={(record) => {
          void runRefund(record);
        }}
        pendingAction={pendingAction}
      />
    </section>
  );
}
