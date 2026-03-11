"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, ShieldAlert, X } from "lucide-react";
import type { ReconciliationRecord } from "@/lib/dashboard/getReconciliationData";

function statusClass(value: string): string {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("active")
    || normalized.includes("captured")
    || normalized.includes("authorized")
    || normalized.includes("completed")
  ) {
    return "text-[var(--aw-success)] bg-emerald-50 border-emerald-200";
  }

  if (
    normalized.includes("failed")
    || normalized.includes("dispute")
    || normalized.includes("blocked")
  ) {
    return "text-[var(--aw-danger)] bg-rose-50 border-rose-200";
  }

  if (
    normalized.includes("pending")
    || normalized.includes("requested")
    || normalized.includes("unverified")
  ) {
    return "text-[var(--aw-warning)] bg-amber-50 border-amber-200";
  }

  return "text-[var(--aw-text-soft)] bg-slate-50 border-slate-200";
}

function statusIcon(value: string) {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("active")
    || normalized.includes("captured")
    || normalized.includes("authorized")
    || normalized.includes("completed")
  ) {
    return <CheckCircle2 size={13} />;
  }

  if (
    normalized.includes("failed")
    || normalized.includes("dispute")
    || normalized.includes("blocked")
  ) {
    return <ShieldAlert size={13} />;
  }

  if (
    normalized.includes("pending")
    || normalized.includes("requested")
    || normalized.includes("unverified")
  ) {
    return <Clock3 size={13} />;
  }

  return <CircleDashed size={13} />;
}

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

export function ReconciliationDetail(props: {
  open: boolean;
  record: ReconciliationRecord | null;
  onClose: () => void;
  onRetry: (record: ReconciliationRecord) => void;
  onRefund: (record: ReconciliationRecord) => void;
  pendingAction: { flowId: string; type: "retry" | "refund" } | null;
}) {
  const { open, record, onClose, onRetry, onRefund, pendingAction } = props;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !record) return null;

  const retryBusy = pendingAction?.flowId === record.paymentFlowId && pendingAction?.type === "retry";
  const refundBusy = pendingAction?.flowId === record.paymentFlowId && pendingAction?.type === "refund";

  return (
    <>
      <button
        aria-label="Close detail"
        className="fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-[620px] overflow-y-auto border-l border-[var(--aw-border)] bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-[var(--aw-border)] bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="aw-kicker">Reconciliation Detail</p>
              <h3 className="mt-1 text-lg font-semibold text-[var(--aw-text)]">
                {record.merchant}
              </h3>
              <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
                {fmtAmount(record.amount, record.currency)} · {record.paymentFlowId}
              </p>
            </div>
            <button
              className="aw-button-secondary p-2"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ["auth", record.authStatus],
              ["capture", record.captureStatus],
              ["activation", record.activationStatus],
              ["refund", record.refundStatus],
            ].map(([label, value]) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${statusClass(value)}`}
              >
                {statusIcon(value)} {label}: {value}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          <section className="aw-surface p-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Next Recommended Action</p>
            <p className="mt-2 text-sm font-semibold text-[var(--aw-text)]">{record.nextRecommendedAction}</p>
            {record.blockerCode ? (
              <p className="mt-2 inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                <AlertTriangle size={12} /> blocker: {record.blockerCode}
              </p>
            ) : null}
          </section>

          <section className="aw-surface p-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Operational Context</p>
            <div className="mt-2 grid gap-2 text-sm text-[var(--aw-text-soft)] sm:grid-cols-2">
              <p><span className="text-[var(--aw-text-muted)]">User:</span> {record.user}</p>
              <p><span className="text-[var(--aw-text-muted)]">Task:</span> {record.task}</p>
              <p><span className="text-[var(--aw-text-muted)]">Funding:</span> {record.fundingMode}</p>
              <p><span className="text-[var(--aw-text-muted)]">Risk:</span> {record.riskScore ?? "N/A"}</p>
              <p className="sm:col-span-2"><span className="text-[var(--aw-text-muted)]">Last evidence:</span> {fmtDateTime(record.lastEvidenceUpdate)}</p>
              {record.activationFailureReason ? (
                <p className="sm:col-span-2"><span className="text-[var(--aw-text-muted)]">Activation failure:</span> {record.activationFailureReason}</p>
              ) : null}
            </div>
          </section>

          <section className="aw-surface p-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Audit Timeline</p>
            {record.timeline.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--aw-text-muted)]">No audit events recorded for this payment flow yet.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {record.timeline.map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--aw-text)]">{entry.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--aw-text-soft)]">{entry.detail}</p>
                      </div>
                      <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] ${statusClass(entry.state)}`}>
                        {entry.state}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">{fmtDateTime(entry.timestamp)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="sticky bottom-0 border-t border-[var(--aw-border)] bg-white px-5 py-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              className="aw-button-secondary px-3 py-2 text-sm"
              disabled={retryBusy || refundBusy}
              onClick={() => onRetry(record)}
            >
              {retryBusy ? "Retrying..." : "Retry"}
            </button>
            <button
              className="aw-button-primary px-3 py-2 text-sm"
              disabled={retryBusy || refundBusy}
              onClick={() => onRefund(record)}
            >
              {refundBusy ? "Submitting..." : "Initiate Refund"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
