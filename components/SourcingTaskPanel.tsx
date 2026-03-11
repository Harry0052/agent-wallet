'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, RotateCcw, Search, Sheet } from 'lucide-react';
import type { SourcingTaskStatus } from '@/lib/sourcing/schemas';
import { fetchSourcingTasks, retrySourcingTask, type SourcingTaskPreview } from '@/services/sourcing';

interface ViewModel {
  summary: Record<SourcingTaskStatus, number>;
  records: SourcingTaskPreview[];
  generatedAt: string;
}

function formatStatus(status: SourcingTaskStatus): string {
  return status.replace(/_/g, ' ');
}

function statusClass(status: SourcingTaskStatus): string {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'partial_success') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'queued' || status === 'running' || status === 'parsing' || status === 'scoring' || status === 'exporting') {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function SourcingTaskPanel() {
  const [data, setData] = useState<ViewModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRetryId, setPendingRetryId] = useState<string | null>(null);

  async function refresh(soft = false) {
    if (soft) setIsRefreshing(true);
    else setIsLoading(true);

    setError(null);

    try {
      const response = await fetchSourcingTasks(30);
      setData(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load sourcing tasks');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh(false);
  }, []);

  useEffect(() => {
    if (!data?.records.some((record) => (
      record.status === 'queued'
      || record.status === 'running'
      || record.status === 'parsing'
      || record.status === 'scoring'
      || record.status === 'exporting'
    ))) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void refresh(true);
    }, 2500);

    return () => window.clearInterval(interval);
  }, [data?.records]);

  const latest = data?.records[0] || null;

  const grouped = useMemo(() => {
    const records = data?.records || [];

    return {
      active: records.filter((record) => (
        record.status === 'queued'
        || record.status === 'running'
        || record.status === 'parsing'
        || record.status === 'scoring'
        || record.status === 'exporting'
      )),
      completed: records.filter((record) => record.status === 'completed' || record.status === 'partial_success'),
      failed: records.filter((record) => record.status === 'failed'),
    };
  }, [data?.records]);

  const onRetry = async (taskId: string) => {
    setPendingRetryId(taskId);
    setError(null);

    try {
      await retrySourcingTask(taskId);
      await refresh(true);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Failed to retry sourcing task');
    } finally {
      setPendingRetryId(null);
    }
  };

  return (
    <section className="aw-surface-elevated p-5 md:p-6 animate-sheet-rise">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="aw-kicker">Recruiting Workspace</p>
          <h3 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.01em] text-[var(--aw-text)]">
            Candidate Sourcing Tasks
          </h3>
          <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
            Track Indeed sourcing runs, shortlist quality, and Google Sheets delivery.
          </p>
        </div>

        <button
          className="aw-button-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          onClick={() => void refresh(true)}
          disabled={isLoading || isRefreshing}
        >
          <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
          {isRefreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
          <p className="text-[11px] uppercase tracking-[0.07em] text-[var(--aw-text-muted)]">Queued/Running</p>
          <p className="mt-1 text-lg font-semibold text-[var(--aw-text)]">{(data?.summary.queued || 0) + (data?.summary.running || 0) + (data?.summary.parsing || 0) + (data?.summary.scoring || 0) + (data?.summary.exporting || 0)}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[11px] uppercase tracking-[0.07em] text-emerald-700">Completed</p>
          <p className="mt-1 text-lg font-semibold text-emerald-700">{data?.summary.completed || 0}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-[11px] uppercase tracking-[0.07em] text-amber-700">Partial Success</p>
          <p className="mt-1 text-lg font-semibold text-amber-700">{data?.summary.partial_success || 0}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-[11px] uppercase tracking-[0.07em] text-rose-700">Failed</p>
          <p className="mt-1 text-lg font-semibold text-rose-700">{data?.summary.failed || 0}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3 text-sm text-[var(--aw-text-muted)] inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading sourcing tasks...
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {latest ? (
        <article className="mt-4 rounded-xl border border-[var(--aw-border)] bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.07em] text-[var(--aw-text-muted)] inline-flex items-center gap-1">
              <Sheet size={12} /> Latest Task
            </p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] font-semibold ${statusClass(latest.status)}`}>
              {formatStatus(latest.status)}
            </span>
          </div>

          <p className="mt-2 text-sm text-[var(--aw-text-soft)]">{latest.summary || latest.intent}</p>

          <div className="mt-2 text-xs text-[var(--aw-text-muted)]">
            <p>Updated: {formatDate(latest.updatedAt)}</p>
            <p>Shortlisted: {latest.shortlistCount}</p>
          </div>

          {latest.sheetUrl ? (
            <a
              href={latest.sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-1.5 text-xs text-[var(--aw-primary-strong)]"
            >
              Open Google Sheet <ExternalLink size={12} />
            </a>
          ) : null}

          {latest.shortlistPreview.length > 0 ? (
            <div className="mt-3 space-y-2">
              {latest.shortlistPreview.map((candidate, index) => (
                <div key={`${latest.id}_${candidate.sourceUrl}_${index}`} className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--aw-text)]">#{index + 1} {candidate.fullName}</p>
                    <span className="text-xs text-[var(--aw-primary-strong)]">Score {candidate.score}</span>
                  </div>
                  <p className="text-xs text-[var(--aw-text-soft)]">{candidate.currentTitle}</p>
                  <p className="text-[11px] text-[var(--aw-text-muted)]">{candidate.location}</p>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      ) : null}

      {grouped.active.length > 0 ? (
        <article className="mt-4 rounded-xl border border-[var(--aw-border)] bg-white p-3">
          <p className="text-xs uppercase tracking-[0.07em] text-[var(--aw-text-muted)]">Active Tasks</p>
          <div className="mt-2 space-y-2">
            {grouped.active.map((record) => (
              <div key={record.id} className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--aw-text)]">{record.intent}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${statusClass(record.status)}`}>{formatStatus(record.status)}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {grouped.failed.length > 0 ? (
        <article className="mt-4 rounded-xl border border-[var(--aw-border)] bg-white p-3">
          <p className="text-xs uppercase tracking-[0.07em] text-[var(--aw-text-muted)]">Needs Retry</p>
          <div className="mt-2 space-y-2">
            {grouped.failed.slice(0, 6).map((record) => (
              <div key={record.id} className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-[var(--aw-text)]">{record.summary || record.intent}</p>
                    <p className="text-[11px] text-rose-700 mt-0.5">{record.error || 'Task failed'}</p>
                  </div>
                  <button
                    onClick={() => void onRetry(record.id)}
                    disabled={pendingRetryId === record.id}
                    className="aw-button-secondary px-2 py-1 text-[11px]"
                  >
                    <span className="inline-flex items-center gap-1">
                      <RotateCcw size={11} className={pendingRetryId === record.id ? 'animate-spin' : ''} />
                      Retry
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {data?.generatedAt ? (
        <p className="mt-4 text-[11px] text-[var(--aw-text-muted)] inline-flex items-center gap-1">
          <Search size={12} /> Last sync: {formatDate(data.generatedAt)}
        </p>
      ) : null}
    </section>
  );
}
