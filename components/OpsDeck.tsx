'use client';

import { useMemo } from 'react';
import { BadgeCheck, History, Layers3, Shield } from 'lucide-react';
import { useApp } from '@/lib/store';
import { ChatMessage, EvidenceData, EvidenceRecord, OptionsData, VendorOption } from '@/lib/types';
import { domainFromUrl, fmt, fmtTime } from '@/lib/utils';
import { canSpendSnapshot } from '@/services/wallet';

function extractLatestOptions(messages: ChatMessage[]): OptionsData | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.type !== 'options' || !message.data) continue;
    return message.data as OptionsData;
  }
  return null;
}

function resolveRecommendation(optionsData: OptionsData | null): VendorOption | null {
  if (!optionsData || optionsData.options.length === 0) return null;
  if (!optionsData.recommendedId) return optionsData.options[0];
  return optionsData.options.find((option) => option.id === optionsData.recommendedId) || optionsData.options[0];
}

function extractEvidence(messages: ChatMessage[]): EvidenceRecord[] {
  const findings: EvidenceRecord[] = [];
  for (const message of messages) {
    if (message.type !== 'evidence' || !message.data) continue;
    const data = message.data as EvidenceData;
    if (!Array.isArray(data.findings)) continue;
    findings.push(...data.findings);
  }
  return findings;
}

function evidenceForVendor(vendor: string, findings: EvidenceRecord[]): EvidenceRecord[] {
  const normalized = vendor.toLowerCase();
  return findings.filter((finding) => finding.vendorName.toLowerCase().includes(normalized) || normalized.includes(finding.vendorName.toLowerCase()));
}

