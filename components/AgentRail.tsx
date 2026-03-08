'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, Clock3, Compass, Gavel, Landmark, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { useApp } from '@/lib/store';
import { fetchProcurementResearchStatus } from '@/services/procurement';
import {
  AgentLogData, AgentStep, EvidenceData, EvidenceRecord, ProcurementFinding, ProcurementResearchLog, ProcurementTaskRecord,
} from '@/lib/types';
import { cn, domainFromUrl, firstUrlFromText, fmt, fmtTime } from '@/lib/utils';

type RailCategory =
  | 'parsing_intent'
  | 'resolving_missing_fields'
  | 'checking_recipient'
  | 'researching_vendors'
  | 'visiting_site'
  | 'extracting_pricing'
  | 'comparing_options'
  | 'preparing_signup'
  | 'filling_form'
  | 'preparing_payment'
  | 'policy_checks'
  | 'awaiting_approval'
  | 'completed'
  | 'failed';

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
    case 'parsing_intent':
      return 'Parsing Intent';
    case 'resolving_missing_fields':
      return 'Resolving Missing Fields';
    case 'checking_recipient':
      return 'Checking Recipient';
    case 'researching_vendors':
      return 'Researching Vendors';
    case 'visiting_site':
      return 'Visiting Site';
    case 'extracting_pricing':
      return 'Extracting Pricing';
    case 'comparing_options':
      return 'Comparing Options';
    case 'preparing_signup':
      return 'Preparing Sign-up';
    case 'filling_form':
      return 'Filling Form';
    case 'preparing_payment':
      return 'Preparing Payment';
    case 'policy_checks':
      return 'Policy Checks';
    case 'awaiting_approval':
      return 'Awaiting Approval';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return 'Activity';
  }
}

