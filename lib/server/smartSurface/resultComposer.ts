import "server-only";

import type {
  SmartSurfaceContext,
  SmartSurfaceIntent,
  SmartSurfaceResult,
} from "@/lib/server/smartSurface/types";

function fmtMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function composeSmartSurfaceResult(input: {
  intent: SmartSurfaceIntent;
  context: SmartSurfaceContext;
}): SmartSurfaceResult {
  const { intent, context } = input;
  const dataReason = context.dataState.lowDataReason || "Using current synced financial context.";
  const money = context.moneyIntelligence;

  if (intent === "lower_bills") {
    return {
      title: "Lower bills plan",
      sourceState: context.statements.hasRecentData ? "Inferred" : "Manual",
      summary: context.recurring.count > 0
        ? `You have ${context.recurring.count} recurring merchants totaling about ${fmtMoney(context.recurring.monthlyTotal)}/month.`
        : "No recurring merchants detected yet. Start by syncing account transactions.",
      whyThisResult: context.statements.hasRecentData
        ? `You asked to lower bills. Agent Wallet found ${context.recurring.count} recurring patterns from synced statements.`
        : `You asked to lower bills. ${dataReason}`,
      canDoNow: "Confirm recurring items, ignore false positives, or mark inactive merchants in Statements.",
      checklist: [
        "Open recurring spend and sort by monthly cost",
        "Confirm recurring vs ignored merchants",
        "Prioritize top monthly savings opportunities first",
      ],
      actions: [
        { label: "Open recurring spend", href: "/statements?panel=recurring" },
        { label: "Review Found Money", href: "/home#found-money" },
      ],
    };
  }

  if (intent === "review_unusual_spend") {
    return {
      title: "Unusual spending review",
      sourceState: context.statements.hasRecentData ? "Inferred" : "Manual",
      summary: context.statements.anomalousChargeCount > 0
        ? `${context.statements.anomalousChargeCount} unusual charge${context.statements.anomalousChargeCount === 1 ? "" : "s"} flagged for review.`
        : "No unusual charges are currently flagged.",
      whyThisResult: context.statements.hasRecentData
        ? "You asked to review unusual spend. Agent Wallet is highlighting anomaly signals from synced statement activity."
        : `You asked to review unusual spend. ${dataReason}`,
      canDoNow: "Filter to anomalies in Statements and classify or dismiss each flagged merchant.",
      checklist: [
        "Inspect flagged transactions",
        "Confirm merchant/category mappings",
        "Dismiss false positives to improve future signal quality",
      ],
      actions: [
        { label: "Open anomalies panel", href: "/statements?panel=anomalies" },
        { label: "Open all transactions", href: "/statements" },
      ],
    };
  }

  if (intent === "plan_cash_30d") {
    const projectedDelta = money.monthlySurvivalForecast.projectedEndBalance30d - context.wallet.balance;
    const forecast = money.monthlySurvivalForecast;
    return {
      title: "30-day cash plan",
      sourceState: context.recurring.count > 0 ? "Inferred" : "Synced",
      summary: projectedDelta >= 0
        ? `Projected 30-day delta is positive: ${fmtMoney(projectedDelta)}.`
        : `Projected 30-day delta is negative: ${fmtMoney(projectedDelta)}.`,
      whyThisResult: context.recurring.count > 0
        ? "You asked for a cash plan. Agent Wallet used deterministic bill prediction, spending burn-rate, and income cadence signals."
        : `You asked for a cash plan. Recurring signals are limited right now. ${dataReason}`,
      canDoNow: "Open funding setup, then review recurring obligations and upcoming bill timeline to improve projection confidence.",
      checklist: [
        "Check 7-day obligations and funding readiness",
        "Review recurring spend impact on cash runway",
        `Forecast status: ${forecast.status}`,
      ],
      actions: [
        { label: "Go to wallet funding", href: "/wallet?open_payment_setup=1" },
        { label: "Review recurring bills", href: "/statements?panel=recurring" },
      ],
    };
  }

  if (intent === "check_connection_health") {
    return {
      title: "Connection health review",
      sourceState: context.connectionHealth.hasAnyConnectedSource ? "Synced" : "Manual",
      summary: context.connectionHealth.hasAnyConnectedSource
        ? `${context.connectionHealth.staleAccountCount} account connection${context.connectionHealth.staleAccountCount === 1 ? "" : "s"} need attention.`
        : "No connected sources yet. Add accounts to activate insights.",
      whyThisResult: "You asked to check source health. Agent Wallet is showing reconnect risk and sync readiness.",
      canDoNow: "Reconnect stale accounts, remove inactive sources, and rerun Home insights after sync.",
      checklist: [
        "Reconnect stale account connections",
        "Remove inactive sources from active logic",
        "Re-sync and recheck Home insights",
      ],
      actions: [
        { label: "Open connect center", href: "/connect#health" },
        { label: "Manage connected accounts", href: "/connect" },
      ],
    };
  }

  if (intent === "query_spending") {
    return {
      title: "Spending breakdown",
      sourceState: context.statements.hasRecentData ? "Inferred" : "Manual",
      summary: context.statements.hasRecentData
        ? `Analyzing ${context.statements.transactionCount} transactions; true spend is ${fmtMoney(money.statement.trueSpendAmount)} after exclusions.`
        : "Connect account data to see your spending breakdown.",
      whyThisResult: context.statements.hasRecentData
        ? "You asked about spending. Agent Wallet is using deterministic statement aggregation that excludes transfers, refunds, reversals, card payments, and duplicates."
        : `You asked about spending. ${dataReason}`,
      canDoNow: "Open Statements to drill into categories, merchants, and time periods.",
      checklist: [
        "Review top spending categories",
        "Check merchant-level spend for anomalies",
        "Compare this period to the previous one",
      ],
      actions: [
        { label: "Open category view", href: "/statements?panel=categories" },
        { label: "Open merchant view", href: "/statements?panel=merchants" },
      ],
    };
  }

  if (intent === "query_health") {
    const advanced = money.advancedIntelligence;
    return {
      title: "Financial health check",
      sourceState: context.statements.hasRecentData ? "Inferred" : "Manual",
      summary: context.statements.hasRecentData
        ? `Tracked net worth is ${fmtMoney(money.netWorth.trackedNetWorth)} with a ${money.monthlySurvivalForecast.status} 30-day survival forecast, ${advanced.financialRiskScoring.riskBand} risk band, and ${advanced.financialStressDetection.status} stress status.`
        : "Connect account data to compute your financial health score.",
      whyThisResult: context.statements.hasRecentData
        ? "You asked about financial health. Agent Wallet evaluated net worth trend, bill load, projected spending runway, transparent risk scoring, and rule-based stress detection."
        : `You asked about financial health. ${dataReason}`,
      canDoNow: "Review recurring costs, fund your wallet, and address stale connections.",
      checklist: [
        `Check recurring monthly obligations (${context.recurring.count} tracked)`,
        `Review cash position and 30-day projection (${money.monthlySurvivalForecast.status})`,
        `Risk band / stress: ${advanced.financialRiskScoring.riskBand} / ${advanced.financialStressDetection.status}`,
        "Reconnect any stale account connections",
      ],
      actions: [
        { label: "View recurring bills", href: "/statements?panel=recurring" },
        { label: "Check connections", href: "/connect#health" },
      ],
    };
  }

  if (intent === "affordability_check") {
    const affordability = money.affordability;
    const untilIncome = affordability.safeToSpendUntilNextIncome;
    return {
      title: "Affordability check",
      sourceState: context.statements.hasRecentData ? "Inferred" : "Manual",
      summary: untilIncome === null
        ? `Safe to spend today is ${fmtMoney(affordability.safeToSpendToday)}, and this week ${fmtMoney(affordability.safeToSpendThisWeek)}.`
        : `Safe to spend today is ${fmtMoney(affordability.safeToSpendToday)} and until next income ${fmtMoney(untilIncome)}.`,
      whyThisResult: context.statements.hasRecentData
        ? "You asked if you can afford something. Agent Wallet used deterministic affordability logic from projected bills and spending burn."
        : `You asked about affordability. ${dataReason}`,
      canDoNow: "Review your balance, upcoming bills, and compare purchase amount to safe-to-spend windows.",
      checklist: [
        `Safe today: ${fmtMoney(affordability.safeToSpendToday)}`,
        `Safe this week: ${fmtMoney(affordability.safeToSpendThisWeek)}`,
        `Safe this month: ${fmtMoney(affordability.safeToSpendThisMonth)}`,
      ],
      actions: [
        { label: "Go to wallet", href: "/wallet" },
        { label: "Review upcoming bills", href: "/statements?panel=recurring" },
      ],
    };
  }

  return {
    title: "Agent Wallet overview",
    sourceState: context.statements.hasRecentData ? "Inferred" : "Manual",
    summary: context.statements.hasRecentData
      ? `You currently have ${context.statements.transactionCount} active transactions and ${context.recurring.count} recurring merchants tracked.`
      : "Connect account data to unlock deeper financial recommendations.",
    whyThisResult: context.statements.hasRecentData
      ? "Agent Wallet generated an overview because your request did not map to a single decision workflow."
      : `Agent Wallet generated a setup-first overview. ${dataReason}`,
    canDoNow: "Choose one workflow: lower bills, review unusual spending, plan 30-day cash, or check connection health.",
    checklist: [
      "Choose a focused financial outcome",
      "Use Home cards to drill into opportunities and risk",
      "Check trust labels before acting on recommendations",
    ],
    actions: [
      { label: "Back to Home", href: "/home" },
      { label: "Open Statements", href: "/statements" },
    ],
  };
}
