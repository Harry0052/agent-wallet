"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChatInterface } from "@/components/ChatInterface";
import { OpsDeck } from "@/components/OpsDeck";
import { AgentRail } from "@/components/AgentRail";
import { ProcurementPlanningPanel } from "@/components/ProcurementPlanningPanel";
import { useApp } from "@/lib/store";

function OperatorContent() {
  const searchParams = useSearchParams();
  const isDemoMode = searchParams.get("demo") === "1";
  const isLandingEntry = searchParams.get("entry") === "landing";
  const { isProcessing, activeTask } = useApp();

  const workflowStages = [
    { id: "intake", label: "Intake" },
    { id: "execution", label: "Execution" },
    { id: "approval", label: "Approval" },
    { id: "ledger", label: "Ledger" },
  ] as const;

  type WorkflowStage = (typeof workflowStages)[number]["id"];

  const currentStage: WorkflowStage = (() => {
    if (activeTask?.status === "awaiting-approval") return "approval";
    if (isProcessing) return "execution";
    if (activeTask?.status === "completed") return "ledger";
    return "intake";
  })();

  return (
    <div className="aw-page">
      <section
        className={`aw-entry-bridge ${isLandingEntry ? "aw-enter-reveal" : ""}`}
        data-entry={isLandingEntry ? "landing" : "direct"}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="aw-kicker">Dashboard</p>
            <h2 className="mt-1 text-[1.3rem] font-semibold leading-tight text-[var(--aw-text)] md:text-[1.55rem]">
              Run tasks from one place
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--aw-text-soft)]">
              Start with a prompt. Research, approvals, and ledger updates stay
              connected.
            </p>
          </div>
          <span className="rounded-full border border-[var(--aw-border-strong)] bg-[var(--aw-primary-soft)] px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.09em] text-[var(--aw-primary-strong)]">
            Financial OS
          </span>
        </div>
      </section>

      {isLandingEntry && (
        <section
          className="aw-surface mb-5 p-4 md:p-5 aw-enter-reveal-fast"
          style={{ animationDelay: "120ms" }}
        >
          <p className="aw-kicker">Payment setup</p>
          <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
            Set up Stripe
          </h3>
          <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
            Connect Stripe to fund your wallet and manage payments.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link href="/wallet" className="aw-button-primary px-3 py-1.5 text-xs">
              Set up Stripe
            </Link>
            <Link href="/tools" className="aw-button-secondary px-3 py-1.5 text-xs">
              Open Tools
            </Link>
          </div>
        </section>
      )}

      <div
        className={`aw-page-header ${isLandingEntry ? "aw-enter-reveal" : ""}`}
        style={isLandingEntry ? { animationDelay: "80ms" } : undefined}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="aw-kicker">Dashboard</p>
            <h1 className="aw-page-title">Tasks</h1>
            <p className="aw-page-subtitle">
              Describe what you want done. Agent Wallet runs the flow.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {workflowStages.map((stage) => (
              <span
                key={stage.id}
                className={`rounded-full border px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.08em] ${
                  currentStage === stage.id
                    ? "border-[var(--aw-border-strong)] bg-[var(--aw-primary-soft)] text-[var(--aw-primary-strong)]"
                    : "border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] text-[var(--aw-text-muted)]"
                }`}
              >
                {stage.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] ${isLandingEntry ? "aw-enter-reveal" : ""}`}
        style={isLandingEntry ? { animationDelay: "150ms" } : undefined}
      >
        <div
          className={`space-y-6 ${isLandingEntry ? "aw-enter-reveal-fast" : ""}`}
          style={isLandingEntry ? { animationDelay: "210ms" } : undefined}
        >
          <section className="aw-surface-elevated aw-command-zone flex min-h-[34rem] flex-col overflow-hidden xl:min-h-[40rem]">
            <div className="border-b border-[var(--aw-border)] px-5 py-4 md:px-6">
              <p className="aw-kicker">Task Console</p>
              <h2 className="mt-1 text-[1.25rem] font-semibold tracking-[-0.015em] text-[var(--aw-text)]">
                Run a task
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--aw-text-soft)]">
                Keep prompts clear and short. The app handles research, policy
                checks, and approvals.
              </p>
            </div>
            <div className="min-h-0 flex-1">
              <ChatInterface />
            </div>
          </section>

          <section className="aw-operator-zone">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="aw-kicker">Recommendations</p>
                <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                  Review findings, compare options, and prepare approvals.
                </p>
              </div>
            </div>
            <ProcurementPlanningPanel />
          </section>
        </div>

        <aside
          className={`space-y-6 ${isLandingEntry ? "aw-enter-reveal-fast" : ""}`}
          style={isLandingEntry ? { animationDelay: "260ms" } : undefined}
        >
          <section className="aw-operator-zone">
            <div className="mb-3">
              <p className="aw-kicker">Task Rail</p>
              <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                See each step as tasks run on the live web.
              </p>
            </div>
            <AgentRail demoMode={isDemoMode} />
          </section>

          <section className="aw-operator-zone">
            <div className="mb-3">
              <p className="aw-kicker">Approvals and Ledger</p>
              <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                Approvals, guardrails, and recent wallet changes.
              </p>
            </div>
            <OpsDeck demoMode={isDemoMode} />
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function OperatorPage() {
  return (
    <Suspense>
      <OperatorContent />
    </Suspense>
  );
}