function categoryForStep(step: AgentStep): RailCategory {
  const lower = step.description.toLowerCase();
  if (lower.includes('parsing') || lower.includes('intent')) return 'parsing_intent';
  if (lower.includes('clarification') || lower.includes('missing')) return 'resolving_missing_fields';
  if (lower.includes('recipient')) return 'checking_recipient';
  switch (step.type) {
    case 'plan':
      return 'researching_vendors';
    case 'search':
      return 'researching_vendors';
    case 'visit':
      return 'visiting_site';
    case 'extract':
      return 'extracting_pricing';
    case 'compare':
    case 'select':
      return 'comparing_options';
    case 'guardrail':
      return lower.includes('approval') ? 'awaiting_approval' : 'policy_checks';
    case 'checkout':
      return lower.includes('signup') || lower.includes('sign-in') ? 'preparing_signup' : 'preparing_payment';
    case 'form-fill':
      return 'filling_form';
    case 'confirm':
    case 'payment':
      return 'completed';
    default:
      return 'researching_vendors';
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
  if (line.status === 'done' && line.category === 'completed') return <Landmark size={12} />;
  if (line.status === 'done') return <CheckCircle2 size={12} />;
  if (line.category === 'awaiting_approval') return <Gavel size={12} />;
  return <Bot size={12} />;
}

function lineClass(line: RailLine): string {
  if (line.status === 'error') return 'border-[rgba(196,103,103,0.6)] bg-[rgba(196,103,103,0.14)] text-[var(--aw-danger)]';
  if (line.category === 'awaiting_approval') return 'border-[rgba(201,165,106,0.7)] bg-[rgba(201,165,106,0.2)] text-[#e6c892]';
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

function mapProcurementLog(log: ProcurementResearchLog): RailLine {
  const lower = log.message.toLowerCase();
  let category: RailCategory = 'researching_vendors';

  if (log.actionType === 'visit') category = 'visiting_site';
  else if (log.actionType === 'extract') category = 'extracting_pricing';
  else if (log.actionType === 'compare') category = 'comparing_options';
  else if (log.actionType === 'form-fill') category = 'filling_form';
  else if (log.actionType === 'guardrail') category = 'policy_checks';
  else if (log.actionType === 'checkout') {
    category = lower.includes('signup') || lower.includes('sign-in') ? 'preparing_signup' : 'preparing_payment';
  } else if (log.actionType === 'plan') {
    if (lower.includes('approval')) category = 'awaiting_approval';
    else if (lower.includes('failed')) category = 'failed';
    else category = 'researching_vendors';
  }

  return {
    id: `research_log_${log.id}`,
    timestamp: log.createdAt,
    category,
    title: labelForCategory(category),
    detail: log.message,
    domain: log.url ? domainFromUrl(log.url) : undefined,
    status: log.status,
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
  const { activeTask, messages, isProcessing, latestProcurementTask } = useApp();
  const [realLogs, setRealLogs] = useState<ProcurementResearchLog[]>([]);
  const [realFindings, setRealFindings] = useState<ProcurementFinding[]>([]);
  const [liveTask, setLiveTask] = useState<ProcurementTaskRecord | null>(null);
  const sinceRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!latestProcurementTask?.id) {
      setRealLogs([]);
      setRealFindings([]);
      setLiveTask(null);
      sinceRef.current = undefined;
      return;
    }

    let cancelled = false;
    const taskId = latestProcurementTask.id;

    const run = async (incremental: boolean) => {
      try {
        const status = await fetchProcurementResearchStatus(taskId, incremental ? sinceRef.current : undefined);
        if (cancelled) return;
        setLiveTask(status.task);
        setRealFindings(status.findings);
        setRealLogs((prev) => {
          if (!incremental) return status.logs;
          const merged = [...prev, ...status.logs];
          const seen = new Set<string>();
          return merged.filter((log) => {
            if (seen.has(log.id)) return false;
            seen.add(log.id);
            return true;
          });
        });
        sinceRef.current = status.serverTime;
      } catch {
        // Keep current feed; no fake fallback entries.
      }
    };

    void run(false);
    const interval = window.setInterval(() => void run(true), 2200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [latestProcurementTask?.id]);

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

  const realLines = useMemo<RailLine[]>(() => realLogs.map(mapProcurementLog), [realLogs]);

  const stateLine = useMemo<RailLine | null>(() => {
    if (!liveTask) return null;
    if (liveTask.status === 'awaiting_approval') {
      return {
        id: `task_state_${liveTask.id}_${liveTask.updatedAt}`,
        timestamp: liveTask.updatedAt,
        category: 'awaiting_approval',
        title: labelForCategory('awaiting_approval'),
        detail: 'Workflow is paused for approval before continuing.',
        status: 'info',
      };
    }
    if (liveTask.status === 'failed') {
      return {
        id: `task_state_${liveTask.id}_${liveTask.updatedAt}`,
        timestamp: liveTask.updatedAt,
        category: 'failed',
        title: labelForCategory('failed'),
        detail: liveTask.error || 'Task failed.',
        status: 'error',
      };
    }
    if (liveTask.status === 'purchase_prepared') {
      return {
        id: `task_state_${liveTask.id}_${liveTask.updatedAt}`,
        timestamp: liveTask.updatedAt,
        category: 'completed',
        title: labelForCategory('completed'),
        detail: 'Autonomous flow completed and recorded in task state.',
        status: 'done',
      };
    }
    return null;
  }, [liveTask]);

  const feed = useMemo(() => {
    const terminal = stateLine ? [stateLine] : [];
    return [...stepLines, ...realLines, ...terminal]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, demoMode ? 14 : 10);
  }, [stepLines, realLines, stateLine, demoMode]);

  const evidence = useMemo(() => {
    if (realFindings.length > 0) {
      const mapped = realFindings.map((finding) => ({
        vendorName: finding.vendorName,
        planName: finding.planName,
        price: finding.monthlyPrice ?? finding.annualPrice ?? 0,
        billingFrequency: finding.billingFrequency,
        keyFeatures: finding.notableFeatures,
        sourceUrl: finding.pricingPageUrl,
        extractedAt: finding.extractionTimestamp,
      }));

      return dedupeEvidence(mapped)
        .sort((a, b) => Date.parse(b.extractedAt) - Date.parse(a.extractedAt))
        .slice(0, demoMode ? 6 : 4);
    }

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
  }, [realFindings, messages, demoMode]);

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
