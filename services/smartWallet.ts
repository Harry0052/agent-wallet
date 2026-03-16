import type { MoneyIntelligenceResult } from "@/lib/server/moneyIntelligence/types";
import type { AutomationActionSummary } from "@/lib/types";

export type SourceState = "Synced" | "Imported" | "Inferred" | "Manual";

export interface SmartHomeAction {
  label: string;
  href: string;
}

export interface SmartHomeInsightCard {
  id:
    | "found_money"
    | "unusual_spending"
    | "recurring_bills"
    | "budget_risk"
    | "connection_health";
  title: string;
  summary: string;
  whyThisCard: string;
  canDoNow: string;
  sourceState: SourceState;
  lastUpdatedAt: string;
  actions: SmartHomeAction[];
}

export interface SmartHomePayload {
  generatedAt: string;
  summary: {
    netCashPosition: number;
    availableCash: number;
    upcomingBills7d: number;
    outlook30dDelta: number;
    currency: string;
    sourceState: SourceState;
    lastUpdatedAt: string | null;
  };
  freshness: {
    label: string;
    lastSyncedAt: string | null;
    sourceState: SourceState;
  };
  dataQuality: {
    lowData: boolean;
    mode: "none" | "no_connected_accounts" | "awaiting_sync" | "thin_history";
    reason: string | null;
    nextBestActions: Array<{
      label: string;
      href: string;
      description: string;
    }>;
  };
  healthScore?: {
    adjustedOverallScore: number;
    trend: "improving" | "stable" | "declining";
    topRecommendation: string;
  };
  cashFlow?: {
    safeToSpendToday: number;
    safeToSpendThisWeek: number;
    safeToSpendThisMonth: number;
    safeToSpendUntilNextIncome: number | null;
    daysUntilNegative: number | null;
    confidence: number;
  };
  moneyIntelligence?: {
    generatedAt: string;
    engineVersion: string;
    rulesVersion: string;
    statement: Omit<MoneyIntelligenceResult["statement"], "classifiedTransactions">;
    coverage: MoneyIntelligenceResult["coverage"];
    netWorth: MoneyIntelligenceResult["netWorth"];
    spendingLimits: MoneyIntelligenceResult["spendingLimits"];
    affordability: MoneyIntelligenceResult["affordability"];
    weeklyPrediction: MoneyIntelligenceResult["weeklyPrediction"];
    monthlySurvivalForecast: MoneyIntelligenceResult["monthlySurvivalForecast"];
    billPredictions: MoneyIntelligenceResult["billPredictions"];
    subscriptionTimeline: MoneyIntelligenceResult["subscriptionTimeline"];
    alerts: MoneyIntelligenceResult["alerts"];
    categoryLearning: MoneyIntelligenceResult["categoryLearning"];
    studentFocus: MoneyIntelligenceResult["studentFocus"];
    advancedIntelligence: MoneyIntelligenceResult["advancedIntelligence"];
  };
  automation?: {
    summary: AutomationActionSummary;
    policy: {
      defaultMode: "suggest_only" | "user_confirm_required" | "autopilot_allowed";
    };
  };
  quickIntents: string[];
  insightCards: SmartHomeInsightCard[];
  walletStrip: SmartHomeAction[];
  statementsStrip: SmartHomeAction[];
  trust: {
    knows: string;
    infers: string;
    recommends: string;
    canDo: string;
  };
}

export interface SmartSurfaceResult {
  title: string;
  sourceState: SourceState;
  summary: string;
  whyThisResult: string;
  canDoNow: string;
  checklist: string[];
  actions: SmartHomeAction[];
}

export interface SmartTelemetryRecentEvent {
  id: string;
  at: string;
  userId: string;
  event: SmartTelemetryEvent | string;
  context?: Record<string, unknown>;
}

export interface SmartTelemetryRecentResponse {
  purpose: "validation_debug_only";
  authoritative: false;
  note: string;
  events: SmartTelemetryRecentEvent[];
}

export type SmartTelemetryEvent =
  | "home.card_impression"
  | "home.card_click"
  | "surface.quick_intent_used"
  | "surface.prompt_submitted"
  | "statements.recurring_action"
  | "source.removal"
  | "source.reconnect_attempt"
  | "connect.connection_success"
  | "connect.connection_failure"
  | "smart.low_data_exposed"
  | "smart.drill_in_home_to_statements";

function toError(payload: { error?: string; errorCode?: string }): Error {
  if (payload.errorCode && payload.error) return new Error(`${payload.errorCode}: ${payload.error}`);
  return new Error(payload.error || "Request failed");
}

export async function fetchSmartHomePayload(): Promise<SmartHomePayload> {
  const response = await fetch("/api/smart/home", {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    home?: SmartHomePayload;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !payload.ok || !payload.home) {
    throw toError(payload);
  }

  return payload.home;
}

export async function runSmartSurfacePrompt(prompt: string): Promise<SmartSurfaceResult> {
  const response = await fetch("/api/smart/surface", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    result?: SmartSurfaceResult;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !payload.ok || !payload.result) {
    throw toError(payload);
  }

  return payload.result;
}

export async function emitSmartTelemetry(input: {
  event: SmartTelemetryEvent;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    await fetch("/api/smart/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: input.event,
        ...(input.context ? { context: input.context } : {}),
      }),
      keepalive: true,
    });
  } catch {
    // Telemetry should never break product flows.
  }
}

export async function fetchSmartTelemetryRecent(limit = 40): Promise<SmartTelemetryRecentResponse> {
  const response = await fetch(`/api/smart/telemetry/recent?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    purpose?: SmartTelemetryRecentResponse["purpose"];
    authoritative?: SmartTelemetryRecentResponse["authoritative"];
    note?: string;
    events?: SmartTelemetryRecentEvent[];
    error?: string;
    errorCode?: string;
  };

  if (
    !response.ok
    || !payload.ok
    || payload.purpose !== "validation_debug_only"
    || payload.authoritative !== false
    || !Array.isArray(payload.events)
  ) {
    throw toError(payload);
  }

  return {
    purpose: payload.purpose,
    authoritative: payload.authoritative,
    note: payload.note || "Validation debug telemetry events.",
    events: payload.events,
  };
}
