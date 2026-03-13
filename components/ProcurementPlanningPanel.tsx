"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  HelpCircle,
  Landmark,
  Loader2,
  Play,
  Scale,
  Target,
  XCircle,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { fmt, fmtTime } from "@/lib/utils";
import type {
  ProcurementFinding,
  ProcurementLifecycleState,
  ProcurementRecommendationRecord,
  ProcurementResearchLog,
  ProcurementTaskRecord,
} from "@/lib/types";
import {
  compareProcurementFindings,
  fetchProcurementResearchStatus,
  startProcurementResearch,
  submitProcurementApproval,
} from "@/services/procurement";
import { ProcurementApprovalSheet } from "@/components/ProcurementApprovalSheet";

function budgetLabel(amount: number | null, period: string): string {
  if (amount === null) return "Not specified";
  return `${fmt(amount)} / ${period}`;
}

function statusLabel(status: ProcurementTaskRecord["status"]): string {
  if (status === "needs_clarification") return "Needs Clarification";
  if (status === "planned") return "Planned";
  if (status === "researching") return "Researching";
  if (status === "researched") return "Researched";
  if (status === "awaiting_approval") return "Awaiting Approval";
  if (status === "purchase_preparing") return "Preparing Purchase";
  if (status === "purchase_prepared") return "Prepared";
  if (status === "rejected") return "Rejected";
  if (status === "failed") return "Failed";
  return "Planning";
}

