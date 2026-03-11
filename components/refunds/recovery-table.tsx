'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, RefreshCw, ShieldAlert } from 'lucide-react';
import { RecoveryDetail, type RecoveryDetailPayload, type RecoveryDetailRecord } from '@/components/refunds/recovery-detail';

type RecoveryAction =
  | 'restore_wallet_balance'
  | 'void_external_authorization'
  | 'request_refund'
  | 'manual_review'
  | 'none';

type RecoveryState =
  | 'wallet_debited'
  | 'wallet_reserved'
  | 'external_authorized'
  | 'external_captured'
  | 'activation_pending'
  | 'activation_failed'
  | 'activation_unverified'
  | 'reversal_available'
  | 'refund_available'
  | 'reversal_completed'
  | 'refund_requested'
  | 'refund_in_progress'
  | 'refund_completed'
  | 'refund_failed'
  | 'manual_review_required';

export interface RecoveryRow {
  id: string;
  transactionId: string;
  merchant: string;
  amount: number;
  currency: string;
  currentState: RecoveryState;
  recommendedRecoveryAction: RecoveryAction;
  reason: string;
  userFacingMessage: string;
  canSelfServe: boolean;
  unresolved: boolean;
  needsManualReview: boolean;
  paymentFlowId: string | null;
  ledgerEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  evidence: Record<string, unknown> | null;
}

interface RecoveryStatusPayload {
  ok: true;
  generatedAt: string;
  summary: {
    total: number;
    canBeRestoredInstantly: number;
    refundInProgress: number;
    needsReview: number;
  };
  records: RecoveryRow[];
  groups: {
    canBeRestoredInstantly: RecoveryRow[];
    refundInProgress: RecoveryRow[];
    needsReview: RecoveryRow[];
  };
  detail?: RecoveryDetailPayload | null;
}

interface RecoveryActionResultPayload {
  ok: true;
  result: {
    message?: string;
    userExplanation?: string;
  };
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

function actionLabel(action: RecoveryAction): string {
  if (action === 'restore_wallet_balance') return 'Restore Wallet Balance';
  if (action === 'void_external_authorization') return 'Release Authorization';
  if (action === 'request_refund') return 'Request Refund';
  if (action === 'manual_review') return 'Needs Review';
  return 'No Action Needed';
}

function stateChipClass(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized.includes('completed')) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (normalized.includes('failed') || normalized.includes('manual')) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (normalized.includes('pending') || normalized.includes('requested') || normalized.includes('available')) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function nextActionIntent(action: RecoveryAction): 'reverse' | 'refund' | null {
  if (action === 'restore_wallet_balance' || action === 'void_external_authorization') return 'reverse';
  if (action === 'request_refund') return 'refund';
  return null;
}

function parseErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as { error?: string; errorCode?: string };
  if (value.errorCode && value.error) return `${value.errorCode}: ${value.error}`;
  return value.error || fallback;
}

