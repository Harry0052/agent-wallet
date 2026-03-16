import type { RecordSourceType } from "@/lib/manualMode";
import { normalizeRecordSourceType } from "@/lib/sourceType";
import type { MoneyIntelligenceResult } from "@/lib/server/moneyIntelligence/types";
import type { AutomationActionSummary } from "@/lib/types";

export interface StatementTransaction {
  id: string;
  user_id: string;
  linked_account_id: string;
  merchant_name: string;
  normalized_merchant: string;
  amount: number;
  currency: string;
  category: string;
  pending: boolean;
  occurred_at: string;
  transaction_type?: "income" | "expense" | "transfer";
  account_name?: string;
  notes?: string;
  recurring?: boolean;
  sourceType?: "connected" | "manual";
}

export interface StatementPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
}

export interface UnifiedStatement {
  user_id: string;
  total_spend_month: number;
  transactions: StatementTransaction[];
  pagination: StatementPagination;
  money_intelligence?: {
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
  } | null;
  automation?: {
    summary: AutomationActionSummary;
    policy: {
      defaultMode: "suggest_only" | "user_confirm_required" | "autopilot_allowed";
    };
  } | null;
}

export interface StatementCategoryCorrection {
  id: string;
  transaction_id: string | null;
  normalized_merchant: string;
  original_category: string;
  corrected_category: string;
  created_at: string;
}

export interface StatementCategoryCorrectionsPayload {
  rules: MoneyIntelligenceResult["categoryLearning"]["activeRules"];
  corrections: StatementCategoryCorrection[];
}

export interface AccountStatement {
  account_id: string;
  account_name: string;
  transactions: StatementTransaction[];
  pagination: StatementPagination;
}

export interface ConnectedAccount {
  id: string;
  user_id: string;
  institution_name: string;
  account_type: "credit" | "checking" | "savings" | "cash" | "loan";
  mask: string;
  nickname: string;
}

export interface DetectedSubscription {
  id: string;
  user_id: string;
  merchant: string;
  estimated_monthly_cost: number;
  recurrence_interval: string;
  confidence: number;
  last_seen: string;
  status: string;
  lifecycle_status: "detected" | "confirmed" | "ignored" | "inactive" | "manual";
  source_state: "Synced" | "Imported" | "Inferred" | "Manual";
  sourceType?: RecordSourceType;
  explanation: {
    summary: string;
    transaction_count: number;
    first_seen: string | null;
    last_seen: string | null;
    average_interval_days: number | null;
    average_amount: number | null;
  };
}

export interface AiSpendingAnalysisResponse {
  analysis: {
    spending: {
      total_spend: number;
      total_transactions: number;
      currency: string;
      category_summary: Array<{
        category: string;
        total_spend: number;
        transaction_count: number;
        average_transaction: number;
      }>;
      top_merchants: Array<{
        merchant: string;
        merchant_group: string;
        total_spend: number;
        transaction_count: number;
        last_seen: string;
      }>;
    };
    subscription_advice: {
      unused_subscriptions: Array<{
        unused_subscription: string;
        monthly_cost: number;
        last_used: string;
        recommendation: "consider canceling";
        confidence: number;
        reason: string;
      }>;
      cancellation_suggestions: Array<{
        subscription: string;
        monthly_cost: number;
        recommendation: "consider canceling" | "review usage";
        confidence: number;
        reason: string;
        last_seen: string;
      }>;
    };
    anomalies: {
      unusual_charges: Array<{
        merchant: string;
        amount: number;
        occurred_at: string;
        reason: string;
        confidence: number;
      }>;
      unknown_merchants: Array<{
        merchant: string;
        normalized_merchant: string;
        first_seen: string;
        amount: number;
        reason: string;
      }>;
    };
  };
  transaction_summary: {
    transaction_count: number;
    date_from: string | null;
    date_to: string | null;
    include_pending: boolean;
  };
  generated_at: string;
}

export interface StatementFilters {
  date_from?: string;
  date_to?: string;
  merchant?: string;
  category?: string;
  pending?: "true" | "false";
  page?: number;
  page_size?: number;
}

function toError(body: { error?: string; errorCode?: string }): Error {
  if (body.errorCode && body.error) return new Error(`${body.errorCode}: ${body.error}`);
  return new Error(body.error || "Request failed");
}

function normalizeTransactionSourceType(tx: StatementTransaction): RecordSourceType {
  return normalizeRecordSourceType(tx.sourceType, "connected");
}

function normalizeSubscriptionSourceType(sub: DetectedSubscription): RecordSourceType {
  if (sub.lifecycle_status === "manual") return "manual";
  return normalizeRecordSourceType(sub.sourceType ?? sub.source_state, "connected");
}

function addFilters(url: URL, filters?: StatementFilters): URL {
  if (!filters) return url;
  const entries = Object.entries(filters).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  });
  for (const [key, value] of entries) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

export async function fetchUnifiedStatement(
  filters?: StatementFilters,
): Promise<UnifiedStatement> {
  const url = addFilters(new URL("/api/statements/unified", window.location.origin), filters);
  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  const body = (await response.json()) as {
    ok?: boolean;
    statement?: UnifiedStatement;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !body.statement) {
    throw toError(body);
  }

  return {
    ...body.statement,
    transactions: body.statement.transactions.map((transaction) => ({
      ...transaction,
      sourceType: normalizeTransactionSourceType(transaction),
    })),
  };
}