function dedupeBySource(records: EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  const deduped: EvidenceRecord[] = [];

  for (const record of records) {
    const key = record.sourceUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

function monthlyView(record: EvidenceRecord | null): { amount: number | null; frequency: string; note: string } {
  if (!record) {
    return {
      amount: null,
      frequency: 'Not reported',
      note: 'No billing cadence in current evidence',
    };
  }

  const frequency = record.billingFrequency || 'Not reported';
  const lower = frequency.toLowerCase();

  if (lower.includes('month') || lower === 'mo') {
    return { amount: record.price, frequency, note: 'Direct monthly quote' };
  }

  if (lower.includes('year') || lower.includes('annual')) {
    return { amount: record.price / 12, frequency, note: 'Derived from annual quote' };
  }

  if (lower.includes('week')) {
    return { amount: (record.price * 52) / 12, frequency, note: 'Derived from weekly quote' };
  }

  return { amount: null, frequency, note: 'Cannot normalize to monthly from evidence' };
}

function optionRank(option: VendorOption, optionSet: VendorOption[]): number {
  if (optionSet.length === 0) return 1;

  const sorted = [...optionSet].sort((a, b) => {
    const scoreA = (a.rating ?? 0) - a.price / 10;
    const scoreB = (b.rating ?? 0) - b.price / 10;
    return scoreB - scoreA;
  });

  const index = sorted.findIndex((entry) => entry.id === option.id);
  return index >= 0 ? index + 1 : 1;
}

function confidenceScore({
  hasEvidence,
  evidenceCount,
  rank,
  total,
  rating,
  policyAllowed,
}: {
  hasEvidence: boolean;
  evidenceCount: number;
  rank: number;
  total: number;
  rating?: number;
  policyAllowed: boolean;
}): number {
  let score = 44;
  if (hasEvidence) score += 18;
  if (evidenceCount >= 2) score += 8;
  if (rank === 1) score += 12;
  else if (rank <= Math.max(2, Math.ceil(total / 2))) score += 7;
  if ((rating ?? 0) >= 4) score += 8;
  if (policyAllowed) score += 7;
  return Math.max(0, Math.min(98, score));
}

function confidenceLabel(score: number): string {
  if (score >= 78) return 'High confidence';
  if (score >= 60) return 'Moderate confidence';
  return 'Limited confidence';
}

export function OpsDeck({ demoMode = false }: { demoMode?: boolean }) {
  const { wallet, activeTask, messages, toggleHistory, toggleSettings } = useApp();

  const latestOptions = useMemo(() => extractLatestOptions(messages), [messages]);
  const fallbackRecommendation = useMemo(() => resolveRecommendation(latestOptions), [latestOptions]);
  const recommendation = activeTask?.selectedOption || fallbackRecommendation;
  const findings = useMemo(() => extractEvidence(messages), [messages]);

  const pendingApproval = activeTask?.status === 'awaiting-approval' && Boolean(activeTask.selectedOption);

  const recentTransactions = useMemo(
    () => [...wallet.transactions].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 3),
    [wallet.transactions],
  );

  const optionSet = latestOptions?.options || [];

  const recommendationTrust = useMemo(() => {
    if (!recommendation) return null;

    const vendorEvidence = evidenceForVendor(recommendation.name, findings);
    const selectedEvidence = vendorEvidence[0] || null;
    const sourceEvidence = dedupeBySource(vendorEvidence.length > 0 ? vendorEvidence : findings).slice(0, 2);

    const rank = optionRank(recommendation, optionSet);
    const policyFit = canSpendSnapshot(wallet, recommendation.price, recommendation.name);
    const monthly = monthlyView(selectedEvidence);

    const reasons: string[] = [];
    reasons.push(`Ranked #${rank} of ${Math.max(optionSet.length, 1)} among current live options.`);

    if (typeof recommendation.rating === 'number') {
      reasons.push(`Strong vendor signal from live rating (${recommendation.rating.toFixed(1)}).`);
    }

    if (selectedEvidence) {
      reasons.push(`Live pricing evidence captured from ${domainFromUrl(selectedEvidence.sourceUrl) || 'source'}.`);
    } else if (findings.length > 0) {
      reasons.push(`Compared against ${findings.length} evidence records from current TinyFish run.`);
    }

    const score = confidenceScore({
      hasEvidence: Boolean(selectedEvidence),
      evidenceCount: vendorEvidence.length,
      rank,
      total: optionSet.length || 1,
      rating: recommendation.rating,
      policyAllowed: policyFit.allowed,
    });

    return {
      selectedEvidence,
      sourceEvidence,
      policyFit,
      monthly,
      reasons: reasons.slice(0, 3),
      confidence: score,
      confidenceLabel: confidenceLabel(score),
    };
  }, [recommendation, findings, optionSet, wallet]);

  return (
    <section className="aw-surface p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="aw-kicker">Operations Deck</p>
          <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">Recommendation, approvals, and ledger visibility</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleSettings} className="aw-button-secondary px-3 py-1.5 text-xs">Guardrails</button>
          <button onClick={toggleHistory} className="aw-button-secondary px-3 py-1.5 text-xs">Full Ledger</button>
        </div>
      </div>

      <div className={demoMode ? 'mt-4 grid grid-cols-1 gap-3 md:grid-cols-4' : 'mt-4 grid grid-cols-1 gap-3 md:grid-cols-3'}>
        <article className="rounded-2xl border border-[var(--aw-border)] bg-black/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-[var(--aw-text-muted)]">
              <BadgeCheck size={13} />
              Recommendation
            </div>
            {recommendationTrust && (
              <span className="rounded-full border border-[var(--aw-border)] bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-soft)]">
                {recommendationTrust.confidenceLabel}
              </span>
            )}
          </div>

          {recommendation && recommendationTrust ? (
            <div className="mt-3 space-y-3 animate-sheet-rise">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Selected vendor</p>
                <p className="text-sm font-semibold text-[var(--aw-text)]">{recommendation.name}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-[var(--aw-border)] bg-black/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Plan</p>
                  <p className="mt-1 text-xs text-[var(--aw-text-soft)]">{recommendationTrust.selectedEvidence?.planName || recommendation.item}</p>
                </div>
                <div className="rounded-xl border border-[var(--aw-border)] bg-black/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Monthly price</p>
                  <p className="mt-1 text-sm font-semibold text-[#e7d0a8]">
                    {recommendationTrust.monthly.amount !== null ? fmt(recommendationTrust.monthly.amount) : 'N/A'}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--aw-border)] bg-black/20 px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Billing frequency</p>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">{recommendationTrust.monthly.frequency}</p>
                <p className="mt-0.5 text-[10px] text-[var(--aw-text-muted)]">{recommendationTrust.monthly.note}</p>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Top reasons selected</p>
                <ul className="mt-1.5 space-y-1">
                  {recommendationTrust.reasons.map((reason) => (
                    <li key={reason} className="text-xs text-[var(--aw-text-soft)]">• {reason}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Evidence references</p>
                {recommendationTrust.sourceEvidence.length === 0 ? (
                  <p className="mt-1 text-xs text-[var(--aw-text-muted)]">No source URLs captured yet.</p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {recommendationTrust.sourceEvidence.map((record) => (
                      <a
                        key={`${record.sourceUrl}_${record.extractedAt}`}
                        href={record.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-xs text-[#d7c29d] hover:text-[#eed9b4] transition-colors truncate"
                      >
                        {domainFromUrl(record.sourceUrl) || record.sourceUrl}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-[var(--aw-border)] bg-black/20 px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Policy-fit summary</p>
                <p className={`mt-1 text-xs ${recommendationTrust.policyFit.allowed ? 'text-[var(--aw-text-soft)]' : 'text-[rgba(245,180,180,0.9)]'}`}>
                  {recommendationTrust.policyFit.allowed
                    ? 'Fits current balance and active spending guardrails.'
                    : `Blocked right now: ${recommendationTrust.policyFit.reason || 'policy mismatch'}`}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                  <span>Confidence signal</span>
                  <span>{recommendationTrust.confidence}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,#9c7a47,#d6ba84)] transition-all duration-500" style={{ width: `${recommendationTrust.confidence}%` }} />
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-2.5 text-sm text-[var(--aw-text-muted)]">No recommendation yet. Submit a buy task to generate options.</p>
          )}
        </article>

        <article className="rounded-2xl border border-[var(--aw-border)] bg-black/20 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-[var(--aw-text-muted)]">
            <Shield size={13} />
            Approval Queue
          </div>
          {pendingApproval && activeTask?.selectedOption ? (
            <div className="mt-2.5 space-y-1.5">
              <p className="text-sm font-semibold text-[var(--aw-text)]">Approval required now</p>
              <p className="text-sm text-[var(--aw-text-soft)]">{activeTask.selectedOption.name} • {activeTask.selectedOption.item}</p>
              <p className="text-sm text-[#e7d0a8]">{fmt(activeTask.selectedOption.price)}</p>
            </div>
          ) : (
            <p className="mt-2.5 text-sm text-[var(--aw-text-muted)]">No pending approvals. Automatic flow continues under your configured threshold.</p>
          )}
        </article>

        {demoMode && (
          <article className="rounded-2xl border border-[var(--aw-border)] bg-black/20 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-[var(--aw-text-muted)]">
              <BadgeCheck size={13} />
              Research Evidence
            </div>
            {findings.length === 0 ? (
              <p className="mt-2.5 text-sm text-[var(--aw-text-muted)]">Waiting for TinyFish evidence from live runs.</p>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                <p className="text-sm text-[var(--aw-text-soft)]">{findings.length} extracted pricing records</p>
                <p className="text-sm text-[var(--aw-text)]">
                  Sources: {dedupeBySource(findings).map((record) => domainFromUrl(record.sourceUrl)).filter(Boolean).slice(0, 2).join(', ') || 'live web'}
                </p>
              </div>
            )}
          </article>
        )}

        <article className="rounded-2xl border border-[var(--aw-border)] bg-black/20 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-[var(--aw-text-muted)]">
            <Layers3 size={13} />
            Ledger Snapshot
          </div>
          {recentTransactions.length === 0 ? (
            <p className="mt-2.5 text-sm text-[var(--aw-text-muted)]">No transactions recorded yet.</p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {recentTransactions.map((tx) => (
                <li key={tx.id} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-[var(--aw-text-soft)]">{tx.description}</p>
                    <p className="text-[11px] text-[var(--aw-text-muted)]">{fmtTime(tx.createdAt)}</p>
                  </div>
                  <p className="whitespace-nowrap font-semibold text-[var(--aw-text)]">
                    {tx.direction === 'credit' ? '+' : '-'}{fmt(tx.amount)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <button onClick={toggleHistory} className="aw-button-ghost mt-3 w-full py-2 text-xs">
            <span className="inline-flex items-center gap-1">
              <History size={12} />
              Open transaction ledger
            </span>
          </button>
        </article>
      </div>
    </section>
  );
}
