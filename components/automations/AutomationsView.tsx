"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  DollarSign,
  Lock,
  PiggyBank,
  RefreshCw,
  Shield,
  Zap,
} from "lucide-react";
import { WorkspaceHeader } from "@/components/finance/WorkspacePrimitives";
import { useEntitlements } from "@/lib/useEntitlements";

interface AutomationCard {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  status: "available" | "active" | "completed";
  category: "savings" | "bills" | "subscriptions" | "debt";
}

const AUTOMATIONS: AutomationCard[] = [
  {
    id: "auto-emergency-fund",
    title: "Auto-fund emergency savings",
    description: "Calico moves a set amount to your emergency fund every payday.",
    icon: <Shield size={20} />,
    status: "available",
    category: "savings",
  },
  {
    id: "auto-goal-funding",
    title: "Auto-fund your goals",
    description: "Calico splits extra money across your goals based on priority.",
    icon: <PiggyBank size={20} />,
    status: "available",
    category: "savings",
  },
  {
    id: "bill-monitor",
    title: "Bill increase alerts",
    description: "Calico watches for bills that go up and lets you know right away.",
    icon: <DollarSign size={20} />,
    status: "active",
    category: "bills",
  },
  {
    id: "bill-negotiate",
    title: "Bill negotiation help",
    description: "Calico helps you negotiate lower rates on your biggest bills.",
    icon: <Zap size={20} />,
    status: "available",
    category: "bills",
  },
  {
    id: "sub-review",
    title: "Subscription review",
    description: "Calico finds subscriptions you might not need and helps you cancel them.",
    icon: <RefreshCw size={20} />,
    status: "available",
    category: "subscriptions",
  },
  {
    id: "debt-optimizer",
    title: "Smart debt payoff",
    description: "Calico figures out the best order to pay off what you owe to save the most on interest.",
    icon: <Bot size={20} />,
    status: "available",
    category: "debt",
  },
];

const STATUS_CONFIG = {
  available: { label: "Set up", color: "text-[var(--calico-primary,#FDBA74)]", bg: "bg-orange-50" },
  active: { label: "Running", color: "text-green-600", bg: "bg-green-50" },
  completed: { label: "Done", color: "text-blue-600", bg: "bg-blue-50" },
};

export function AutomationsView() {
  const { loading, can } = useEntitlements();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--calico-primary,#FDBA74)] border-t-transparent" />
      </div>
    );
  }

  const isAutonomous = can("ai_automation");

  return (
    <div className="flex h-full min-h-screen flex-col gap-8 bg-[var(--aw-surface-subtle)] p-6">
      <WorkspaceHeader
        title="Automations"
        subtitle={isAutonomous ? "Set up automated workflows. Review active items in the Action Center." : "Let Calico handle the money busywork for you."}
        actions={isAutonomous ? (
          <Link
            href="/tasks"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--calico-primary,#FDBA74)] px-4 py-2 text-sm font-semibold text-[var(--aw-text)] shadow-sm transition hover:opacity-90"
          >
            Open Action Center
            <ArrowRight size={16} />
          </Link>
        ) : null}
      />

      {!isAutonomous && (
        <div className="rounded-2xl border border-[var(--aw-border)] bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
            <Lock size={24} className="text-[var(--calico-primary,#FDBA74)]" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--aw-text)]">
            Unlock Automations
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--aw-text-muted)]">
            Automation review lives in Task Center on the Fully Autonomous plan. This preview shows the kinds of workflows Calico can support safely.
          </p>
          <Link
            href="/settings?section=billing"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--calico-primary,#FDBA74)] px-6 py-3 text-sm font-semibold text-[var(--aw-text)] shadow-md hover:opacity-90 transition"
          >
            View Plans & Billing
            <ArrowRight size={16} />
          </Link>

          {/* Show blurred preview */}
          <div className="mt-8 pointer-events-none select-none" style={{ filter: "blur(3px)", opacity: 0.4 }}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {AUTOMATIONS.slice(0, 4).map((auto) => (
                <div key={auto.id} className="rounded-xl border border-[var(--aw-border)] bg-white p-4 text-left">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-[var(--calico-primary,#FDBA74)]">
                      {auto.icon}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--aw-text)]">{auto.title}</p>
                      <p className="text-xs text-[var(--aw-text-muted)]">{auto.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isAutonomous && (
        <>
          <div className="rounded-2xl border border-[var(--aw-border)] bg-white p-6">
            <p className="text-sm font-semibold text-[var(--aw-text)]">Review-first automations</p>
            <p className="mt-2 max-w-2xl text-sm text-[var(--aw-text-muted)]">
              In this build, Calico stages automation-capable workflows for review instead of silently running them. Use Task Center to inspect any live actions before you approve them.
            </p>
          </div>

          {/* Active automations */}
          {AUTOMATIONS.filter((a) => a.status === "active").length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
                Running now
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {AUTOMATIONS.filter((a) => a.status === "active").map((auto) => {
                  const config = STATUS_CONFIG[auto.status];
                  return (
                    <div key={auto.id} className="rounded-xl border border-green-200 bg-white p-5 hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 text-green-600">
                          {auto.icon}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-[var(--aw-text)]">{auto.title}</h4>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${config.bg} ${config.color}`}>
                              <CheckCircle2 size={10} />
                              {config.label}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--aw-text-muted)]">{auto.description}</p>
                          <p className="mt-3 text-xs font-medium text-[var(--aw-text-muted)]">
                            Managed through Task Center
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Available automations */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--aw-text-muted)]">
              Available to set up
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {AUTOMATIONS.filter((a) => a.status === "available").map((auto) => (
                <div key={auto.id} className="rounded-xl border border-[var(--aw-border)] bg-white p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-[var(--calico-primary,#FDBA74)]">
                      {auto.icon}
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-[var(--aw-text)]">{auto.title}</h4>
                      <p className="mt-1 text-xs text-[var(--aw-text-muted)]">{auto.description}</p>
                      <p className="mt-3 text-xs font-medium text-[var(--aw-text-muted)]">
                        Preview only in this build
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div className="rounded-2xl border border-[var(--aw-border)] bg-white p-6">
            <h3 className="text-lg font-semibold text-[var(--aw-text)]">How automations work</h3>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-50 text-sm font-bold text-[var(--calico-primary,#FDBA74)]">1</div>
                <div>
                  <p className="text-sm font-medium text-[var(--aw-text)]">Choose an action</p>
                  <p className="mt-1 text-xs text-[var(--aw-text-muted)]">Pick what you want Calico to handle.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-50 text-sm font-bold text-[var(--calico-primary,#FDBA74)]">2</div>
                <div>
                  <p className="text-sm font-medium text-[var(--aw-text)]">Set your rules</p>
                  <p className="mt-1 text-xs text-[var(--aw-text-muted)]">Tell Calico how much, how often, and your limits.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-50 text-sm font-bold text-[var(--calico-primary,#FDBA74)]">3</div>
                <div>
                  <p className="text-sm font-medium text-[var(--aw-text)]">Calico stages the action</p>
                  <p className="mt-1 text-xs text-[var(--aw-text-muted)]">Calico prepares the workflow and checks in with you when approval is required.</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