async function loadRecoveryStatus(): Promise<RecoveryStatusPayload> {
  const response = await fetch('/api/recovery/status?limit=250&unresolvedOnly=true&autoReconcile=true&autoRecover=true&syncRefundStatus=true', {
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(parseErrorMessage(payload, `Failed to load recovery status (${response.status})`));
  }

  return payload as RecoveryStatusPayload;
}

async function loadRecoveryDetail(recoveryCaseId: string): Promise<RecoveryDetailPayload | null> {
  const response = await fetch(`/api/recovery/status?recoveryCaseId=${encodeURIComponent(recoveryCaseId)}&unresolvedOnly=false&autoReconcile=false`, {
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(parseErrorMessage(payload, `Failed to load case detail (${response.status})`));
  }

  return (payload.detail || null) as RecoveryDetailPayload | null;
}

async function runRecoveryAction(params: {
  recoveryCaseId: string;
  action: RecoveryAction;
}): Promise<RecoveryActionResultPayload> {
  const idempotencyKey = `ui:${params.action}:${params.recoveryCaseId}`;

  if (params.action === 'request_refund') {
    const response = await fetch('/api/recovery/refund', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recoveryCaseId: params.recoveryCaseId,
        idempotencyKey,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(parseErrorMessage(payload, `Refund action failed (${response.status})`));
    }
    return payload as RecoveryActionResultPayload;
  }

  const response = await fetch('/api/recovery/reverse', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recoveryCaseId: params.recoveryCaseId,
      idempotencyKey,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(parseErrorMessage(payload, `Reversal action failed (${response.status})`));
  }

  return payload as RecoveryActionResultPayload;
}

function SectionTable(props: {
  title: string;
  subtitle: string;
  rows: RecoveryRow[];
  emptyLabel: string;
  pendingCaseId: string | null;
  onAction: (row: RecoveryRow) => Promise<void>;
  onOpenDetail: (row: RecoveryRow) => Promise<void>;
}) {
  return (
    <section className="aw-surface-elevated p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[var(--aw-text)]">{props.title}</h3>
          <p className="text-xs text-[var(--aw-text-muted)]">{props.subtitle}</p>
        </div>
        <span className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-1 text-xs text-[var(--aw-text-muted)]">
          {props.rows.length}
        </span>
      </div>

      {props.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-4 text-sm text-[var(--aw-text-muted)]">
          {props.emptyLabel}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--aw-border)] text-xs uppercase tracking-[0.06em] text-[var(--aw-text-muted)]">
                <th className="px-2 py-2">Merchant</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Purchase Date</th>
                <th className="px-2 py-2">Failure Reason</th>
                <th className="px-2 py-2">Current State</th>
                <th className="px-2 py-2">Recommended Action</th>
                <th className="px-2 py-2">Action</th>
                <th className="px-2 py-2">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => {
                const actionable = nextActionIntent(row.recommendedRecoveryAction) !== null && row.canSelfServe;
                const pending = props.pendingCaseId === row.id;

                return (
                  <tr key={row.id} className="border-b border-[var(--aw-border)] align-top">
                    <td className="px-2 py-2">
                      <button
                        className="text-left font-semibold text-[var(--aw-text)] hover:text-[var(--aw-primary)]"
                        onClick={() => void props.onOpenDetail(row)}
                      >
                        {row.merchant}
                      </button>
                      <p className="text-xs text-[var(--aw-text-muted)]">{row.transactionId}</p>
                    </td>
                    <td className="px-2 py-2 text-[var(--aw-text)]">{formatMoney(row.amount, row.currency)}</td>
                    <td className="px-2 py-2 text-[var(--aw-text-soft)]">{formatDate(row.createdAt)}</td>
                    <td className="max-w-[280px] px-2 py-2 text-[var(--aw-text-soft)]">{row.reason}</td>
                    <td className="px-2 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${stateChipClass(row.currentState)}`}>
                        {row.currentState}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-[var(--aw-text)]">{actionLabel(row.recommendedRecoveryAction)}</td>
                    <td className="px-2 py-2">
                      {actionable ? (
                        <button
                          className="aw-button-primary px-2.5 py-1.5 text-xs"
                          disabled={pending}
                          onClick={() => void props.onAction(row)}
                        >
                          {pending ? 'Processing...' : actionLabel(row.recommendedRecoveryAction)}
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--aw-text-muted)]">
                          {row.needsManualReview ? 'Needs review' : 'No action'}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-[var(--aw-text-muted)]">{formatDate(row.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function RecoveryTable() {
  const [payload, setPayload] = useState<RecoveryStatusPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<RecoveryDetailPayload | null>(null);

  const refresh = useCallback(async (soft = false) => {
    if (soft) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const next = await loadRecoveryStatus();
      setPayload(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load recovery cases');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const rows = payload?.records || [];

  const unresolvedSummary = useMemo(() => {
    if (!payload) {
      return {
        total: 0,
        instant: 0,
        refund: 0,
        review: 0,
      };
    }

    return {
      total: payload.summary.total,
      instant: payload.groups.canBeRestoredInstantly.length,
      refund: payload.groups.refundInProgress.length,
      review: payload.groups.needsReview.length,
    };
  }, [payload]);

  const openDetail = async (row: RecoveryRow) => {
    try {
      const next = await loadRecoveryDetail(row.id);
      const fallback: RecoveryDetailPayload = {
        record: row as unknown as RecoveryDetailRecord,
        auditLogs: [],
      };
      setDetail(next || fallback);
      setDetailOpen(true);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Failed to load case detail');
    }
  };

  const runAction = async (row: RecoveryRow) => {
    const intent = nextActionIntent(row.recommendedRecoveryAction);
    if (!intent || !row.canSelfServe) return;

    setPendingCaseId(row.id);
    setError(null);
    setNotice(null);

    try {
      const result = await runRecoveryAction({
        recoveryCaseId: row.id,
        action: row.recommendedRecoveryAction,
      });
      setNotice(result.result.message || result.result.userExplanation || 'Recovery action completed.');
      await refresh(true);
      if (detailOpen) {
        const nextDetail = await loadRecoveryDetail(row.id);
        if (nextDetail) setDetail(nextDetail);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Recovery action failed');
    } finally {
      setPendingCaseId(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="aw-surface-elevated p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="aw-kicker">User Recovery Center</p>
            <h2 className="mt-1 text-xl font-semibold text-[var(--aw-text)]">Refund and Wallet Recovery</h2>
            <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
              Restore funds directly from Agent Wallet when fulfillment fails or activation is not confirmed.
            </p>
          </div>
          <button className="aw-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm" onClick={() => void refresh(true)} disabled={isRefreshing || isLoading}>
            <RefreshCw size={14} /> {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
            <p className="text-xs text-[var(--aw-text-muted)]">Open Cases</p>
            <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">{unresolvedSummary.total}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">Can be restored instantly</p>
            <p className="mt-1 text-xl font-semibold text-emerald-700">{unresolvedSummary.instant}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Refund in progress</p>
            <p className="mt-1 text-xl font-semibold text-amber-700">{unresolvedSummary.refund}</p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs text-rose-700">Needs review</p>
            <p className="mt-1 text-xl font-semibold text-rose-700">{unresolvedSummary.review}</p>
          </div>
        </div>

        {notice ? (
          <p className="mt-3 inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm text-emerald-700">
            <Clock3 size={13} /> {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-sm text-rose-700">
            <AlertTriangle size={13} /> {error}
          </p>
        ) : null}
      </section>

      {isLoading ? (
        <section className="aw-surface p-4 text-sm text-[var(--aw-text-muted)]">Loading recovery data...</section>
      ) : rows.length === 0 ? (
        <section className="aw-surface p-4 text-sm text-[var(--aw-text-muted)]">
          No unresolved recovery cases were found.
        </section>
      ) : (
        <>
          <SectionTable
            title="Can be restored instantly"
            subtitle="Internal reversals and authorization releases that can be safely completed now."
            rows={payload?.groups.canBeRestoredInstantly || []}
            emptyLabel="No instant recovery actions are pending."
            pendingCaseId={pendingCaseId}
            onAction={runAction}
            onOpenDetail={openDetail}
          />

          <SectionTable
            title="Refund in progress"
            subtitle="Cases requiring refund initiation or ongoing processor/merchant refund tracking."
            rows={payload?.groups.refundInProgress || []}
            emptyLabel="No refund workflows are currently open."
            pendingCaseId={pendingCaseId}
            onAction={runAction}
            onOpenDetail={openDetail}
          />

          <SectionTable
            title="Needs review"
            subtitle="Ambiguous cases with insufficient settlement evidence for automatic recovery."
            rows={payload?.groups.needsReview || []}
            emptyLabel="No cases are waiting for manual review."
            pendingCaseId={pendingCaseId}
            onAction={runAction}
            onOpenDetail={openDetail}
          />

          <section className="aw-surface p-4 text-xs text-[var(--aw-text-muted)]">
            <p className="inline-flex items-center gap-1"><ShieldAlert size={13} /> Safety rules: users can only act on their own cases, actions are idempotent, and ambiguous cases remain blocked for manual review.</p>
          </section>
        </>
      )}

      <RecoveryDetail
        open={detailOpen}
        detail={detail}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}