export async function fetchAccountStatement(input: {
  accountId: string;
  filters?: StatementFilters;
}): Promise<AccountStatement> {
  const url = addFilters(
    new URL(`/api/statements/account/${encodeURIComponent(input.accountId)}`, window.location.origin),
    input.filters,
  );
  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  const body = (await response.json()) as {
    ok?: boolean;
    statement?: AccountStatement;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !body.statement) {
    throw toError(body);
  }

  return body.statement;
}

export async function fetchConnectedAccounts(): Promise<ConnectedAccount[]> {
  const response = await fetch("/api/connect/accounts", {
    method: "GET",
    cache: "no-store",
  });

  const body = (await response.json()) as {
    ok?: boolean;
    accounts?: ConnectedAccount[];
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !Array.isArray(body.accounts)) {
    throw toError(body);
  }

  return body.accounts;
}

export async function fetchConnectedTransactionsList(): Promise<StatementTransaction[]> {
  const response = await fetch("/api/connect/transactions", {
    method: "GET",
    cache: "no-store",
  });

  const body = (await response.json()) as {
    ok?: boolean;
    transactions?: StatementTransaction[];
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !Array.isArray(body.transactions)) {
    throw toError(body);
  }

  return body.transactions.map((transaction) => ({
    ...transaction,
    sourceType: normalizeTransactionSourceType(transaction),
  }));
}

export async function fetchSuspectedSubscriptions(): Promise<DetectedSubscription[]> {
  const response = await fetch("/api/subscriptions", {
    method: "GET",
    cache: "no-store",
  });

  const body = (await response.json()) as {
    ok?: boolean;
    subscriptions?: DetectedSubscription[];
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !Array.isArray(body.subscriptions)) {
    throw toError(body);
  }

  return body.subscriptions.map((subscription) => ({
    ...subscription,
    sourceType: normalizeSubscriptionSourceType(subscription),
  }));
}

export async function setRecurringLifecycle(input: {
  subscriptionId: string;
  status: "confirmed" | "ignored" | "inactive";
}): Promise<DetectedSubscription[]> {
  const response = await fetch("/api/subscriptions/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "set_status",
      subscriptionId: input.subscriptionId,
      status: input.status,
    }),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    subscriptions?: DetectedSubscription[];
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !Array.isArray(body.subscriptions)) {
    throw toError(body);
  }

  return body.subscriptions.map((subscription) => ({
    ...subscription,
    sourceType: normalizeSubscriptionSourceType(subscription),
  }));
}

export async function addManualRecurring(input: {
  merchant: string;
  estimatedMonthlyCost: number;
  recurrenceInterval?: string;
}): Promise<DetectedSubscription[]> {
  const response = await fetch("/api/subscriptions/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "manual_add",
      merchant: input.merchant,
      estimatedMonthlyCost: input.estimatedMonthlyCost,
      recurrenceInterval: input.recurrenceInterval,
    }),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    subscriptions?: DetectedSubscription[];
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !Array.isArray(body.subscriptions)) {
    throw toError(body);
  }

  return body.subscriptions.map((subscription) => ({
    ...subscription,
    sourceType: normalizeSubscriptionSourceType(subscription),
  }));
}

export async function fetchAiSpendingAnalysis(): Promise<AiSpendingAnalysisResponse> {
  const response = await fetch("/api/ai/spending-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    cache: "no-store",
  });

  const body = (await response.json()) as {
    ok?: boolean;
    analysis?: AiSpendingAnalysisResponse["analysis"];
    transaction_summary?: AiSpendingAnalysisResponse["transaction_summary"];
    generated_at?: string;
    error?: string;
    errorCode?: string;
  };

  if (
    !response.ok
    || !body.ok
    || !body.analysis
    || !body.transaction_summary
    || !body.generated_at
  ) {
    throw toError(body);
  }

  return {
    analysis: body.analysis,
    transaction_summary: body.transaction_summary,
    generated_at: body.generated_at,
  };
}

export async function fetchCategoryCorrections(
  limit = 30,
): Promise<StatementCategoryCorrectionsPayload> {
  const response = await fetch(
    `/api/statements/category-corrections?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );

  const body = (await response.json()) as {
    ok?: boolean;
    rules?: StatementCategoryCorrectionsPayload["rules"];
    corrections?: StatementCategoryCorrection[];
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !Array.isArray(body.rules) || !Array.isArray(body.corrections)) {
    throw toError(body);
  }

  return {
    rules: body.rules,
    corrections: body.corrections,
  };
}

export async function submitCategoryCorrection(input: {
  transactionId?: string;
  normalizedMerchant: string;
  originalCategory: string;
  correctedCategory: string;
}): Promise<{
  recorded: boolean;
  ruleStatus: "active" | "pending";
  rule: MoneyIntelligenceResult["categoryLearning"]["activeRules"][number] | null;
}> {
  const response = await fetch("/api/statements/category-corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    recorded?: boolean;
    ruleStatus?: "active" | "pending";
    rule?: MoneyIntelligenceResult["categoryLearning"]["activeRules"][number] | null;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || typeof body.recorded !== "boolean" || !body.ruleStatus) {
    throw toError(body);
  }

  return {
    recorded: body.recorded,
    ruleStatus: body.ruleStatus,
    rule: body.rule || null,
  };
}
