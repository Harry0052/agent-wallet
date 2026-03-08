'use client';

import { useMemo } from 'react';
import { Bot, CheckCircle2, Clock3, Compass, Gavel, Landmark, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { useApp } from '@/lib/store';
import { AgentLogData, AgentStep, ApprovalData, EvidenceData, EvidenceRecord, ReceiptData } from '@/lib/types';
import { cn, domainFromUrl, firstUrlFromText, fmt, fmtTime } from '@/lib/utils';

type RailCategory =
  | 'planning'
  | 'visiting-site'
  | 'extracting-pricing'
  | 'comparing-vendors'
  | 'policy-check'
  | 'approval-required'
  | 'purchase-prep'
  | 'ledger-update';

interface RailLine {
  id: string;
  timestamp: string;
  category: RailCategory;
  title: string;
  detail: string;
  domain?: string;
  status: AgentStep['status'] | 'info';
}

function labelForCategory(category: RailCategory): string {
  switch (category) {
    case 'planning':
      return 'Planning';
    case 'visiting-site':
      return 'Visiting Site';
    case 'extracting-pricing':
      return 'Extracting Pricing';
    case 'comparing-vendors':
      return 'Comparing Vendors';
    case 'policy-check':
      return 'Policy Check';
    case 'approval-required':
      return 'Approval Required';
    case 'purchase-prep':
      return 'Purchase Prep';
    case 'ledger-update':
      return 'Ledger Update';
    default:
      return 'Activity';
  }
}

function categoryForStep(step: AgentStep): RailCategory {
  switch (step.type) {
    case 'plan':
      return 'planning';
    case 'search':
    case 'visit':
      return 'visiting-site';
    case 'extract':
      return 'extracting-pricing';
    case 'compare':
    case 'select':
      return 'comparing-vendors';
    case 'guardrail':
      return 'policy-check';
    case 'checkout':
    case 'form-fill':
    case 'confirm':
    case 'payment':
      return 'purchase-prep';
    default:
      return 'planning';
  }
}

function statusForRail(isProcessing: boolean, status: string | undefined): {
  label: string;
  state: 'live' | 'ok' | 'alert';
} {
  if (status === 'awaiting-approval') return { label: 'Awaiting Approval', state: 'live' };
  if (isProcessing) return { label: 'Live Execution', state: 'live' };
  if (status === 'completed') return { label: 'Task Completed', state: 'ok' };
  if (status === 'cancelled') return { label: 'Task Cancelled', state: 'alert' };
  return { label: 'Idle', state: 'ok' };
}

function iconForLine(line: RailLine) {
  if (line.status === 'error') return <XCircle size={12} />;
  if (line.status === 'done' && line.category === 'ledger-update') return <Landmark size={12} />;
  if (line.status === 'done') return <CheckCircle2 size={12} />;
  if (line.category === 'approval-required') return <Gavel size={12} />;
  return <Bot size={12} />;
}

function lineClass(line: RailLine): string {
  if (line.status === 'error') return 'border-[rgba(196,103,103,0.6)] bg-[rgba(196,103,103,0.14)] text-[var(--aw-danger)]';
  if (line.category === 'approval-required') return 'border-[rgba(201,165,106,0.7)] bg-[rgba(201,165,106,0.2)] text-[#e6c892]';
  if (line.status === 'done') return 'border-[rgba(88,166,132,0.6)] bg-[rgba(88,166,132,0.14)] text-[var(--aw-success)]';
  return 'border-[rgba(201,165,106,0.6)] bg-[rgba(201,165,106,0.16)] text-[#e6c892]';
}

function stepToLine(step: AgentStep): RailLine {
  const category = categoryForStep(step);
  const discoveredUrl = step.url || firstUrlFromText(step.description);

  return {
    id: step.id,
    timestamp: step.timestamp,
    category,
    title: labelForCategory(category),
    detail: step.description,
    domain: domainFromUrl(discoveredUrl),
    status: step.status,
  };
}

function dedupeEvidence(records: EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  const deduped: EvidenceRecord[] = [];

  for (const record of records) {
    const key = `${record.vendorName}|${record.planName}|${record.sourceUrl}|${record.extractedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

export function AgentRail({ demoMode = false }: { demoMode?: boolean }) {
  const { activeTask, messages, isProcessing } = useApp();

  const stepLines = useMemo<RailLine[]>(() => {
    const mergedSteps: AgentStep[] = [];

    for (const message of messages) {
      if (message.type !== 'agent-log' || !message.data) continue;
      const data = message.data as AgentLogData;
      if (!Array.isArray(data.steps)) continue;
      mergedSteps.push(...data.steps);
    }

    if (activeTask?.steps?.length) {
      mergedSteps.push(...activeTask.steps);
    }

    const seen = new Set<string>();
    const lines: RailLine[] = [];
    for (const step of mergedSteps) {
      if (seen.has(step.id)) continue;
      seen.add(step.id);
      lines.push(stepToLine(step));
    }

    return lines;
  }, [messages, activeTask]);

  const syntheticLines = useMemo<RailLine[]>(() => {
    const lines: RailLine[] = [];

    for (const message of messages) {
      if (message.type === 'evidence' && message.data) {
        const data = message.data as EvidenceData;
        if (!Array.isArray(data.findings)) continue;
        const firstSource = data.findings[0];
        lines.push({
          id: `${message.id}_evidence`,
          timestamp: message.timestamp,
          category: 'extracting-pricing',
          title: labelForCategory('extracting-pricing'),
          detail: `${data.findings.length} live pricing finding${data.findings.length === 1 ? '' : 's'} captured.`,
          domain: firstSource ? domainFromUrl(firstSource.sourceUrl) : undefined,
          status: 'done',
        });
      }

      if (message.type === 'approval' && message.data) {
        const data = message.data as ApprovalData;
        lines.push({
          id: `${message.id}_approval`,
          timestamp: message.timestamp,
          category: 'approval-required',
          title: labelForCategory('approval-required'),
          detail: `${data.merchant} • ${data.item} • ${fmt(data.amount)}`,
          status: 'info',
        });
      }

      if (message.type === 'receipt' && message.data) {
        const data = message.data as ReceiptData;
        lines.push({
          id: `${message.id}_receipt`,
          timestamp: message.timestamp,
          category: 'ledger-update',
          title: labelForCategory('ledger-update'),
          detail: `${data.merchant} posted. New balance ${fmt(data.newBalance)}.`,
          status: 'done',
        });
      }
    }

    return lines;
  }, [messages]);

  const feed = useMemo(() => {
    return [...stepLines, ...syntheticLines]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, demoMode ? 14 : 10);
  }, [stepLines, syntheticLines, demoMode]);

  const evidence = useMemo(() => {
    const records: EvidenceRecord[] = [];
    for (const message of messages) {
      if (message.type !== 'evidence' || !message.data) continue;
      const data = message.data as EvidenceData;
      if (!Array.isArray(data.findings)) continue;
      records.push(...data.findings);
    }

    return dedupeEvidence(records)
      .sort((a, b) => Date.parse(b.extractedAt) - Date.parse(a.extractedAt))
      .slice(0, demoMode ? 6 : 4);
  }, [messages, demoMode]);

  const railState = statusForRail(isProcessing, activeTask?.status);

  const currentDomain = useMemo(() => {
    const fromFeed = feed.find((line) => Boolean(line.domain))?.domain;
    if (fromFeed) return fromFeed;
    const fromEvidence = evidence.find((record) => Boolean(record.sourceUrl));
    return fromEvidence ? domainFromUrl(fromEvidence.sourceUrl) : undefined;
  }, [feed, evidence]);

  const hasActivity = feed.length > 0 || evidence.length > 0;

  return (
    <section className={cn('aw-surface p-5 flex flex-col', demoMode ? 'min-h-[27rem]' : 'min-h-[18rem]')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="aw-kicker">Agent Rail</p>
          <h3 className={cn('mt-1 font-semibold text-[var(--aw-text)]', demoMode ? 'text-lg' : 'text-base')}>
            Live Execution Stream
          </h3>
        </div>
        <span className="aw-status-chip" data-state={railState.state}>{railState.label}</span>
      </div>

      <div className="mt-3 rounded-2xl border border-[var(--aw-border)] bg-black/15 px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-[0.09em] text-[var(--aw-text-muted)]">Current Domain</p>
        <div className="mt-1 flex items-center gap-2">
          <Compass size={12} className="text-[#e2c48f]" />
          <p className="text-sm text-[var(--aw-text-soft)]">{currentDomain || 'No live browser target yet'}</p>
        </div>
      </div>

      {!hasActivity && !isProcessing && activeTask?.status !== 'awaiting-approval' ? (
        <div className="mt-4 flex-1 rounded-2xl border border-dashed border-[var(--aw-border)] bg-black/10 px-4 py-5">
          <p className="text-sm text-[var(--aw-text-soft)]">Mission control is standing by.</p>
          <p className="mt-1 text-xs text-[var(--aw-text-muted)]">Run a real task to stream planning, site visits, pricing extraction, policy checks, approvals, and ledger outcomes.</p>
        </div>
      ) : (
        <>
          <div className={cn('aw-scroll mt-4 overflow-y-auto pr-1', demoMode ? 'max-h-[20rem]' : 'max-h-[14rem]')}>
            <ul className="space-y-2.5">
              {feed.map((line, index) => (
                <li
                  key={line.id}
                  className="animate-sheet-rise rounded-xl border border-[var(--aw-border)] bg-black/20 px-3 py-2.5"
                  style={{ animationDelay: `${Math.min(index * 32, 200)}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className={cn('mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border', lineClass(line))}>
                        {iconForLine(line)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[10px] uppercase tracking-[0.11em] text-[var(--aw-text-muted)]">{line.title}</p>
                          {line.domain && (
                            <span className="rounded-full border border-[var(--aw-border)] bg-black/30 px-1.5 py-0.5 text-[10px] text-[var(--aw-text-soft)]">
                              {line.domain}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm text-[var(--aw-text-soft)] leading-5">{line.detail}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)] whitespace-nowrap">
                      <Clock3 size={10} />
                      {fmtTime(line.timestamp)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {evidence.length > 0 && (
            <div className="mt-4 border-t border-[var(--aw-border)] pt-3">
              <p className="aw-kicker inline-flex items-center gap-1.5"><Sparkles size={11} /> Live Evidence</p>
              <div className={cn('aw-scroll mt-2 grid gap-2 pr-1', demoMode ? 'max-h-[13rem]' : 'max-h-[8.5rem]', 'overflow-y-auto')}>
                {evidence.map((finding, index) => (
                  <article
                    key={`${finding.vendorName}_${finding.planName}_${finding.extractedAt}_${index}`}
                    className="animate-sheet-rise rounded-xl border border-[var(--aw-border)] bg-black/20 px-3 py-2.5"
                    style={{ animationDelay: `${Math.min(index * 40, 220)}ms` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-[var(--aw-text)] font-semibold truncate">{finding.vendorName}</p>
                      <span className="text-xs text-[#e7d0a8] whitespace-nowrap">{fmt(finding.price)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--aw-text-soft)]">{finding.planName} · {finding.billingFrequency}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.07em] text-[var(--aw-text-muted)]">
                      <span className="inline-flex items-center gap-1"><ShieldCheck size={10} />Extracted</span>
                      <span>{domainFromUrl(finding.sourceUrl) || 'source'}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
