"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  RotateCcw,
  Shield,
  X,
  Zap,
} from "lucide-react";
import { InlineSpinner } from "@/components/skeleton";
import type { AutomationActionRecord } from "@/lib/types";
import { fmt } from "@/lib/utils";
import {
  ACTION_TYPE_LABELS,
  isDestructive,
  STATUS_CONFIG,
  toCardStatus,
} from "./ActionCenterTypes";

interface ActionCardProps {
  action: AutomationActionRecord;
  busy: boolean;
  onApprove: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
  onReopen: () => void;
}

export function ActionCard({
  action,
  busy,
  onApprove,
  onSnooze,
  onDismiss,
  onReopen,
}: ActionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingApproval, setConfirmingApproval] = useState(false);
  const cardStatus = toCardStatus(action.status);
  const config = STATUS_CONFIG[cardStatus];
  const destructive = isDestructive(action);

  const handleApprove = () => {
    if (destructive && !confirmingApproval) {
      setConfirmingApproval(true);
      return;
    }
    setConfirmingApproval(false);
    onApprove();
  };

  const cancelConfirmation = () => {
    setConfirmingApproval(false);
  };

  const isActionable =
    action.status === "pending_confirm" ||
    action.status === "suggested" ||
    action.status === "detected";

  const isRetryable = action.status === "failed" || action.status === "snoozed";

  return (
    <article
      className="rounded-2xl border bg-white transition-shadow hover:shadow-[0_2px_12px_rgba(17,17,17,0.04)]"
      style={{ borderColor: "var(--aw-border)" }}
    >
      <div className="px-5 py-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-[0.9rem] font-semibold text-[var(--aw-text)]">
                {action.title}
              </h3>
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
                style={{
                  color: config.color,
                  background: config.bg,
                  borderColor: config.border,
                }}
              >
                {config.pulse && (
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full"
                    style={{ background: config.color }}
                  />
                )}
                {config.label}
              </span>
            </div>
            <p className="mt-1 text-[0.78rem] text-[var(--aw-text-muted)]">
              {ACTION_TYPE_LABELS[action.actionType]}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[var(--aw-text-muted)] transition-colors hover:bg-[var(--aw-surface-subtle)]"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {/* Summary */}
        <p className="mt-3 text-[0.82rem] leading-relaxed text-[var(--aw-text-muted)]">
          {action.summary}
        </p>

        {/* Amount */}
        {action.amount !== null && (
          <p className="mt-2 text-[0.88rem] font-semibold text-[var(--aw-text)]">
            {fmt(action.amount)}
            {action.currency ? ` ${action.currency.toUpperCase()}` : ""}
          </p>
        )}

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-4 space-y-3 border-t border-[var(--aw-border)] pt-4">
            {/* Explainability */}
            {action.explainability.factors.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--aw-text-muted)]">
                  Why this action
                </p>
                <ul className="space-y-1">
                  {action.explainability.factors.map((factor, i) => (
                    <li
                      key={i}
                      className="text-[0.78rem] leading-relaxed text-[var(--aw-text-muted)]"
                    >
                      {factor}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Confidence */}
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--aw-text-muted)]">
                  Confidence
                </p>
                <p className="mt-0.5 text-[0.82rem] font-semibold text-[var(--aw-text)]">
                  {Math.round(action.confidence * 100)}%
                </p>
              </div>
              {action.requiresExplicitConfirmation && (
                <div className="flex items-center gap-1.5 text-[0.78rem] text-[var(--aw-text-muted)]">
                  <Shield size={13} />
                  <span>Requires your approval</span>
                </div>
              )}
            </div>

            {/* Destructive warning */}
            {destructive && isActionable && (
              <div
                className="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
                style={{
                  background: "rgba(220, 38, 38, 0.05)",
                  border: "1px solid rgba(220, 38, 38, 0.12)",
                }}
              >
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-[#DC2626]" />
                <p className="text-[0.78rem] leading-relaxed text-[#DC2626]/80">
                  This action may be difficult to reverse. Please review carefully before approving.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Confirmation dialog for destructive actions */}
        {confirmingApproval && (
          <div
            className="mt-4 rounded-xl px-4 py-3.5"
            style={{
              background: "rgba(59, 130, 246, 0.05)",
              border: "1px solid rgba(59, 130, 246, 0.15)",
            }}
          >
            <p className="text-[0.82rem] font-semibold text-[var(--aw-text)]">
              Confirm this action?
            </p>
            <p className="mt-1 text-[0.78rem] text-[var(--aw-text-muted)]">
              Calico will {ACTION_TYPE_LABELS[action.actionType].toLowerCase()} on your behalf.
              {action.amount !== null && ` Estimated impact: ${fmt(action.amount)}.`}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-[0.78rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--aw-text)" }}
              >
                {busy ? <InlineSpinner size={14} /> : <Check size={14} />}
                Yes, proceed
              </button>
              <button
                type="button"
                onClick={cancelConfirmation}
                className="inline-flex h-9 items-center rounded-xl border border-[var(--aw-border)] bg-white px-4 text-[0.78rem] font-semibold text-[var(--aw-text-muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!confirmingApproval && (
          <div className="mt-4 flex flex-wrap gap-2">
            {isActionable && (
              <button
                type="button"
                disabled={busy}
                onClick={handleApprove}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-[0.78rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--aw-text)" }}
              >
                {busy ? <InlineSpinner size={14} /> : <Zap size={14} />}
                Approve
              </button>
            )}

            {isRetryable && (
              <button
                type="button"
                disabled={busy}
                onClick={onReopen}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--aw-border)] bg-white px-4 text-[0.78rem] font-semibold text-[var(--aw-text)] transition-colors hover:bg-[var(--aw-surface-subtle)]"
              >
                <RotateCcw size={13} />
                Try again
              </button>
            )}

            {(isActionable || action.status === "attempted") && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onSnooze}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--aw-border)] bg-white px-3 text-[0.78rem] font-semibold text-[var(--aw-text-muted)] transition-colors hover:bg-[var(--aw-surface-subtle)]"
                >
                  <Clock size={13} />
                  Later
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onDismiss}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--aw-border)] bg-white px-3 text-[0.78rem] font-semibold text-[var(--aw-text-muted)] transition-colors hover:bg-[var(--aw-surface-subtle)]"
                >
                  <X size={13} />
                  Dismiss
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Compact card for history items */
export function ActionHistoryCard({ action }: { action: AutomationActionRecord }) {
  const cardStatus = toCardStatus(action.status);
  const config = STATUS_CONFIG[cardStatus];

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
      style={{ borderColor: "var(--aw-border)", background: "var(--aw-surface-subtle)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.82rem] text-[var(--aw-text-muted)]">{action.title}</p>
        <p className="mt-0.5 text-[0.72rem] text-[var(--aw-text-muted)]/60">
          {ACTION_TYPE_LABELS[action.actionType]}
        </p>
      </div>
      <span
        className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
        style={{
          color: config.color,
          background: config.bg,
          borderColor: config.border,
        }}
      >
        {action.status === "completed" ? "Done" : action.status === "dismissed" ? "Dismissed" : config.label}
      </span>
    </div>
  );
}
