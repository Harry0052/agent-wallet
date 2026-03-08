'use client';

import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import type { ProcurementRecommendationRecord } from '@/lib/types';
import { fmt } from '@/lib/utils';

function amountLabel(recommendation: ProcurementRecommendationRecord): string {
  if (recommendation.policy?.amountEvaluated !== null && recommendation.policy?.amountEvaluated !== undefined) {
    return `${fmt(recommendation.policy.amountEvaluated)} ${recommendation.policy.amountBasis}`;
  }
  if (recommendation.winner?.monthlyPrice !== null && recommendation.winner?.monthlyPrice !== undefined) {
    return `${fmt(recommendation.winner.monthlyPrice)} monthly`;
  }
  if (recommendation.winner?.annualPrice !== null && recommendation.winner?.annualPrice !== undefined) {
    return `${fmt(recommendation.winner.annualPrice)} annual`;
  }
  return 'Amount unavailable';
}

export function ProcurementApprovalSheet(props: {
  open: boolean;
  recommendation: ProcurementRecommendationRecord;
  isSubmitting: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  if (!props.open || !props.recommendation.winner) return null;

  const winner = props.recommendation.winner;
  const policy = props.recommendation.policy;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 p-3 backdrop-blur-[2px] md:p-6">
      <section className="aw-surface-elevated animate-sheet-rise w-full max-w-2xl p-5 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="aw-kicker">Approval Sheet</p>
            <h3 className="mt-1 text-lg font-semibold text-[var(--aw-text)]">Approve purchase preparation</h3>
            <p className="mt-1 text-sm text-[var(--aw-text-soft)]">{winner.vendorName} · {winner.planName}</p>
          </div>
          <div className="rounded-xl border border-[rgba(201,165,106,0.5)] bg-[rgba(201,165,106,0.14)] px-3 py-1.5 text-sm font-semibold text-[#e9d4af]">
            {amountLabel(props.recommendation)}
          </div>
        </div>

        <article className="mt-4 rounded-xl border border-[var(--aw-border)] bg-black/20 p-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">What will happen next</p>
          <ul className="mt-2 space-y-1.5">
            <li className="text-xs text-[var(--aw-text-soft)]">• TinyFish will navigate to the vendor signup or checkout path.</li>
            <li className="text-xs text-[var(--aw-text-soft)]">• TinyFish will fill preparation fields where possible.</li>
            <li className="text-xs text-[var(--aw-text-soft)]">• Flow will stop before irreversible payment confirmation.</li>
            <li className="text-xs text-[var(--aw-text-soft)]">• A pending procurement ledger entry will be recorded for audit.</li>
          </ul>
        </article>

        <article className="mt-3 rounded-xl border border-[var(--aw-border)] bg-black/20 p-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Why this vendor was selected</p>
          <ul className="mt-2 space-y-1.5">
            {props.recommendation.whyWinner.map((reason) => (
              <li key={reason} className="text-xs text-[var(--aw-text-soft)]">• {reason}</li>
            ))}
          </ul>
        </article>

        <article className="mt-3 rounded-xl border border-[var(--aw-border)] bg-black/20 p-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Policy checks</p>
          {!policy ? (
            <p className="mt-2 text-xs text-[var(--aw-text-muted)]">Policy summary unavailable.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {policy.checks.map((check) => (
                <div key={check.key} className="rounded-lg border border-[var(--aw-border)] bg-black/20 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-[var(--aw-text)]">{check.label}</p>
                    <span className={`text-[10px] uppercase tracking-[0.08em] ${check.passed ? 'text-[var(--aw-success)]' : check.blocking ? 'text-[var(--aw-danger)]' : 'text-[#e6c892]'}`}>
                      {check.passed ? 'pass' : check.blocking ? 'fail' : 'review'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--aw-text-muted)]">{check.detail}</p>
                </div>
              ))}

              <div className="flex items-center gap-2 pt-1">
                {policy.allowed ? (
                  <CheckCircle2 size={14} className="text-[var(--aw-success)]" />
                ) : (
                  <XCircle size={14} className="text-[var(--aw-danger)]" />
                )}
                <p className={`text-xs ${policy.allowed ? 'text-[var(--aw-text-soft)]' : 'text-[rgba(245,180,180,0.92)]'}`}>
                  {policy.allowed ? 'Policy permits purchase preparation.' : policy.reason || 'Policy blocks this action.'}
                </p>
              </div>
            </div>
          )}
        </article>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            onClick={props.onApprove}
            disabled={props.isSubmitting || !policy?.allowed}
            className="aw-button-primary py-2.5 text-sm disabled:opacity-60"
          >
            Approve Purchase Prep
          </button>
          <button
            onClick={props.onReject}
            disabled={props.isSubmitting}
            className="aw-button-secondary py-2.5 text-sm disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle size={13} />
              Reject
            </span>
          </button>
          <button
            onClick={props.onClose}
            disabled={props.isSubmitting}
            className="aw-button-secondary py-2.5 text-sm disabled:opacity-60"
          >
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
