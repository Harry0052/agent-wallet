"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Command,
  Eye,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { AgentLogData, EvidenceData } from "@/lib/types";
import { cn, domainFromUrl, fmt } from "@/lib/utils";
import { ChatInterface } from "@/components/ChatInterface";
import { WalletCard } from "@/components/WalletCard";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TransactionHistory } from "@/components/TransactionHistory";
import { AgentRail } from "@/components/AgentRail";
import { OpsDeck } from "@/components/OpsDeck";
import { StateSheet } from "@/components/StateSheet";
import { ProcurementPlanningPanel } from "@/components/ProcurementPlanningPanel";
import { SubscriptionOpsPanel } from "@/components/SubscriptionOpsPanel";

type WorkspaceTab = "command" | "live" | "controls";
type WorkflowStage = "intake" | "execution" | "approval" | "ledger";

function getSystemStatusLabel(
  isProcessing: boolean,
  status: string | undefined,
): string {
  if (status === "awaiting-approval") return "Awaiting Approval";
  if (isProcessing) return "Live Execution";
  if (status === "completed") return "Task Complete";
  if (status === "cancelled") return "Task Cancelled";
  return "System Ready";
}

function getSystemStatusState(
  isProcessing: boolean,
  status: string | undefined,
): "live" | "ok" | "alert" {
  if (status === "cancelled") return "alert";
  if (status === "awaiting-approval" || isProcessing) return "live";
  return "ok";
}

function getWorkflowStage(
  isProcessing: boolean,
  status: string | undefined,
): WorkflowStage {
  if (status === "awaiting-approval") return "approval";
  if (isProcessing) return "execution";
  if (status === "completed") return "ledger";
  return "intake";
}

function isUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 8) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function pullRecommendationUrls(raw: Record<string, unknown> | null): string[] {
  if (!raw) return [];

  const urls: string[] = [];
  const winner = asRecord(raw.winner);
  const purchasePrep = asRecord(raw.purchasePrep);

  if (isUrl(purchasePrep?.checkoutUrl)) urls.push(purchasePrep.checkoutUrl);
  if (Array.isArray(purchasePrep?.proofUrls)) {
    for (const proof of purchasePrep.proofUrls) {
      if (isUrl(proof)) urls.push(proof);
    }
  }

  if (isUrl(winner?.pricingPageUrl)) urls.push(winner.pricingPageUrl);

  if (Array.isArray(raw.evidenceLinks)) {
    for (const link of raw.evidenceLinks) {
      if (isUrl(link)) urls.push(link);
    }
  }

  return urls;
}

