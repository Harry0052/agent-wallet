'use client';

import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, ShieldAlert, X } from 'lucide-react';

export interface RecoveryDetailRecord {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  currentState: string;
  recommendedRecoveryAction: string;
  reason: string;
  userFacingMessage: string;
  canSelfServe: boolean;
  unresolved: boolean;
  needsManualReview: boolean;
  transactionId: string;
  paymentFlowId: string | null;
  ledgerEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  evidence: Record<string, unknown> | null;
}

export interface RecoveryAuditEntry {
  id: string;
  action: string;
  fromState: string | null;
  toState: string;
  actorType: 'system' | 'user' | 'admin';
  actorId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface RecoveryDetailPayload {
  record: RecoveryDetailRecord;
  auditLogs: RecoveryAuditEntry[];
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'symbol',
  }).format(amount);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function actionLabel(action: string): string {
  if (action === 'restore_wallet_balance') return 'Restore Wallet Balance';
  if (action === 'void_external_authorization') return 'Release Authorization';
  if (action === 'request_refund') return 'Request Refund';
  if (action === 'manual_review') return 'Needs Manual Review';
  return 'No Action Needed';
}

function stateBadge(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized.includes('completed')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (normalized.includes('failed') || normalized.includes('manual')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (normalized.includes('pending') || normalized.includes('requested') || normalized.includes('available')) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function stateIcon(state: string) {
  const normalized = state.toLowerCase();
  if (normalized.includes('completed')) return <CheckCircle2 size={14} />;
  if (normalized.includes('failed') || normalized.includes('manual')) return <ShieldAlert size={14} />;
  if (normalized.includes('pending') || normalized.includes('requested') || normalized.includes('available')) return <Clock3 size={14} />;
  return <AlertTriangle size={14} />;
}

function entryTitle(action: string): string {
  return action.replace(/_/g, ' ');
}

export function RecoveryDetail(props: {
  open: boolean;
  detail: RecoveryDetailPayload | null;
  onClose: () => void;
}) {
  const { open, detail, onClose } = props;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !detail) return null;

  const record = detail.record;

  return (
    <>
      <button
        aria-label="Close detail"
        className="fixed inset-0 z-40 bg-slate-900/35"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-[680px] overflow-y-auto border-l border-[var(--aw-border)] bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-[var(--aw-border)] bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="aw-kicker">Recovery Detail</p>
              <h3 className="mt-1 text-lg font-semibold text-[var(--aw-text)]">{record.merchant}</h3>
              <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
                {formatMoney(record.amount, record.currency)} · Purchase {formatDate(record.createdAt)}
              </p>
            </div>
            <button className="aw-button-secondary p-2" onClick={onClose} aria-label="Close">
              <X size={15} />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${stateBadge(record.currentState)}`}>
              {stateIcon(record.currentState)} {record.currentState}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--aw-text-soft)]">
              {actionLabel(record.recommendedRecoveryAction)}
            </span>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          <section className="aw-surface p-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">What Happened</p>
            <p className="mt-2 text-sm text-[var(--aw-text)]">{record.reason}</p>
            <p className="mt-2 text-sm text-[var(--aw-text-soft)]">{record.userFacingMessage}</p>
          </section>

          <section className="aw-surface p-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">References</p>
            <div className="mt-2 grid gap-2 text-sm text-[var(--aw-text-soft)] sm:grid-cols-2">
              <p><span className="text-[var(--aw-text-muted)]">Transaction:</span> {record.transactionId}</p>
              <p><span className="text-[var(--aw-text-muted)]">Case:</span> {record.id}</p>
              <p><span className="text-[var(--aw-text-muted)]">Payment Flow:</span> {record.paymentFlowId || 'N/A'}</p>
              <p><span className="text-[var(--aw-text-muted)]">Ledger Entry:</span> {record.ledgerEntryId || 'N/A'}</p>
              <p><span className="text-[var(--aw-text-muted)]">Last Updated:</span> {formatDate(record.updatedAt)}</p>
              <p><span className="text-[var(--aw-text-muted)]">Self-Serve:</span> {record.canSelfServe ? 'Yes' : 'No'}</p>
            </div>
          </section>

          <section className="aw-surface p-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Timeline</p>
            {detail.auditLogs.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--aw-text-muted)]">No recovery actions logged yet.</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {detail.auditLogs.map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[var(--aw-text)]">{entryTitle(entry.action)}</p>
                        <p className="mt-0.5 text-xs text-[var(--aw-text-soft)]">
                          {entry.fromState ? `${entry.fromState} -> ${entry.toState}` : entry.toState}
                        </p>
                      </div>
                      <p className="text-[11px] text-[var(--aw-text-muted)]">{formatDate(entry.createdAt)}</p>
                    </div>
                    <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                      actor: {entry.actorType} ({entry.actorId})
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="aw-surface p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Evidence</p>
              {record.evidence ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--aw-primary)]">
                  <ExternalLink size={12} /> JSON available
                </span>
              ) : null}
            </div>
            <pre className="max-h-[260px] overflow-auto rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3 text-[11px] leading-5 text-[var(--aw-text-soft)]">
              {JSON.stringify(record.evidence || {}, null, 2)}
            </pre>
          </section>
        </div>
      </aside>
    </>
  );
}