function mergeLogs(
  existing: ProcurementResearchLog[],
  incoming: ProcurementResearchLog[],
): ProcurementResearchLog[] {
  const byId = new Map<string, ProcurementResearchLog>();

  for (const log of existing) byId.set(log.id, log);
  for (const log of incoming) byId.set(log.id, log);

  return Array.from(byId.values()).sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

function parseRecommendation(
  value: Record<string, unknown> | null,
): ProcurementRecommendationRecord | null {
  if (!value || typeof value !== "object") return null;
  const cast = value as Partial<ProcurementRecommendationRecord>;
  if (
    !cast.generatedAt ||
    !cast.engineVersion ||
    !Array.isArray(cast.whyWinner)
  )
    return null;
  return cast as ProcurementRecommendationRecord;
}

function winnerPriceLabel(
  recommendation: ProcurementRecommendationRecord,
): string {
  const winner = recommendation.winner;
  if (!winner) return "No budget-fit winner";
  if (winner.monthlyPrice !== null)
    return `${fmt(winner.monthlyPrice)} monthly`;
  if (winner.annualPrice !== null) return `${fmt(winner.annualPrice)} annual`;
  return "Price unavailable";
}

export function ProcurementPlanningPanel() {
  const { latestProcurementPlan, latestProcurementTask, refreshWallet } =
    useApp();

  const [task, setTask] = useState<ProcurementTaskRecord | null>(
    latestProcurementTask,
  );
  const [findings, setFindings] = useState<ProcurementFinding[]>([]);
  const [logs, setLogs] = useState<ProcurementResearchLog[]>([]);
  const [lifecycle, setLifecycle] = useState<ProcurementLifecycleState | null>(
    null,
  );
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [isStarting, setIsStarting] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [isApprovalSheetOpen, setIsApprovalSheetOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setTask(latestProcurementTask);
    setFindings([]);
    setLogs([]);
    setLifecycle(null);
    setCursor(undefined);
    setIsApprovalSheetOpen(false);
    setLoadError(null);
  }, [latestProcurementTask?.id]);

  const refreshStatus = useCallback(
    async (incremental: boolean) => {
      if (!task) return;

      const response = await fetchProcurementResearchStatus(
        task.id,
        incremental ? cursor : undefined,
      );
      setTask(response.task);
      setLifecycle(response.lifecycle);
      setFindings(response.findings);
      setLogs((prev) =>
        incremental ? mergeLogs(prev, response.logs) : response.logs,
      );
      setCursor(response.serverTime);
    },
    [task, cursor],
  );

  useEffect(() => {
    if (!task) return;

    void refreshStatus(false).catch((error) => {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to load research status",
      );
    });
  }, [task?.id]);

  useEffect(() => {
    if (
      !task ||
      (task.status !== "researching" && task.status !== "purchase_preparing")
    )
      return;

    const handle = window.setInterval(() => {
      void refreshStatus(true).catch((error) => {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to refresh research status",
        );
      });
    }, 1800);

    return () => window.clearInterval(handle);
  }, [task?.id, task?.status, refreshStatus]);

  const runResearch = async () => {
    if (
      !task ||
      task.status === "researching" ||
      task.status === "needs_clarification"
    )
      return;

    setLoadError(null);
    setIsStarting(true);
    try {
      await startProcurementResearch(task.id);
      await refreshStatus(false);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to start live research",
      );
    } finally {
      setIsStarting(false);
    }
  };

  const runComparison = async () => {
    if (!task || isResearching || findings.length === 0) return;

    setLoadError(null);
    setIsComparing(true);
    try {
      await compareProcurementFindings(task.id);
      await refreshStatus(false);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to evaluate recommendation",
      );
    } finally {
      setIsComparing(false);
    }
  };

  const runApproval = async (decision: "approved" | "rejected") => {
    if (!task || !recommendation || !recommendation.winner) return;

    setLoadError(null);
    setIsSubmittingApproval(true);
    try {
      await submitProcurementApproval(task.id, decision);
      if (decision === "approved") {
        await refreshWallet();
      }
      await refreshStatus(false);
      setIsApprovalSheetOpen(false);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to submit approval decision",
      );
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const isResearching =
    task?.status === "researching" || task?.status === "purchase_preparing";
  const recommendation = useMemo(
    () => parseRecommendation(task?.recommendation || null),
    [task?.recommendation],
  );

  const sourceDomains = useMemo(() => {
    const domains = findings
      .map((finding) => {
        try {
          return new URL(finding.pricingPageUrl).hostname.replace(/^www\./, "");
        } catch {
          return null;
        }
      })
      .filter(Boolean) as string[];

    return Array.from(new Set(domains));
  }, [findings]);

  if (!latestProcurementPlan || !task) return null;

  return (
    <section className="aw-surface-elevated p-5 md:p-6 animate-sheet-rise">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="aw-kicker">Procurement Workspace</p>
          <h3 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.01em] text-[var(--aw-text)]">
            Plan and Live Vendor Research
          </h3>
          <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
            Review criteria, findings, and approval-ready recommendations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-soft)]">
            {statusLabel(task.status)}
          </div>
          {lifecycle && (
            <div className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
              Phase: {lifecycle.phase}
            </div>
          )}
          {task.status !== "needs_clarification" && (
            <button
              onClick={() => {
                void runResearch();
              }}
              disabled={isStarting || isResearching}
              className="aw-button-secondary px-3 py-1.5 text-xs disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1">
                {isStarting || isResearching ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Play size={12} />
                )}
                {isResearching ? "Researching" : "Start Live Research"}
              </span>
            </button>
          )}
          {task.status !== "needs_clarification" && (
            <button
              onClick={() => {
                void runComparison();
              }}
              disabled={isComparing || isResearching || findings.length === 0}
              className="aw-button-secondary px-3 py-1.5 text-xs disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1">
                {isComparing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Scale size={12} />
                )}
                {isComparing ? "Evaluating" : "Generate Recommendation"}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <article className="rounded-xl border border-[var(--aw-border)] bg-white px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)] inline-flex items-center gap-1">
            <Target size={11} />
            Normalized Goal
          </p>
          <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
            {latestProcurementPlan.normalizedGoal}
          </p>
          <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
            Category: {latestProcurementPlan.category}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--aw-border)] bg-white px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)] inline-flex items-center gap-1">
            <Landmark size={11} />
            Budget Constraint
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--aw-primary-strong)]">
            {budgetLabel(
              latestProcurementPlan.budgetConstraint.amount,
              latestProcurementPlan.budgetConstraint.period,
            )}
          </p>
          {latestProcurementPlan.budgetConstraint.rawText && (
            <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
              From request: {latestProcurementPlan.budgetConstraint.rawText}
            </p>
          )}
        </article>

        <article className="rounded-xl border border-[var(--aw-border)] bg-white px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)] inline-flex items-center gap-1">
            <ClipboardList size={11} />
            Target Vendors
          </p>
          {latestProcurementPlan.targetVendorCandidates.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
              Candidate vendors will appear after planning or discovery.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {latestProcurementPlan.targetVendorCandidates.map((vendor) => (
                <span
                  key={vendor}
                  className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-2 py-0.5 text-xs text-[var(--aw-text-soft)]"
                >
                  {vendor}
                </span>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-xl border border-[var(--aw-border)] bg-white px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
            Must-Have Features
          </p>
          {latestProcurementPlan.mustHaveFeatures.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
              No required features identified.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {latestProcurementPlan.mustHaveFeatures
                .slice(0, 5)
                .map((feature) => (
                  <li
                    key={feature}
                    className="text-xs text-[var(--aw-text-soft)]"
                  >
                    • {feature}
                  </li>
                ))}
            </ul>
          )}
        </article>
      </div>

      <article className="mt-4 rounded-xl border border-[var(--aw-border)] bg-white px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
          Comparison Criteria
        </p>
        {latestProcurementPlan.comparisonCriteria.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
            No criteria generated.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {latestProcurementPlan.comparisonCriteria.map((criterion) => (
              <li
                key={criterion}
                className="text-xs text-[var(--aw-text-soft)]"
              >
                • {criterion}
              </li>
            ))}
          </ul>
        )}
      </article>

      {latestProcurementPlan.clarificationNeeded && (
        <article className="mt-3 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)] inline-flex items-center gap-1">
            <HelpCircle size={11} />
            Follow-Up Questions
          </p>
          <ul className="mt-1.5 space-y-1">
            {latestProcurementPlan.followUpQuestions.map((question) => (
              <li key={question} className="text-xs text-[var(--aw-text-soft)]">
                • {question}
              </li>
            ))}
          </ul>
        </article>
      )}

      {!latestProcurementPlan.clarificationNeeded && (
        <section className="mt-3 grid gap-3 lg:grid-cols-2">
          <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
              Live Research Log
            </p>
            {logs.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
                No live logs yet. Start research to stream automation actions in
                real time.
              </p>
            ) : (
              <div className="aw-scroll mt-2 max-h-52 overflow-y-auto space-y-1.5 pr-1">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                        {log.actionType}
                      </p>
                      <p className="text-[10px] text-[var(--aw-text-muted)]">
                        {fmtTime(log.createdAt)}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                      {log.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
              Live Findings
            </p>
            {findings.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
                No findings captured yet.
              </p>
            ) : (
              <div className="aw-scroll mt-2 max-h-52 overflow-y-auto space-y-2 pr-1">
                {findings.map((finding) => (
                  <div
                    key={finding.id}
                    className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[var(--aw-text)]">
                          {finding.vendorName} · {finding.planName}
                        </p>
                        <p className="text-[10px] text-[var(--aw-text-muted)]">
                          {finding.billingFrequency}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-[var(--aw-primary-strong)]">
                          {finding.monthlyPrice !== null
                            ? fmt(finding.monthlyPrice)
                            : "N/A"}{" "}
                          monthly
                        </p>
                        <p className="text-[10px] text-[var(--aw-text-muted)]">
                          {finding.annualPrice !== null
                            ? `${fmt(finding.annualPrice)} annual`
                            : "annual N/A"}
                        </p>
                      </div>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-[var(--aw-text-muted)]">
                      {finding.pricingPageUrl}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {sourceDomains.length > 0 && (
              <p className="mt-2 text-[10px] text-[var(--aw-text-muted)]">
                Sources: {sourceDomains.slice(0, 4).join(", ")}
              </p>
            )}
          </article>
        </section>
      )}

      {!latestProcurementPlan.clarificationNeeded && (
        <article className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
              Recommendation + Spend Policy
            </p>
            {recommendation && (
              <span className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-soft)]">
                {recommendation.engineVersion}
              </span>
            )}
          </div>

          {!recommendation ? (
            <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
              Run live research, then generate a recommendation to rank findings
              and apply spend-policy checks.
            </p>
          ) : recommendation.winner === null ? (
            <div className="mt-2 rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.1)] px-3 py-2">
              <p className="text-sm text-[var(--aw-danger)]">
                No budget-fit winner found.
              </p>
              <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                {recommendation.noFitExplanation ||
                  "Live findings did not produce a recommendation within budget constraints."}
              </p>
            </div>
          ) : (
            <div className="mt-2 grid gap-3 lg:grid-cols-[1.15fr_1fr]">
              <section className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                      Winner
                    </p>
                    <p className="text-sm font-semibold text-[var(--aw-text)]">
                      {recommendation.winner.vendorName}
                    </p>
                    <p className="text-xs text-[var(--aw-text-soft)]">
                      {recommendation.winner.planName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[var(--aw-primary-strong)]">
                      {winnerPriceLabel(recommendation)}
                    </p>
                    <p className="text-[10px] text-[var(--aw-text-muted)]">
                      {recommendation.winner.billingFrequency}
                    </p>
                  </div>
                </div>

                <a
                  href={recommendation.winner.pricingPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block truncate text-[11px] text-[var(--aw-primary)] hover:text-[var(--aw-primary-strong)] transition-colors"
                >
                  {recommendation.winner.pricingPageUrl}
                </a>

                <div className="mt-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                    Why Selected
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {recommendation.whyWinner.map((reason) => (
                      <li
                        key={reason}
                        className="text-xs text-[var(--aw-text-soft)]"
                      >
                        • {reason}
                      </li>
                    ))}
                  </ul>
                </div>

                {recommendation.alternatives.length > 0 && (
                  <div className="mt-2.5 border-t border-[var(--aw-border)] pt-2.5">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                      Top Alternatives
                    </p>
                    <div className="mt-1.5 space-y-1.5">
                      {recommendation.alternatives.map((option) => (
                        <div
                          key={option.findingId}
                          className="flex items-center justify-between gap-2 rounded-md border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2 py-1.5"
                        >
                          <p className="text-xs text-[var(--aw-text-soft)]">
                            {option.vendorName} · {option.planName}
                          </p>
                          <p className="text-[11px] text-[var(--aw-primary-strong)]">
                            {option.monthlyPrice !== null
                              ? `${fmt(option.monthlyPrice)} monthly`
                              : option.annualPrice !== null
                                ? `${fmt(option.annualPrice)} annual`
                                : "N/A"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                  Policy Summary
                </p>
                {recommendation.policy ? (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      {recommendation.policy.allowed ? (
                        <CheckCircle2
                          size={14}
                          className="text-[var(--aw-success)]"
                        />
                      ) : (
                        <XCircle
                          size={14}
                          className="text-[var(--aw-danger)]"
                        />
                      )}
                      <p
                        className={`text-xs ${recommendation.policy.allowed ? "text-[var(--aw-text-soft)]" : "text-[var(--aw-danger)]"}`}
                      >
                        {recommendation.policy.allowed
                          ? "Blocking policy checks passed."
                          : recommendation.policy.reason ||
                            "One or more blocking checks failed."}
                      </p>
                    </div>

                    <p className="mt-1.5 text-xs text-[var(--aw-text-soft)]">
                      {recommendation.policy.approvalRequired
                        ? "Approval required before execution."
                        : "Approval not required by threshold."}
                    </p>

                    <div className="mt-2 space-y-1.5">
                      {recommendation.policy.checks.map((check) => (
                        <div
                          key={check.key}
                          className="rounded-md border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-[var(--aw-text-soft)]">
                              {check.label}
                            </p>
                            <span
                              className={`text-[10px] uppercase tracking-[0.08em] ${check.passed ? "text-[var(--aw-success)]" : check.blocking ? "text-[var(--aw-danger)]" : "text-[var(--aw-warning)]"}`}
                            >
                              {check.passed
                                ? "pass"
                                : check.blocking
                                  ? "fail"
                                  : "review"}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[10px] text-[var(--aw-text-muted)]">
                            {check.detail}
                          </p>
                        </div>
                      ))}
                    </div>

                    {recommendation.winner && recommendation.policy.allowed && (
                      <div className="mt-2.5">
                        <button
                          onClick={() => setIsApprovalSheetOpen(true)}
                          disabled={
                            isSubmittingApproval ||
                            task.status === "purchase_preparing"
                          }
                          className="aw-button-primary w-full py-2 text-xs disabled:opacity-60"
                        >
                          {task.status === "purchase_prepared"
                            ? "Prepared - View Approval Sheet"
                            : task.status === "purchase_preparing"
                              ? "Preparing Purchase..."
                              : "Open Approval Sheet"}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
                    Policy check unavailable because no winner was selected.
                  </p>
                )}
              </section>
            </div>
          )}

          {recommendation?.purchasePrep && (
            <div className="mt-3 rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                Purchase Preparation
              </p>
              <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                {recommendation.purchasePrep.status === "running" &&
                  "Automation is preparing the live checkout flow."}
                {recommendation.purchasePrep.status === "prepared" &&
                  "Automation prepared the flow and paused before payment."}
                {recommendation.purchasePrep.status === "failed" &&
                  `Preparation failed: ${recommendation.purchasePrep.error || "unknown error"}`}
              </p>
              {recommendation.purchasePrep.checkoutUrl && (
                <a
                  href={recommendation.purchasePrep.checkoutUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 block truncate text-[11px] text-[var(--aw-primary)] hover:text-[var(--aw-primary-strong)] transition-colors"
                >
                  {recommendation.purchasePrep.checkoutUrl}
                </a>
              )}
              {recommendation.purchasePrep.proofUrls.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {recommendation.purchasePrep.proofUrls
                    .slice(0, 3)
                    .map((proof) => (
                      <a
                        key={proof}
                        href={proof}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-[10px] text-[var(--aw-text-muted)] hover:text-[var(--aw-text-soft)] transition-colors"
                      >
                        proof: {proof}
                      </a>
                    ))}
                </div>
              )}
              {recommendation.purchasePrep.pendingLedgerEntry && (
                <div className="mt-1.5 rounded-md border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                    Audit Trail Entry
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--aw-text-soft)]">
                    {recommendation.purchasePrep.pendingLedgerEntry.description}
                  </p>
                  <p className="text-[10px] text-[var(--aw-text-muted)]">
                    {recommendation.purchasePrep.pendingLedgerEntry.entryId} ·{" "}
                    {fmt(recommendation.purchasePrep.pendingLedgerEntry.amount)}{" "}
                    · pending
                  </p>
                </div>
              )}
            </div>
          )}
        </article>
      )}

      {loadError && (
        <p className="mt-3 rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.1)] px-3 py-2 text-xs text-[var(--aw-danger)]">
          {loadError}
        </p>
      )}
      {!loadError && task.error && (
        <p className="mt-3 rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.1)] px-3 py-2 text-xs text-[var(--aw-danger)]">
          {task.error}
        </p>
      )}
      {lifecycle?.retryHint && (
        <p className="mt-2 text-[11px] text-[var(--aw-text-muted)]">
          Recovery: {lifecycle.retryHint}
        </p>
      )}

      {recommendation && recommendation.winner && (
        <ProcurementApprovalSheet
          open={isApprovalSheetOpen}
          recommendation={recommendation}
          isSubmitting={isSubmittingApproval}
          onApprove={() => {
            void runApproval("approved");
          }}
          onReject={() => {
            void runApproval("rejected");
          }}
          onClose={() => setIsApprovalSheetOpen(false)}
        />
      )}
    </section>
  );
}