function collectLiveUrls(params: {
  activeTaskSteps: Array<{ url?: string }>;
  messages: Array<{ type: string; data?: unknown }>;
  recommendation: Record<string, unknown> | null;
}): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const push = (candidate: unknown) => {
    if (!isUrl(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    urls.push(candidate);
  };

  for (let i = params.activeTaskSteps.length - 1; i >= 0; i -= 1) {
    push(params.activeTaskSteps[i].url);
  }

  for (let i = params.messages.length - 1; i >= 0; i -= 1) {
    const msg = params.messages[i];
    if (msg.type === "evidence" && msg.data) {
      const data = msg.data as EvidenceData;
      if (Array.isArray(data.findings)) {
        for (const finding of data.findings) {
          push(finding.sourceUrl);
        }
      }
      continue;
    }

    if (msg.type === "agent-log" && msg.data) {
      const data = msg.data as AgentLogData;
      if (Array.isArray(data.steps)) {
        for (const step of data.steps) {
          push(step.url);
        }
      }
    }
  }

  for (const recommendationUrl of pullRecommendationUrls(
    params.recommendation,
  )) {
    push(recommendationUrl);
  }

  return urls;
}

function TinyFishLiveAccessCard(props: {
  liveUrls: string[];
  isProcessing: boolean;
  onFocusRail: () => void;
}) {
  const [isInlineOpen, setIsInlineOpen] = useState(false);
  const [isOperatorViewOpen, setIsOperatorViewOpen] = useState(false);
  const primaryUrl = props.liveUrls[0] || null;
  const primaryDomain = domainFromUrl(primaryUrl || undefined);
  const isLive = props.isProcessing && Boolean(primaryUrl);

  useEffect(() => {
    if (!primaryUrl) {
      setIsInlineOpen(false);
      setIsOperatorViewOpen(false);
    }
  }, [primaryUrl]);

  useEffect(() => {
    if (!isOperatorViewOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOperatorViewOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOperatorViewOpen]);

  const openLiveSession = () => {
    if (!primaryUrl) return;
    window.open(primaryUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <section className="aw-surface-elevated p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="aw-kicker">Live Execution</p>
            <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
              Live Agent Session
            </h3>
            <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
              A real-time operator window showing where the agent is working on
              the live web.
            </p>
          </div>
          <span className="aw-status-chip" data-state={isLive ? "live" : "ok"}>
            {isLive ? "Session Live" : "Session Standby"}
          </span>
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--aw-border-strong)] bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={isLive ? "aw-dot-live" : "aw-dot-idle"} />
              <p className="text-[11px] uppercase tracking-[0.09em] text-[var(--aw-text-muted)]">
                Web Operator View
              </p>
            </div>
            <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-soft)]">
              {isLive ? "Actively Navigating" : "Waiting For Target"}
            </p>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.09em] text-[var(--aw-text-muted)]">
              Current Target
            </p>
            <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
              {primaryDomain ||
                "Run a task to reveal the active site and browsing session."}
            </p>
            {primaryUrl && (
              <p className="mt-1 truncate text-[11px] text-[var(--aw-primary)]">
                {primaryUrl}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={openLiveSession}
            disabled={!primaryUrl}
            className="aw-button-primary inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
          >
            Launch Live Session
            <ArrowUpRight size={13} />
          </button>

          <button
            type="button"
            onClick={() => setIsOperatorViewOpen(true)}
            disabled={!primaryUrl}
            className="aw-button-secondary inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs"
          >
            <Eye size={13} />
            Open Operator View
          </button>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setIsInlineOpen((prev) => !prev)}
            disabled={!primaryUrl}
            className="aw-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isInlineOpen ? "Hide Inline Session" : "Show Inline Session"}
          </button>
          <button
            type="button"
            onClick={props.onFocusRail}
            className="aw-button-ghost px-3 py-2 text-xs"
          >
            Focus Execution Rail
          </button>
        </div>

        {isInlineOpen && primaryUrl && (
          <div className="animate-sheet-rise mt-3 overflow-hidden rounded-2xl border border-[var(--aw-border-strong)] bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                Inline Live Session
              </p>
              <button
                onClick={openLiveSession}
                className="aw-button-secondary px-2.5 py-1 text-[10px]"
              >
                Open In New Tab
              </button>
            </div>
            <div className="h-[18rem] bg-[var(--aw-surface-subtle)] md:h-[21rem]">
              <iframe
                src={primaryUrl}
                title="Live Inline Session"
                className="h-full w-full border-0"
                loading="lazy"
              />
            </div>
            <p className="border-t border-[var(--aw-border)] px-3 py-2 text-[10px] text-[var(--aw-text-muted)]">
              If embedding is blocked by the target site, use Launch Live
              Session for full browser view.
            </p>
          </div>
        )}

        {props.liveUrls.length > 1 && (
          <div className="mt-3 border-t border-[var(--aw-border)] pt-2.5">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
              Recent Live Links
            </p>
            <div className="mt-1.5 space-y-1">
              {props.liveUrls.slice(0, 3).map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="aw-link block truncate text-xs"
                >
                  {url}
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      {isOperatorViewOpen && primaryUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.24)] p-3 backdrop-blur-[2px] md:p-6">
          <section className="aw-surface-elevated animate-sheet-rise flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--aw-border)] px-4 py-3 md:px-5">
              <div>
                <p className="aw-kicker">Live Execution</p>
                <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Web Operator View
                </h3>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  {primaryDomain || primaryUrl}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="aw-status-chip"
                  data-state={isLive ? "live" : "ok"}
                >
                  {isLive ? "Live Session" : "Session Preview"}
                </span>
                <button
                  onClick={openLiveSession}
                  className="aw-button-secondary px-3 py-1.5 text-xs"
                >
                  Open In New Tab
                </button>
                <button
                  onClick={() => setIsOperatorViewOpen(false)}
                  className="aw-button-secondary px-3 py-1.5 text-xs"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-[var(--aw-surface-subtle)]">
              <iframe
                src={primaryUrl}
                title="Live Operator View"
                className="h-full w-full border-0"
                loading="lazy"
              />
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function AppShell() {
  const {
    wallet,
    activeTask,
    isProcessing,
    messages,
    latestProcurementTask,
    showSettings,
    showHistory,
    toggleSettings,
    toggleHistory,
  } = useApp();

  const [isDemoMode, setIsDemoMode] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("command");

  const systemLabel = getSystemStatusLabel(isProcessing, activeTask?.status);
  const systemState = getSystemStatusState(isProcessing, activeTask?.status);
  const workflowStage = getWorkflowStage(isProcessing, activeTask?.status);

  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setIsDemoMode(params.get("demo") === "1");

      const surface = params.get("surface");
      if (
        surface === "command" ||
        surface === "live" ||
        surface === "controls"
      ) {
        setWorkspaceTab(surface);
      }
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);

    return () => {
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, []);

  const toggleDemoMode = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") {
      params.delete("demo");
    } else {
      params.set("demo", "1");
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery
      ? `${window.location.pathname}?${nextQuery}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
    setIsDemoMode((prev) => !prev);
  };

  const setWorkspaceSurface = (tab: WorkspaceTab) => {
    const params = new URLSearchParams(window.location.search);
    params.set("surface", tab);
    const nextQuery = params.toString();
    const nextUrl = nextQuery
      ? `${window.location.pathname}?${nextQuery}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
    setWorkspaceTab(tab);
  };

  const liveUrls = useMemo(
    () =>
      collectLiveUrls({
        activeTaskSteps: activeTask?.steps || [],
        messages,
        recommendation: asRecord(latestProcurementTask?.recommendation),
      }),
    [activeTask?.steps, latestProcurementTask?.recommendation, messages],
  );

  const navTabs: Array<{ id: WorkspaceTab; label: string; icon: JSX.Element }> =
    [
      { id: "command", label: "Command", icon: <Command size={12} /> },
      { id: "live", label: "Live Execution", icon: <Sparkles size={12} /> },
      {
        id: "controls",
        label: "Controls",
        icon: <SlidersHorizontal size={12} />,
      },
    ];

  const workspaceDescriptor = useMemo(() => {
    if (workspaceTab === "command") {
      return isProcessing
        ? "Active run in progress. Monitor transitions and intervene only when needed."
        : "Queue tasks in natural language and run them through the operator workflow.";
    }

    if (workspaceTab === "live") {
      return "Observe real browser automation in the live session and execution rail.";
    }

    return showSettings || showHistory
      ? "Policy and ledger surfaces are open for review."
      : "Review wallet controls, approvals, and financial guardrails.";
  }, [workspaceTab, isProcessing, showSettings, showHistory]);

  const workflowStages: Array<{ id: WorkflowStage; label: string }> = [
    { id: "intake", label: "Intake" },
    { id: "execution", label: "Execution" },
    { id: "approval", label: "Approval" },
    { id: "ledger", label: "Ledger" },
  ];

  const commandStack = (
    <>
      <div
        className={cn(
          "aw-surface-elevated flex min-h-[30rem] flex-col overflow-hidden",
          isDemoMode ? "xl:min-h-[40rem]" : "xl:min-h-[34rem]",
        )}
      >
        <div className="border-b border-[var(--aw-border)] px-4 py-3 md:px-5 md:py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="aw-kicker">Task Console</p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--aw-text)]">
                Define Task Outcome
              </h2>
              <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                Every request moves through one workflow: intake, execution,
                approvals, and ledger-safe completion.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {workflowStages.map((stage) => (
                  <span
                    key={stage.id}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.08em]",
                      workflowStage === stage.id
                        ? "border-[var(--aw-primary)] bg-[var(--aw-primary-soft)] text-[var(--aw-primary)]"
                        : "border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] text-[var(--aw-text-muted)]",
                    )}
                  >
                    {stage.label}
                  </span>
                ))}
              </div>
            </div>
            <span
              className="aw-status-chip"
              data-state={isProcessing ? "live" : "ok"}
            >
              {isProcessing ? "In Progress" : "Ready"}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <ChatInterface />
        </div>
      </div>

      <ProcurementPlanningPanel />
      <SubscriptionOpsPanel />
      <OpsDeck demoMode={isDemoMode} />
    </>
  );

  const liveStack = (
    <>
      <TinyFishLiveAccessCard
        liveUrls={liveUrls}
        isProcessing={isProcessing}
        onFocusRail={() => setWorkspaceSurface("live")}
      />
      <AgentRail demoMode={isDemoMode} />
    </>
  );

  const controlsStack = (
    <>
      <WalletCard />
      {!isDemoMode && <SettingsPanel />}
      {!isDemoMode && <TransactionHistory />}
    </>
  );

  return (
    <div className="aw-shell min-h-screen flex flex-col">
      <header className="shrink-0 px-3 pt-3 md:px-6 md:pt-6">
        <div className="aw-surface-elevated px-4 py-4 md:px-6 md:py-5">
          <div className="flex flex-wrap items-center justify-between gap-4 md:gap-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(0,0,255,0.28)] bg-[linear-gradient(145deg,rgba(0,0,255,0.2),rgba(0,0,255,0.08))] shadow-[0_12px_28px_rgba(0,0,255,0.18)]">
                <span className="text-lg font-semibold tracking-[0.04em] text-white">
                  AW
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[1.24rem] font-semibold leading-none tracking-[0.02em] text-[var(--aw-text)]">
                  Agent Wallet
                </p>
                <p className="aw-kicker mt-1">Operator Workspace</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="aw-status-chip" data-state={systemState}>
                <Activity size={12} className="opacity-80" />
                {systemLabel}
              </span>
              <span className="aw-status-chip">
                <ShieldCheck size={12} className="opacity-80" />
                Ledger Truth: Stripe + DB
              </span>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--aw-border)] bg-white px-3 py-1.5 text-sm text-[var(--aw-text-soft)]">
                <WalletCards size={14} className="text-[var(--aw-primary)]" />
                <span className="aw-kicker !text-[0.6rem] !tracking-[0.12em]">
                  Balance
                </span>
                <span className="font-semibold text-[var(--aw-text)]">
                  {fmt(wallet.balance)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--aw-border)] pt-3">
            <div>
              <p className="aw-kicker mb-1">Workspace</p>
              <nav className="inline-flex items-center gap-1 rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-1">
                {navTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setWorkspaceSurface(tab.id)}
                    className="aw-nav-tab inline-flex items-center gap-1.5"
                    data-active={workspaceTab === tab.id}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </nav>
              <p className="mt-1.5 text-xs text-[var(--aw-text-soft)]">
                {workspaceDescriptor}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSettings}
                className="aw-button-secondary px-3 py-1.5 text-xs"
              >
                Policy Controls {showSettings ? "Open" : "Closed"}
              </button>
              <button
                type="button"
                onClick={toggleHistory}
                className="aw-button-secondary px-3 py-1.5 text-xs"
              >
                Ledger View {showHistory ? "Open" : "Closed"}
              </button>
              <button
                type="button"
                onClick={toggleDemoMode}
                className="aw-button-ghost px-3 py-1.5 text-xs"
              >
                {isDemoMode ? "Exit Demo Mode" : "Demo Mode"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-3 pb-4 pt-3 md:px-6 md:pb-6 md:pt-4">
        <div className="xl:hidden">
          <section
            className={cn(
              "space-y-4",
              workspaceTab === "command" ? "block" : "hidden",
            )}
          >
            {commandStack}
          </section>
          <section
            className={cn(
              "space-y-4",
              workspaceTab === "live" ? "block" : "hidden",
            )}
          >
            {liveStack}
          </section>
          <section
            className={cn(
              "space-y-4",
              workspaceTab === "controls" ? "block" : "hidden",
            )}
          >
            {controlsStack}
          </section>
        </div>

        <div className="hidden h-full xl:grid xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:gap-4">
          <section className="min-h-0 space-y-4">{commandStack}</section>

          <aside className="min-h-0 space-y-4">
            {liveStack}
            <WalletCard />
            <div className="aw-scroll max-h-[44rem] overflow-y-auto space-y-4 pr-1">
              {!isDemoMode && <SettingsPanel />}
              {!isDemoMode && <TransactionHistory />}
            </div>
          </aside>
        </div>
      </main>

      <StateSheet />
    </div>
  );
}
