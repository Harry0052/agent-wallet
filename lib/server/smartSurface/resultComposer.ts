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

  if (intent === "lower_bills") {
    return {
      title: "Lower bills plan",
      sourceState: context.statements.hasRecentData ? "Inferred" : "Manual",
      summary: context.recurring.count > 0
        ? `You have ${context.recurring.count} recurring merchants totaling about ${fmtMoney(context.recurring.monthlyTotal)}/month.`
        : "No recurring merchants detected yet. Start by syncing account transactions.",
      whyThisResult: context.statements.hasRecentData
        ? `You asked to lower bills. Calico found ${context.recurring.count} recurring patterns from synced statements.`
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
        ? "You asked to review unusual spend. Calico is highlighting anomaly signals from synced statement activity."
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
    const projectedDelta = context.wallet.balance - context.recurring.monthlyTotal;
    return {
      title: "30-day cash plan",
      sourceState: context.recurring.count > 0 ? "Inferred" : "Synced",
      summary: projectedDelta >= 0
        ? `Projected 30-day delta is positive: ${fmtMoney(projectedDelta)}.`
        : `Projected 30-day delta is negative: ${fmtMoney(projectedDelta)}.`,
      whyThisResult: context.recurring.count > 0
        ? "You asked for a cash plan. Calico used wallet balance and recurring obligations to project 30-day risk."
        : `You asked for a cash plan. Recurring signals are limited right now. ${dataReason}`,
      canDoNow: "Open funding setup, then review recurring obligations to improve the projection baseline.",
      checklist: [
        "Check 7-day obligations and funding readiness",
        "Review recurring spend impact on cash runway",
        "Adjust guardrails if projected cash risk is elevated",
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
      whyThisResult: "You asked to check source health. Calico is showing reconnect risk and sync readiness.",
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
        ? `Analyzing ${context.statements.transactionCount} transactions across your connected accounts.`
        : "Connect account data to see your spending breakdown.",
      whyThisResult: context.statements.hasRecentData
        ? "You asked about spending. Calico is summarizing transaction patterns from synced data."
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
    return {
      title: "Financial health check",
      sourceState: context.statements.hasRecentData ? "Inferred" : "Manual",
      summary: context.statements.hasRecentData
        ? `Your financial picture includes ${context.recurring.count} recurring obligations and ${fmtMoney(context.wallet.balance)} available.`
        : "Connect account data to compute your financial health score.",
      whyThisResult: context.statements.hasRecentData
        ? "You asked about financial health. Calico evaluated recurring burden, spending patterns, and cash position."
        : `You asked about financial health. ${dataReason}`,
      canDoNow: "Review recurring costs, fund your wallet, and address stale connections.",
      checklist: [
        "Check recurring monthly obligations",
        "Review cash position and 30-day projection",
        "Reconnect any stale account connections",
      ],
      actions: [
        { label: "View recurring bills", href: "/statements?panel=recurring" },
        { label: "Check connections", href: "/connect#health" },
      ],
    };
  }

  if (intent === "affordability_check") {
    const projectedDelta = context.wallet.balance - context.recurring.monthlyTotal;
    return {
      title: "Affordability check",
      sourceState: context.recurring.count > 0 ? "Inferred" : "Synced",
      summary: projectedDelta >= 0
        ? `After upcoming obligations, you have approximately ${fmtMoney(projectedDelta)} available.`
        : `Your upcoming obligations exceed available cash by ${fmtMoney(Math.abs(projectedDelta))}.`,
      whyThisResult: context.recurring.count > 0
        ? "You asked if you can afford something. Calico subtracted upcoming recurring costs from your current balance."
        : `You asked about affordability. ${dataReason}`,
      canDoNow: "Review your balance, upcoming bills, and consider funding your wallet if needed.",
      checklist: [
        "Verify current wallet balance",
        "Review upcoming 7-day obligations",
        "Fund wallet if purchase exceeds safe-to-spend",
      ],
      actions: [
        { label: "Go to wallet", href: "/wallet" },
        { label: "Review upcoming bills", href: "/statements?panel=recurring" },
      ],
    };
  }

  return {
    title: "Calico overview",
    sourceState: context.statements.hasRecentData ? "Inferred" : "Manual",
    summary: context.statements.hasRecentData
      ? `You currently have ${context.statements.transactionCount} active transactions and ${context.recurring.count} recurring merchants tracked.`
      : "Connect account data to unlock deeper financial recommendations.",
    whyThisResult: context.statements.hasRecentData
      ? "Calico generated an overview because your request did not map to a single decision workflow."
      : `Calico generated a setup-first overview. ${dataReason}`,
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
