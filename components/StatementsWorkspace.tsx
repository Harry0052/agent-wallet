"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import { StatementsInlineSkeleton, StatementsRecurringSkeleton, InlineSpinner } from "@/components/skeleton";
import { SourceStateBadge } from "@/components/SourceStateBadge";
import { fmt, fmtDate } from "@/lib/utils";
import { emitSmartTelemetry } from "@/services/smartWallet";
import {
  addManualRecurring,
  fetchAccountStatement,
  fetchAiSpendingAnalysis,
  fetchConnectedAccounts,
  fetchSuspectedSubscriptions,
  fetchUnifiedStatement,
  setRecurringLifecycle,
  type AccountStatement,
  type AiSpendingAnalysisResponse,
  type ConnectedAccount,
  type DetectedSubscription,
  type StatementFilters,
  type StatementTransaction,
  type UnifiedStatement,
} from "@/services/statements";

interface AccountFilters {
  date_from: string;
  date_to: string;
  merchant: string;
  category: string;
  pending: "" | "true" | "false";
  page: number;
  page_size: number;
}

function defaultAccountFilters(): AccountFilters {
  return {
    date_from: "",
    date_to: "",
    merchant: "",
    category: "",
    pending: "",
    page: 1,
    page_size: 30,
  };
}

function toQueryFilters(filters: AccountFilters): StatementFilters {
  return {
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
    merchant: filters.merchant || undefined,
    category: filters.category || undefined,
    pending: filters.pending || undefined,
    page: filters.page,
    page_size: filters.page_size,
  };
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function accountLabel(account: ConnectedAccount): string {
  const nickname = account.nickname.trim();
  if (nickname) return nickname;
  return `${account.institution_name} ••••${account.mask}`;
}

function lifecycleLabel(value: DetectedSubscription["lifecycle_status"]): string {
  if (value === "detected") return "Detected";
  if (value === "confirmed") return "Confirmed";
  if (value === "ignored") return "Ignored";
  if (value === "inactive") return "Inactive";
  return "Manual";
}

function intervalSummary(item: DetectedSubscription): string {
  const avg = item.explanation.average_interval_days;
  if (avg && avg > 0) {
    return `~${Math.round(avg)} day cycle`;
  }
  return titleCase(item.recurrence_interval);
}

function txKey(value: string): string {
  return value.trim().toLowerCase();
}

function merchantOrNormalized(tx: StatementTransaction): string {
  return tx.normalized_merchant?.trim() || tx.merchant_name.trim();
}

function homeCardLabel(cardId: string): string {
  if (cardId === "found_money") return "Found Money";
  if (cardId === "unusual_spending") return "Unusual Spending";
  if (cardId === "recurring_bills") return "Recurring Subscriptions & Bills";
  if (cardId === "budget_risk") return "Budget / Cash Risk";
  if (cardId === "connection_health") return "Connection Health";
  return "Home";
}

function homeCardAnchor(cardId: string): string {
  if (cardId === "found_money") return "/home#found-money";
  if (cardId === "unusual_spending") return "/home#unusual-spending";
  if (cardId === "recurring_bills") return "/home#recurring-bills";
  if (cardId === "budget_risk") return "/home#budget-risk";
  if (cardId === "connection_health") return "/home#connection-health";
  return "/home";
}

function panelActionGuidance(panel: string): string {
  if (panel === "recurring") {
    return "Confirm recurring merchants, ignore false positives, then return to Home for refreshed recurring and found-money cards.";
  }
  if (panel === "anomalies") {
    return "Inspect flagged merchants, apply filters, and clear noise so unusual-spend insights stay trustworthy.";
  }
  if (panel === "merchants") {
    return "Choose high-impact merchants and filter transactions to identify practical cost controls.";
  }
  if (panel === "categories") {
    return "Use category filters to find spend concentration and decide which category needs guardrails next.";
  }
  return "Review statement activity and apply filters to produce cleaner recurring and risk recommendations.";
}

function recurringActionPlan(lifecycle: DetectedSubscription["lifecycle_status"]): Array<{
  status: "confirmed" | "ignored" | "inactive";
  label: string;
  recommended: boolean;
}> {
  if (lifecycle === "confirmed") {
    return [
      { status: "inactive", label: "Mark inactive", recommended: true },
      { status: "ignored", label: "Ignore merchant", recommended: false },
      { status: "confirmed", label: "Confirmed", recommended: false },
    ];
  }
  if (lifecycle === "ignored") {
    return [
      { status: "confirmed", label: "Confirm recurring", recommended: true },
      { status: "inactive", label: "Mark inactive", recommended: false },
      { status: "ignored", label: "Ignored", recommended: false },
    ];
  }
  if (lifecycle === "inactive") {
    return [
      { status: "confirmed", label: "Re-activate recurring", recommended: true },
      { status: "ignored", label: "Ignore merchant", recommended: false },
      { status: "inactive", label: "Inactive", recommended: false },
    ];
  }
  return [
    { status: "confirmed", label: "Confirm recurring", recommended: true },
    { status: "ignored", label: "Ignore merchant", recommended: false },
    { status: "inactive", label: "Mark inactive", recommended: false },
  ];
}

function studentCardStatusLabel(status: "good" | "watch" | "risk" | "manual"): string {
  if (status === "good") return "On track";
  if (status === "watch") return "Watch";
  if (status === "risk") return "Needs attention";
  return "Manual-first";
}

export function StatementsWorkspace() {
  const searchParams = useSearchParams();
  const panelParam = searchParams.get("panel") || "";
  const fromParam = searchParams.get("from") || "";
  const homeCardParam = searchParams.get("card") || "";
  const entryParam = searchParams.get("entry") || "";
  const cameFromHome = fromParam === "home";
  const homeReturnHref = useMemo(() => homeCardAnchor(homeCardParam), [homeCardParam]);
  const homeReturnLabel = useMemo(() => homeCardLabel(homeCardParam), [homeCardParam]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unified, setUnified] = useState<UnifiedStatement | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [subscriptions, setSubscriptions] = useState<DetectedSubscription[]>([]);
  const [analysis, setAnalysis] = useState<AiSpendingAnalysisResponse | null>(null);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountStatement, setAccountStatement] = useState<AccountStatement | null>(
    null,
  );
  const [accountFilters, setAccountFilters] = useState<AccountFilters>(
    defaultAccountFilters,
  );
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<"subscriptions" | "statements">(
    "subscriptions",
  );
  const [focusPanel, setFocusPanel] = useState<string>("");

  const [recurringActionBusyKey, setRecurringActionBusyKey] = useState<string | null>(null);
  const [recentlyUpdatedRecurringId, setRecentlyUpdatedRecurringId] = useState<string | null>(null);
  const [recurringActionError, setRecurringActionError] = useState<string | null>(null);
  const [manualMerchant, setManualMerchant] = useState("");
  const [manualMonthlyCost, setManualMonthlyCost] = useState("");
  const [manualInterval, setManualInterval] = useState("monthly");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [recurringActionNotice, setRecurringActionNotice] = useState<string | null>(null);
  const [actionLoopNotice, setActionLoopNotice] = useState<string | null>(null);
  const lowDataTrackedRef = useRef(false);
  const drillInTrackedPanelsRef = useRef<Set<string>>(new Set());

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [unifiedResult, accountsResult, subscriptionsResult, analysisResult] =
        await Promise.all([
          fetchUnifiedStatement(),
          fetchConnectedAccounts(),
          fetchSuspectedSubscriptions(),
          fetchAiSpendingAnalysis(),
        ]);

      setUnified(unifiedResult);
      setAccounts(accountsResult);
      setSubscriptions(subscriptionsResult);
      setAnalysis(analysisResult);

      if (accountsResult.length > 0) {
        setSelectedAccountId((prev) => prev || accountsResult[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load statements.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadAccountStatement = useCallback(
    async (accountId: string, filters: AccountFilters) => {
      setStatementLoading(true);
      setStatementError(null);
      try {
        const result = await fetchAccountStatement({
          accountId,
          filters: toQueryFilters(filters),
        });
        setAccountStatement(result);
      } catch (loadError) {
        setStatementError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load account statement.",
        );
      } finally {
        setStatementLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedAccountId) {
      setAccountStatement(null);
      return;
    }
    void loadAccountStatement(selectedAccountId, accountFilters);
  }, [selectedAccountId, accountFilters, loadAccountStatement]);

  useEffect(() => {
    const panel = panelParam;
    setFocusPanel(panel);
    if (cameFromHome) {
      const via = entryParam ? ` via ${entryParam.replace(/_/g, " ")}` : "";
      setActionLoopNotice(`Opened from Home: ${homeCardLabel(homeCardParam)}${via}. ${panelActionGuidance(panel || "all")}`);
    } else if (!panel) {
      setActionLoopNotice(null);
    }

    if (panel === "recurring") {
      setDetailView("subscriptions");
      return;
    }

    if (panel === "merchants") {
      setDetailView("statements");
      setAccountFilters((prev) => ({ ...prev, merchant: "", page: 1 }));
      return;
    }

    if (panel === "categories") {
      setDetailView("statements");
      setAccountFilters((prev) => ({ ...prev, category: "", page: 1 }));
      return;
    }

    if (panel === "anomalies" || panel === "all") {
      setDetailView("statements");
    }

    if (panel && !drillInTrackedPanelsRef.current.has(panel)) {
      drillInTrackedPanelsRef.current.add(panel);
      void emitSmartTelemetry({
        event: "smart.drill_in_home_to_statements",
        context: {
          panel,
          surface: "statements",
        },
      });
    }
  }, [cameFromHome, entryParam, homeCardParam, panelParam]);

  const recurringActive = useMemo(
    () => subscriptions.filter((item) => item.lifecycle_status !== "ignored" && item.lifecycle_status !== "inactive"),
    [subscriptions],
  );

  const recurringDetectedCount = useMemo(
    () => subscriptions.filter((item) => item.lifecycle_status === "detected").length,
    [subscriptions],
  );

  const potentialSavings = useMemo(() => {
    const fromAi =
      analysis?.analysis.subscription_advice.unused_subscriptions.reduce(
        (sum, item) => sum + item.monthly_cost,
        0,
      ) || 0;
    if (fromAi > 0) return fromAi;
    return recurringActive.reduce(
      (sum, item) => sum + item.estimated_monthly_cost,
      0,
    );
  }, [analysis, recurringActive]);

  const recurringTotal = useMemo(
    () => recurringActive.reduce((sum, item) => sum + item.estimated_monthly_cost, 0),
    [recurringActive],
  );
  const statementMoneyIntel = unified?.money_intelligence || null;
  const statementAutomation = unified?.automation?.summary || null;
  const statementAlerts = statementMoneyIntel?.alerts.slice(0, 2) || [];
  const studentCards = statementMoneyIntel?.studentFocus.cards || [];

  const aiInsightHeadline = useMemo(() => {
    if (recurringActive.length === 0) {
      return "No confirmed recurring spend yet. Keep syncing or manually track known subscriptions.";
    }
    return `Tracking ${recurringActive.length} recurring items totaling ${fmt(recurringTotal)}/month.`;
  }, [recurringActive, recurringTotal]);

  const aiRecommendation = useMemo(() => {
    const best = analysis?.analysis.subscription_advice.cancellation_suggestions[0];
    if (!best) return null;
    return `${best.subscription}: ${best.recommendation} (${best.reason})`;
  }, [analysis]);

  const merchantBreakdown = useMemo(
    () => analysis?.analysis.spending.top_merchants || [],
    [analysis],
  );

  const categoryBreakdown = useMemo(
    () => analysis?.analysis.spending.category_summary || [],
    [analysis],
  );

  const anomalyBreakdown = useMemo(
    () => analysis?.analysis.anomalies.unusual_charges || [],
    [analysis],
  );

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) || null,
    [accounts, selectedAccountId],
  );

  const recurringMerchantKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of recurringActive) {
      keys.add(txKey(item.merchant));
    }
    return keys;
  }, [recurringActive]);

  const anomalyMerchantKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of anomalyBreakdown) {
      keys.add(txKey(item.merchant));
    }
    return keys;
  }, [anomalyBreakdown]);

  const analysisTransactionCount = analysis?.transaction_summary.transaction_count || 0;
  const hasAnalysisData = analysisTransactionCount > 0;
  const lowDataMode = useMemo(() => {
    if (accounts.length === 0) return "no_connected_accounts" as const;
    if (analysisTransactionCount === 0) return "awaiting_sync" as const;
    if (analysisTransactionCount < 25) return "thin_history" as const;
    return "none" as const;
  }, [accounts.length, analysisTransactionCount]);
  const lowDataGuidance = useMemo(() => {
    if (lowDataMode === "no_connected_accounts") {
      return {
        title: "Connect an account to activate Statements intelligence",
        detail: "Statements can still accept manual recurring entries, but merchant/category/anomaly analysis needs synced account history.",
        actions: [
          { label: "Step 1: Open Connections", href: "/connect" },
          { label: "Step 2: Verify sync health", href: "/connect#health" },
          { label: "Step 3: Review recurring", href: "/statements?panel=recurring" },
        ],
      };
    }
    if (lowDataMode === "awaiting_sync") {
      return {
        title: "Accounts are connected. Finish first sync to unlock analysis.",
        detail: "Once posted transactions arrive, Agent Wallet can generate recurring and unusual-spend signals.",
        actions: [
          { label: "Step 1: Check account health", href: "/connect#health" },
          { label: "Step 2: Retry sync", href: "/connect#accounts" },
          { label: "Step 3: Open recurring panel", href: "/statements?panel=recurring" },
        ],
      };
    }
    if (lowDataMode === "thin_history") {
      return {
        title: "Low-data mode: build confidence with targeted review",
        detail: "You have early data. Confirm recurring merchants and inspect unusual spend to improve Home projections.",
        actions: [
          { label: "Step 1: Confirm recurring", href: "/statements?panel=recurring" },
          { label: "Step 2: Review anomalies", href: "/statements?panel=anomalies" },
          { label: "Step 3: Return to Home", href: "/home" },
        ],
      };
    }
    return null;
  }, [lowDataMode]);
  useEffect(() => {
    if (lowDataMode === "none" || lowDataTrackedRef.current) return;
    lowDataTrackedRef.current = true;
    void emitSmartTelemetry({
      event: "smart.low_data_exposed",
      context: {
        surface: "statements",
        reason: lowDataMode,
      },
    });
  }, [lowDataMode]);

  const onAccountFilterChange = <K extends keyof AccountFilters>(
    key: K,
    value: AccountFilters[K],
  ) => {
    setAccountFilters((prev) => ({
      ...prev,
      [key]: value,
      page: key === "page" ? value as number : 1,
    }));
  };

  const applyMerchantFilter = (merchant: string) => {
    setDetailView("statements");
    setAccountFilters((prev) => ({ ...prev, merchant, page: 1 }));
    setActionLoopNotice(`Merchant filter applied: ${merchant}. Review matching transactions, then return to Home to refresh insight relevance.`);
  };

  const applyCategoryFilter = (category: string) => {
    setDetailView("statements");
    setAccountFilters((prev) => ({ ...prev, category, page: 1 }));
    setActionLoopNotice(`Category filter applied: ${titleCase(category)}. Review concentration and then revisit Home budget/cash risk insights.`);
  };

  const explainTransaction = (tx: StatementTransaction): { summary: string; sourceState: "Synced" | "Inferred" } => {
    if (tx.pending) {
      return {
        summary: "Pending transaction. Final posted amount can change.",
        sourceState: "Synced",
      };
    }

    const merchantKey = txKey(merchantOrNormalized(tx));
    if (anomalyMerchantKeys.has(merchantKey)) {
      return {
        summary: "Flagged in unusual spending signals for review.",
        sourceState: "Inferred",
      };
    }

    if (recurringMerchantKeys.has(merchantKey)) {
      return {
        summary: "Matches a tracked recurring merchant pattern.",
        sourceState: "Inferred",
      };
    }

    if (!tx.category || tx.category.trim().toLowerCase() === "uncategorized") {
      return {
        summary: "Needs category confirmation for cleaner cash-flow forecasting.",
        sourceState: "Inferred",
      };
    }

    return {
      summary: "Posted synced transaction included in statement analysis.",
      sourceState: "Synced",
    };
  };

  const handleRecurringStatus = async (
    subscriptionId: string,
    status: "confirmed" | "ignored" | "inactive",
  ) => {
    setRecurringActionBusyKey(`${subscriptionId}:${status}`);
    setRecurringActionError(null);
    setRecurringActionNotice(null);
    setRecentlyUpdatedRecurringId(null);
    try {
      const next = await setRecurringLifecycle({ subscriptionId, status });
      setSubscriptions(next);
      const refreshed = await fetchSuspectedSubscriptions();
      setSubscriptions(refreshed);
      setRecentlyUpdatedRecurringId(subscriptionId);
      setRecurringActionNotice(`Recurring item updated: ${titleCase(status)}. Return to Home to refresh insight cards.`);
      void emitSmartTelemetry({
        event: "statements.recurring_action",
        context: {
          action: status,
          outcome: "success",
          subscriptionId,
        },
      });
    } catch (actionError) {
      setRecurringActionError(
        actionError instanceof Error
          ? actionError.message
          : "Failed to update recurring item status.",
      );
      void emitSmartTelemetry({
        event: "statements.recurring_action",
        context: {
          action: status,
          outcome: "failure",
          subscriptionId,
        },
      });
    } finally {
      setRecurringActionBusyKey(null);
    }
  };

  const onManualSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setManualError(null);
    setRecurringActionNotice(null);

    const merchant = manualMerchant.trim();
    const estimatedMonthlyCost = Number(manualMonthlyCost);

    if (!merchant) {
      setManualError("Merchant is required.");
      return;
    }
    if (!Number.isFinite(estimatedMonthlyCost) || estimatedMonthlyCost <= 0) {
      setManualError("Monthly cost must be greater than 0.");
      return;
    }

    setManualBusy(true);
    try {
      const next = await addManualRecurring({
        merchant,
        estimatedMonthlyCost,
        recurrenceInterval: manualInterval,
      });
      setSubscriptions(next);
      const refreshed = await fetchSuspectedSubscriptions();
      setSubscriptions(refreshed);
      setRecurringActionNotice(`Recurring item tracked: ${merchant}. Return to Home to refresh recurring and cash-risk insights.`);
      void emitSmartTelemetry({
        event: "statements.recurring_action",
        context: {
          action: "manual_add",
          outcome: "success",
          merchant,
        },
      });
      setManualMerchant("");
      setManualMonthlyCost("");
      setManualInterval("monthly");
    } catch (submitError) {
      setManualError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to add manual recurring item.",
      );
      void emitSmartTelemetry({
        event: "statements.recurring_action",
        context: {
          action: "manual_add",
          outcome: "failure",
          merchant,
        },
      });
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <div className="aw-page">
      <div className="aw-page-header">
        <p className="aw-page-kicker">Statements</p>
        <h1 className="aw-page-title">Statements</h1>
        <p className="aw-page-subtitle">
          Truth layer for recurring patterns, merchant/category analysis, unusual spending, and transaction-level explanations.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--aw-danger)]/30 bg-[var(--aw-danger)]/10 px-3 py-2 text-sm text-[var(--aw-danger)]">
          {error}
        </div>
      ) : null}

      <section className="aw-surface p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="aw-kicker">Unified Spend Summary</p>
          <SourceStateBadge state="Synced" />
        </div>
        {isLoading ? (
          <div className="mt-3">
            <StatementsInlineSkeleton />
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
                <p className="text-xs text-[var(--aw-text-muted)]">Total Monthly Spend</p>
                <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                  {fmt(unified?.total_spend_month || 0)}
                </p>
              </article>
              <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
                <p className="text-xs text-[var(--aw-text-muted)]">Tracked Recurring Items</p>
                <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                  {subscriptions.length}
                </p>
                <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                  {recurringDetectedCount} awaiting confirmation
                </p>
              </article>
              <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
                <p className="text-xs text-[var(--aw-text-muted)]">Potential Savings</p>
                <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                  {fmt(potentialSavings)}
                </p>
                <div className="mt-2">
                  <SourceStateBadge state={hasAnalysisData ? "Inferred" : "Manual"} />
                </div>
              </article>
            </div>
            {statementMoneyIntel ? (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                <article className="rounded-xl border border-[var(--aw-border)] bg-white p-3">
                  <p className="text-xs text-[var(--aw-text-muted)]">Safe to spend today</p>
                  <p className="aw-number mt-1 text-lg font-semibold text-[var(--aw-text)]">
                    {fmt(statementMoneyIntel.affordability.safeToSpendToday)}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                    Confidence {Math.round(statementMoneyIntel.affordability.confidence * 100)}%
                  </p>
                </article>
                <article className="rounded-xl border border-[var(--aw-border)] bg-white p-3">
                  <p className="text-xs text-[var(--aw-text-muted)]">Safe this week</p>
                  <p className="aw-number mt-1 text-lg font-semibold text-[var(--aw-text)]">
                    {fmt(statementMoneyIntel.affordability.safeToSpendThisWeek)}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                    Predicted: {fmt(statementMoneyIntel.weeklyPrediction.predictedSpendNext7d)}
                  </p>
                </article>
                <article className="rounded-xl border border-[var(--aw-border)] bg-white p-3">
                  <p className="text-xs text-[var(--aw-text-muted)]">Safe this month</p>
                  <p className="aw-number mt-1 text-lg font-semibold text-[var(--aw-text)]">
                    {fmt(statementMoneyIntel.affordability.safeToSpendThisMonth)}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                    Forecast: {statementMoneyIntel.monthlySurvivalForecast.status}
                  </p>
                </article>
                <article className="rounded-xl border border-[var(--aw-border)] bg-white p-3">
                  <p className="text-xs text-[var(--aw-text-muted)]">Until next income</p>
                  <p className="aw-number mt-1 text-lg font-semibold text-[var(--aw-text)]">
                    {statementMoneyIntel.affordability.safeToSpendUntilNextIncome === null
                      ? "Unavailable"
                      : fmt(statementMoneyIntel.affordability.safeToSpendUntilNextIncome)}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                    {statementMoneyIntel.affordability.incomeCadenceReliable ? "Reliable cadence" : "Cadence unreliable"}
                  </p>
                </article>
              </div>
            ) : null}
            {studentCards.length > 0 ? (
              <div className="mt-3 rounded-xl border border-[var(--aw-border)] bg-white p-3">
                <p className="text-xs font-semibold text-[var(--aw-text)]">Student Focus Cards</p>
                <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                  Friendly, paycheck-safe guidance for school-life spending.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {studentCards.map((card) => (
                    <article key={card.id} className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[var(--aw-text)]">{card.title}</p>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                          {studentCardStatusLabel(card.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--aw-text-soft)]">{card.summary}</p>
                      <p className="aw-number mt-1.5 text-sm font-semibold text-[var(--aw-text)]">
                        {card.amount === null ? "Unavailable" : fmt(card.amount)}
                      </p>
                      <p className="text-[10px] text-[var(--aw-text-muted)]">
                        {card.amountLabel} · {Math.round(card.confidence * 100)}% confidence
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
            {statementAlerts.length > 0 ? (
              <div className="mt-3 rounded-xl border border-[var(--aw-warning)]/30 bg-[var(--aw-warning)]/8 px-3 py-2.5">
                {statementAlerts.map((alert) => (
                  <p key={alert.id} className="text-xs text-[var(--aw-text-soft)]">
                    <span className="font-semibold text-[var(--aw-text)]">{alert.title}:</span> {alert.summary}
                  </p>
                ))}
              </div>
            ) : null}
            {statementAutomation ? (
              <div className="mt-3 rounded-xl border border-[var(--aw-border)] bg-white px-3 py-2.5">
                <p className="text-xs font-semibold text-[var(--aw-text)]">Automation Task Center</p>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  {statementAutomation.pendingConfirmCount} pending confirm · {statementAutomation.activeCount} active · {statementAutomation.completed7dCount} completed in 7 days.
                </p>
                <Link href="/tasks" className="mt-2 inline-flex text-xs font-semibold text-[var(--aw-primary-strong)] hover:underline">
                  Open Task Center
                </Link>
              </div>
            ) : null}
          </>
        )}
      </section>

      {lowDataGuidance ? (
        <section className="mt-5 aw-surface p-4 md:p-5">
          <p className="aw-kicker">Low-Data Guidance</p>
          <p className="mt-1 text-sm font-semibold text-[var(--aw-text)]">{lowDataGuidance.title}</p>
          <p className="mt-1 text-sm text-[var(--aw-text-soft)]">{lowDataGuidance.detail}</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {lowDataGuidance.actions.map((action, index) => (
              <Link
                key={action.href + action.label}
                href={action.href}
                className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5 transition hover:border-[var(--aw-border-strong)]"
              >
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Step {index + 1}</p>
                <p className="mt-0.5 text-xs font-semibold text-[var(--aw-text)]">{action.label}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-5 aw-surface p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="aw-kicker">Recurring Intelligence</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
              Subscriptions + Bills with explainable status
            </h2>
          </div>
          <SourceStateBadge state={detailView === "subscriptions" ? "Inferred" : "Synced"} />
          <div className="inline-flex rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-1">
            <button
              type="button"
              onClick={() => setDetailView("subscriptions")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                detailView === "subscriptions"
                  ? "bg-[var(--aw-primary-soft)] text-[var(--aw-primary-strong)]"
                  : "text-[var(--aw-text-soft)] hover:text-[var(--aw-text)]"
              }`}
            >
              Recurring
            </button>
            <button
              type="button"
              onClick={() => setDetailView("statements")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                detailView === "statements"
                  ? "bg-[var(--aw-primary-soft)] text-[var(--aw-primary-strong)]"
                  : "text-[var(--aw-text-soft)] hover:text-[var(--aw-text)]"
              }`}
            >
              Statements
            </button>
          </div>
        </div>

        {focusPanel ? (
          <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
            Focus view: <span className="font-semibold text-[var(--aw-text-soft)]">{titleCase(focusPanel)}</span>
          </p>
        ) : null}
        {actionLoopNotice ? (
          <div className="mt-2 rounded-lg border border-[var(--aw-border)] bg-white px-3 py-2 text-xs text-[var(--aw-text-soft)]">
            {actionLoopNotice}
          </div>
        ) : null}
        {cameFromHome ? (
          <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2 text-xs text-[var(--aw-text-soft)]">
            <span>Loop closure:</span>
            <Link href={homeReturnHref} className="font-semibold text-[var(--aw-primary-strong)] hover:underline">
              Return to Home → {homeReturnLabel}
            </Link>
          </div>
        ) : null}
        {focusPanel === "recurring" ? (
          <p className="mt-2 rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2 text-xs text-[var(--aw-text-soft)]">
            Next step: confirm recurring merchants you want in forecasts, ignore false positives, and mark inactive charges to keep Home recommendations clean.
          </p>
        ) : null}

        <div className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
          <div className="flex items-start gap-2">
            <Sparkles size={15} className="mt-0.5 text-[var(--aw-primary-strong)]" />
            <div>
              <p className="text-sm text-[var(--aw-text)]">{aiInsightHeadline}</p>
              {aiRecommendation ? (
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  Recommendation: {aiRecommendation}
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  No recommendation generated yet. Keep syncing posted transactions for higher-confidence recurring decisions.
                </p>
              )}
            </div>
          </div>
        </div>

        {detailView === "subscriptions" ? (
          isLoading ? (
            <StatementsRecurringSkeleton />
          ) : (
            <div className="mt-3 space-y-3">
              <form
                className="grid grid-cols-1 gap-2 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3 md:grid-cols-[1.2fr_0.7fr_0.8fr_auto]"
                onSubmit={(event) => { void onManualSubmit(event); }}
              >
                <input
                  type="text"
                  className="aw-input h-10 text-sm"
                  value={manualMerchant}
                  placeholder="Add recurring merchant manually"
                  onChange={(event) => setManualMerchant(event.target.value)}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="aw-input h-10 text-sm"
                  value={manualMonthlyCost}
                  placeholder="Monthly cost"
                  onChange={(event) => setManualMonthlyCost(event.target.value)}
                />
                <select
                  className="aw-input h-10 text-sm"
                  value={manualInterval}
                  onChange={(event) => setManualInterval(event.target.value)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
                <button
                  type="submit"
                  className="aw-button-secondary h-10 px-3 text-xs"
                  disabled={manualBusy}
                >
                  {manualBusy ? "Saving..." : "Track manually"}
                </button>
                {manualError ? (
                  <p className="text-xs text-[var(--aw-danger)] md:col-span-4">{manualError}</p>
                ) : null}
              </form>

              {recurringActionError ? (
                <p className="inline-flex items-center gap-2 rounded-lg border border-[var(--aw-danger)]/30 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
                  <AlertCircle size={12} />
                  {recurringActionError}
                </p>
              ) : null}
              {recurringActionNotice ? (
                <p className="inline-flex items-center gap-2 rounded-lg border border-[var(--aw-success)]/30 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
                  <CheckCircle2 size={12} />
                  {recurringActionNotice}
                  <Link href={homeReturnHref} className="font-semibold underline">
                    Return to Home
                  </Link>
                </p>
              ) : null}

              <div className="aw-scroll max-h-[24rem] overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {subscriptions.map((subscription) => {
                    const actionPlan = recurringActionPlan(subscription.lifecycle_status);
                    const isBusy = Boolean(
                      recurringActionBusyKey && recurringActionBusyKey.startsWith(`${subscription.id}:`),
                    );
                    return (
                      <article
                        key={subscription.id}
                        className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-[var(--aw-text)]">
                            {subscription.merchant}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <SourceStateBadge state={subscription.source_state} />
                            <span className="rounded-full border border-[var(--aw-border)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                              {lifecycleLabel(subscription.lifecycle_status)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-[var(--aw-text)]">
                            {fmt(subscription.estimated_monthly_cost)}
                            <span className="ml-1 text-xs font-normal text-[var(--aw-text-soft)]">
                              /month
                            </span>
                          </p>
                          <p className="text-xs text-[var(--aw-text-soft)]">
                            {intervalSummary(subscription)}
                          </p>
                        </div>
                        <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                          Confidence {Math.round(subscription.confidence * 100)}% · Last seen {fmtDate(subscription.last_seen)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                          Why recurring: {subscription.explanation.summary}
                        </p>
                        {subscription.explanation.transaction_count > 0 ? (
                          <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                            {subscription.explanation.transaction_count} matched transactions ·
                            {" "}
                            {subscription.explanation.first_seen ? `first ${fmtDate(subscription.explanation.first_seen)}` : "first unknown"}
                            {" "}·
                            {" "}
                            {subscription.explanation.last_seen ? `latest ${fmtDate(subscription.explanation.last_seen)}` : "latest unknown"}
                          </p>
                        ) : null}
                        {recentlyUpdatedRecurringId === subscription.id ? (
                          <p className="mt-1 text-[11px] text-[var(--aw-success)]">
                            Status saved successfully.
                          </p>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          {actionPlan.map((action) => {
                            const isCurrent = subscription.lifecycle_status === action.status;
                            const actionBusy = recurringActionBusyKey === `${subscription.id}:${action.status}`;
                            return (
                              <button
                                key={action.status}
                                type="button"
                                className={`h-8 px-3 text-xs ${
                                  action.recommended ? "aw-button-primary" : "aw-button-secondary"
                                }`}
                                disabled={isBusy || isCurrent}
                                onClick={() => {
                                  void handleRecurringStatus(subscription.id, action.status);
                                }}
                              >
                                {actionBusy ? "Saving..." : action.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                          Recommended next action: {actionPlan.find((action) => action.recommended)?.label}.
                        </p>
                        <div className="mt-2">
                          <Link href={homeReturnHref} className="text-[11px] font-semibold text-[var(--aw-primary-strong)] hover:underline">
                            Refresh Home insight cards
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                  {subscriptions.length === 0 ? (
                    <p className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-5 text-sm text-[var(--aw-text-muted)] md:col-span-2">
                      No recurring items yet. Connect accounts or manually track a recurring bill to start forecasting.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="mt-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {accounts.map((account) => {
                const isActive = selectedAccountId === account.id;
                return (
                  <button
                    type="button"
                    key={account.id}
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setAccountFilters((prev) => ({ ...prev, page: 1 }));
                    }}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      isActive
                        ? "border-[var(--aw-primary-strong)] bg-[var(--aw-primary-soft)]"
                        : "border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] hover:border-[var(--aw-border-strong)]"
                    }`}
                  >
                    <p className="truncate text-sm font-semibold text-[var(--aw-text)]">
                      {accountLabel(account)}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
                      {titleCase(account.account_type)} • {account.institution_name}
                    </p>
                  </button>
                );
              })}
              {accounts.length === 0 ? (
                <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3 md:col-span-3">
                  <p className="text-sm text-[var(--aw-text-muted)]">No linked accounts found yet.</p>
                  <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                    Connect an account in Connections, then return here to unlock merchant/category/anomaly drill-ins.
                  </p>
                  <Link href="/connect" className="aw-button-secondary mt-2 inline-flex h-8 items-center px-3 text-xs">
                    Open Connections
                  </Link>
                </div>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5">
              <input
                type="date"
                className="aw-input h-10 text-sm"
                value={accountFilters.date_from}
                onChange={(event) => onAccountFilterChange("date_from", event.target.value)}
              />
              <input
                type="date"
                className="aw-input h-10 text-sm"
                value={accountFilters.date_to}
                onChange={(event) => onAccountFilterChange("date_to", event.target.value)}
              />
              <input
                type="text"
                className="aw-input h-10 text-sm"
                value={accountFilters.merchant}
                placeholder="Merchant"
                onChange={(event) => onAccountFilterChange("merchant", event.target.value)}
              />
              <input
                type="text"
                className="aw-input h-10 text-sm"
                value={accountFilters.category}
                placeholder="Category"
                onChange={(event) => onAccountFilterChange("category", event.target.value)}
              />
              <select
                className="aw-input h-10 text-sm"
                value={accountFilters.pending}
                onChange={(event) =>
                  onAccountFilterChange("pending", event.target.value as AccountFilters["pending"])
                }
              >
                <option value="">All statuses</option>
                <option value="false">Posted</option>
                <option value="true">Pending</option>
              </select>
            </div>

            {lowDataMode !== "none" ? (
              <div className="mt-3 rounded-xl border border-[var(--aw-warning)]/35 bg-[var(--aw-warning)]/10 px-3 py-2 text-xs text-[var(--aw-text-soft)]">
                Low-data mode: Agent Wallet can show synced statements, but merchant/category/anomaly intelligence is limited until account coverage and posted history improve.
              </div>
            ) : null}

            {(focusPanel === "merchants" || focusPanel === "" || focusPanel === "all") ? (
              <div className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Merchant View</p>
                    <p className="mt-1 text-xs text-[var(--aw-text-soft)]">Tap a merchant to filter transactions instantly.</p>
                  </div>
                  <SourceStateBadge state={hasAnalysisData ? "Inferred" : "Manual"} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {merchantBreakdown.slice(0, 8).map((merchant) => (
                    <button
                      key={merchant.merchant_group}
                      type="button"
                      className="aw-button-ghost px-3 py-1.5 text-xs"
                      onClick={() => applyMerchantFilter(merchant.merchant_group)}
                    >
                      {merchant.merchant_group} · {fmt(merchant.total_spend)}
                    </button>
                  ))}
                  {merchantBreakdown.length === 0 ? (
                    <p className="text-xs text-[var(--aw-text-muted)]">No merchant breakdown available yet.</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {(focusPanel === "categories" || focusPanel === "" || focusPanel === "all") ? (
              <div className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Category View</p>
                    <p className="mt-1 text-xs text-[var(--aw-text-soft)]">Tap a category to inspect spend concentration.</p>
                  </div>
                  <SourceStateBadge state={hasAnalysisData ? "Inferred" : "Manual"} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {categoryBreakdown.slice(0, 8).map((category) => (
                    <button
                      key={category.category}
                      type="button"
                      className="aw-button-ghost px-3 py-1.5 text-xs"
                      onClick={() => applyCategoryFilter(category.category)}
                    >
                      {titleCase(category.category)} · {fmt(category.total_spend)}
                    </button>
                  ))}
                  {categoryBreakdown.length === 0 ? (
                    <p className="text-xs text-[var(--aw-text-muted)]">No category breakdown available yet.</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {(focusPanel === "anomalies" || focusPanel === "" || focusPanel === "all") ? (
              <div className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Unusual Spending</p>
                    <p className="mt-1 text-xs text-[var(--aw-text-soft)]">Review flagged merchants and drill into matching transactions.</p>
                  </div>
                  <SourceStateBadge state={hasAnalysisData ? "Inferred" : "Manual"} />
                </div>
                <div className="mt-2 space-y-2">
                  {anomalyBreakdown.slice(0, 6).map((anomaly) => (
                    <div key={`${anomaly.merchant}-${anomaly.occurred_at}`} className="rounded-lg border border-[var(--aw-border)] bg-white px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-[var(--aw-text)]">{anomaly.merchant}</p>
                        <button
                          type="button"
                          className="aw-button-ghost px-2 py-1 text-[11px]"
                          onClick={() => applyMerchantFilter(anomaly.merchant)}
                        >
                          Filter transactions
                        </button>
                      </div>
                      <p className="text-[11px] text-[var(--aw-text-muted)]">
                        {fmt(anomaly.amount)} on {fmtDate(anomaly.occurred_at)} · {anomaly.reason}
                      </p>
                    </div>
                  ))}
                  {anomalyBreakdown.length === 0 ? (
                    <p className="text-xs text-[var(--aw-text-muted)]">No unusual spending signals found in the current window.</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5">
              <p className="text-xs text-[var(--aw-text-muted)]">
                {selectedAccount
                  ? `Viewing ${accountStatement?.account_name || accountLabel(selectedAccount)}`
                  : "Choose an account to view statement transactions."}
              </p>
            </div>

            {statementError ? (
              <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--aw-danger)]/30 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
                <AlertCircle size={12} />
                {statementError}
              </p>
            ) : null}

            {statementLoading ? (
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--aw-text-muted)]">
                <InlineSpinner size={14} />
                Loading transactions...
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-[1.15fr_0.65fr_0.75fr_0.55fr_0.7fr_1.25fr] gap-2 px-2 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                  <span>Merchant</span>
                  <span className="text-right">Amount</span>
                  <span>Date</span>
                  <span>Status</span>
                  <span>Category</span>
                  <span>Why this is shown</span>
                </div>
                <div className="aw-scroll max-h-[19rem] space-y-2 overflow-y-auto pr-1">
                  {(accountStatement?.transactions || []).map((tx) => {
                    const explanation = explainTransaction(tx);
                    return (
                      <article
                        key={tx.id}
                        className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5"
                      >
                        <div className="grid grid-cols-[1.15fr_0.65fr_0.75fr_0.55fr_0.7fr_1.25fr] gap-2 text-sm">
                          <span className="truncate text-[var(--aw-text)]">{tx.merchant_name}</span>
                          <span className="text-right font-semibold text-[var(--aw-text)]">
                            {fmt(Math.abs(tx.amount))}
                          </span>
                          <span className="text-[var(--aw-text-soft)]">{fmtDate(tx.occurred_at)}</span>
                          <span
                            className={`uppercase text-[11px] ${
                              tx.pending ? "text-[var(--aw-warning)]" : "text-[var(--aw-success)]"
                            }`}
                          >
                            {tx.pending ? "pending" : "posted"}
                          </span>
                          <span className="truncate text-[var(--aw-text-soft)]">{titleCase(tx.category)}</span>
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--aw-text-soft)]">
                            {explanation.summary}
                            <SourceStateBadge state={explanation.sourceState} />
                          </span>
                        </div>
                      </article>
                    );
                  })}
                  {(accountStatement?.transactions.length || 0) === 0 ? (
                    <p className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-5 text-center text-sm text-[var(--aw-text-muted)]">
                      No transactions for this account with current filters.
                    </p>
                  ) : null}
                </div>

                {accountStatement?.pagination ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-[var(--aw-text-muted)]">
                      Page {accountStatement.pagination.page} of{" "}
                      {accountStatement.pagination.total_pages} •{" "}
                      {accountStatement.pagination.total} transactions
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="aw-button-secondary h-8 px-3 text-xs"
                        disabled={accountStatement.pagination.page <= 1}
                        onClick={() =>
                          onAccountFilterChange(
                            "page",
                            Math.max(1, accountFilters.page - 1),
                          )
                        }
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className="aw-button-secondary h-8 px-3 text-xs"
                        disabled={!accountStatement.pagination.has_next}
                        onClick={() =>
                          onAccountFilterChange("page", accountFilters.page + 1)
                        }
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-5 aw-surface p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="aw-kicker">Trust + Explainability</p>
          <SourceStateBadge state={hasAnalysisData ? "Inferred" : "Manual"} />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <p className="text-xs text-[var(--aw-text-soft)]">
            <span className="font-semibold text-[var(--aw-text)]">What Agent Wallet knows:</span>{" "}
            Synced transactions, merchant names, categories, posted/pending status, and recurring items you manually confirm.
          </p>
          <p className="text-xs text-[var(--aw-text-soft)]">
            <span className="font-semibold text-[var(--aw-text)]">What Agent Wallet infers:</span>{" "}
            Recurring patterns, unusual spend signals, and potential cancellation opportunities from available transaction history.
          </p>
          <p className="text-xs text-[var(--aw-text-soft)]">
            <span className="font-semibold text-[var(--aw-text)]">What Agent Wallet recommends:</span>{" "}
            Confirm recurring merchants, review anomalies, and prioritize high-impact monthly savings candidates.
          </p>
          <p className="text-xs text-[var(--aw-text-soft)]">
            <span className="font-semibold text-[var(--aw-text)]">What Agent Wallet can do now:</span>{" "}
            Apply statement filters, update recurring lifecycle states, and add manual recurring items for forecasting.
          </p>
        </div>

        {lowDataMode !== "none" ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--aw-warning)]/35 bg-[var(--aw-warning)]/10 px-3 py-2 text-xs text-[var(--aw-text-soft)]">
            <CheckCircle2 size={12} />
            Degraded-data notice: recommendations are conservative until more posted synced data is available.
          </div>
        ) : null}
      </section>
    </div>
  );
}
