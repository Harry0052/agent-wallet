import "server-only";

import { query } from "@/lib/server/db";
import { getWallet } from "@/lib/server/ledger";
import { listConnectedAccounts, listConnectedInstitutions } from "@/financial_connectors/institutionService";
import { listNormalizedTransactions } from "@/transactions/transactionRepository";
import { syncPlaidTransactionsForUser } from "@/transactions/transactionSync";
import { listRecurringIntelligence } from "@/subscription_intelligence/subscriptionService";
import { buildMoneyIntelligenceForUser } from "@/lib/server/moneyIntelligence/engine";
import { listCategoryLearningRules } from "@/lib/server/moneyIntelligence/categoryLearningStore";
import { getTaskCenterSnapshot } from "@/lib/server/automation/service";
import { logServerEvent } from "@/lib/server/observability";
import {
  composeFinancialTimeline,
  buildCrossAccountMoneyFlowAnalysis,
  detectInternalTransferPairs,
  type FinancialOsTransactionSignal,
} from "@/lib/server/financialOs/intelligence";
import {
  createFinancialDocumentHook,
  dismissFinancialNotification,
  listActiveFinancialNotifications,
  listFinancialDocumentHooks,
  listFinancialMemoryEntries,
  listRecentFinancialSyncRuns,
  upsertFinancialMemoryEntry,
  upsertFinancialNotificationCandidate,
} from "@/lib/server/financialOs/store";
import type {
  FinancialDocumentHook,
  FinancialDocumentSummary,
  FinancialMemorySnapshot,
  FinancialNotification,
  UnifiedFinancialAccountDashboard,
} from "@/lib/server/financialOs/types";

interface InsightRow {
  id: string;
  insight_type: string;
  title: string;
  summary: string;
  amount_impact: string | null;
  generated_at: string;
}

function asNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isFresh(lastSyncedAt: string | null, nowMs: number): boolean {
  if (!lastSyncedAt) return false;
  const parsed = Date.parse(lastSyncedAt);
  if (!Number.isFinite(parsed)) return false;
  return nowMs - parsed <= 6 * 60 * 60 * 1000;
}

async function listDismissedInsights(userId: string): Promise<Array<{ id: string; title: string; dismissedAt: string }>> {
  try {
    const result = await query<{
      id: string;
      title: string;
      dismissed_at: string;
    }>(
      `
        SELECT id, title, dismissed_at::text
        FROM insights
        WHERE user_id = $1
          AND status = 'dismissed'
          AND dismissed_at IS NOT NULL
        ORDER BY dismissed_at DESC
        LIMIT 30
      `,
      [userId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      dismissedAt: row.dismissed_at,
    }));
  } catch {
    return [];
  }
}

async function listActiveAnomalyInsights(userId: string): Promise<Array<{
  id: string;
  title: string;
  summary: string;
  amountImpact: number | null;
  generatedAt: string;
}>> {
  try {
    const result = await query<InsightRow>(
      `
        SELECT
          id,
          insight_type,
          title,
          summary,
          amount_impact::text,
          generated_at::text
        FROM insights
        WHERE user_id = $1
          AND status = 'active'
          AND insight_type IN ('unusual_spending', 'budget_risk')
        ORDER BY generated_at DESC
        LIMIT 20
      `,
      [userId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      amountImpact: row.amount_impact ? asNumber(row.amount_impact) : null,
      generatedAt: row.generated_at,
    }));
  } catch {
    return [];
  }
}

function summarizeDocuments(documents: FinancialDocumentHook[]): FinancialDocumentSummary {
  const byType: FinancialDocumentSummary["byType"] = {
    statement: 0,
    bill: 0,
    receipt: 0,
    confirmation: 0,
  };
  for (const doc of documents) {
    byType[doc.documentType] += 1;
  }
  return {
    total: documents.length,
    byType,
    recent: documents.slice(0, 8),
  };
}

function buildMemorySnapshot(input: {
  entries: Awaited<ReturnType<typeof listFinancialMemoryEntries>>;
}): FinancialMemorySnapshot {
  const confidence = Math.max(0.3, Math.min(0.98, 0.45 + input.entries.length * 0.08));
  return {
    entries: input.entries,
    confidence: round(confidence),
    explanation: input.entries.length > 0
      ? "Financial memory stores corrected categories, dismissed insights, snoozed tasks, recurring behavior, and preferences."
      : "Financial memory is empty until user interactions and recurring behavior are observed.",
  };
}

async function persistFinancialMemory(input: {
  userId: string;
  categoryRules: Awaited<ReturnType<typeof listCategoryLearningRules>>;
  dismissedInsights: Array<{ id: string; title: string; dismissedAt: string }>;
  snoozedTasks: Array<{ id: string; title: string; snoozedUntil: string | null }>;
  recurringBehavior: Awaited<ReturnType<typeof listRecurringIntelligence>>;
  preferences: Record<string, unknown>;
}): Promise<void> {
  await Promise.all([
    upsertFinancialMemoryEntry({
      userId: input.userId,
      key: "category_corrections",
      data: {
        learnedMerchants: input.categoryRules.length,
        activeRules: input.categoryRules
          .filter((rule) => rule.status === "active")
          .slice(0, 40),
      },
    }),
    upsertFinancialMemoryEntry({
      userId: input.userId,
      key: "dismissed_insights",
      data: {
        count: input.dismissedInsights.length,
        recent: input.dismissedInsights.slice(0, 40),
      },
    }),
    upsertFinancialMemoryEntry({
      userId: input.userId,
      key: "snoozed_tasks",
      data: {
        count: input.snoozedTasks.length,
        recent: input.snoozedTasks.slice(0, 40),
      },
    }),
    upsertFinancialMemoryEntry({
      userId: input.userId,
      key: "recurring_behaviors",
      data: {
        count: input.recurringBehavior.length,
        merchants: input.recurringBehavior.slice(0, 50).map((item) => ({
          merchant: item.merchant,
          interval: item.recurrence_interval,
          confidence: item.confidence,
          lifecycleStatus: item.lifecycle_status,
        })),
      },
    }),
    upsertFinancialMemoryEntry({
      userId: input.userId,
      key: "preferences",
      data: input.preferences,
    }),
  ]);
}

async function buildAndPersistNotifications(input: {
  userId: string;
  staleAccountCount: number;
  pendingConfirmCount: number;
  activeAnomalies: number;
  safeToSpendThisWeek: number;
  nearestBillAmount: number | null;
  nearestBillDate: string | null;
  latestSyncFailed: boolean;
  stressStatus: "low" | "watch" | "high" | "critical";
}): Promise<FinancialNotification[]> {
  if (input.staleAccountCount > 0) {
    await upsertFinancialNotificationCandidate({
      userId: input.userId,
      dedupKey: "data_stale_accounts",
      kind: "data_stale",
      title: "Some accounts need refresh",
      summary: `${input.staleAccountCount} account connection(s) look stale. Refresh for accurate timeline and cashflow.`,
      priority: "medium",
      deepLink: "/connect#health",
      cooldownMinutes: 180,
    });
  }

  if (input.pendingConfirmCount > 0) {
    await upsertFinancialNotificationCandidate({
      userId: input.userId,
      dedupKey: "task_center_pending_confirm",
      kind: "task_confirm",
      title: "Actions waiting for confirmation",
      summary: `${input.pendingConfirmCount} financial action(s) need your confirmation in Task Center.`,
      priority: "high",
      deepLink: "/tasks",
      cooldownMinutes: 60,
    });
  }

  if (input.activeAnomalies > 0) {
    await upsertFinancialNotificationCandidate({
      userId: input.userId,
      dedupKey: "anomaly_review_needed",
      kind: "anomaly",
      title: "Review unusual activity",
      summary: `${input.activeAnomalies} anomaly insight(s) are active and need review.`,
      priority: "high",
      deepLink: "/insights",
      cooldownMinutes: 120,
    });
  }

  if (
    input.nearestBillAmount !== null
    && input.nearestBillDate
    && input.safeToSpendThisWeek < input.nearestBillAmount
  ) {
    await upsertFinancialNotificationCandidate({
      userId: input.userId,
      dedupKey: `bill_affordability_${input.nearestBillDate.slice(0, 10)}`,
      kind: "bill_risk",
      title: "Upcoming bill may exceed safe weekly spend",
      summary: `A bill of ${round(input.nearestBillAmount)} is due soon, above this week's safe spend.`,
      priority: "critical",
      deepLink: "/statements",
      cooldownMinutes: 240,
    });
  }

  if (input.latestSyncFailed) {
    await upsertFinancialNotificationCandidate({
      userId: input.userId,
      dedupKey: "latest_sync_failed",
      kind: "sync_failed",
      title: "Recent sync failed",
      summary: "A recent transaction sync failed. Retry sync to keep your dashboard current.",
      priority: "high",
      deepLink: "/connect#accounts",
      cooldownMinutes: 45,
    });
  }

  if (input.stressStatus === "high" || input.stressStatus === "critical") {
    await upsertFinancialNotificationCandidate({
      userId: input.userId,
      dedupKey: "financial_stress_high",
      kind: "stress",
      title: "Financial stress is elevated",
      summary: `Current stress status is ${input.stressStatus}. Review advanced intelligence and task center safeguards.`,
      priority: input.stressStatus === "critical" ? "critical" : "high",
      deepLink: "/tasks",
      cooldownMinutes: 180,
    });
  }

  return listActiveFinancialNotifications({
    userId: input.userId,
    limit: 24,
  });
}

export async function buildUnifiedFinancialAccountDashboard(input: {
  userId: string;
  attemptRealtimeSync?: boolean;
}): Promise<UnifiedFinancialAccountDashboard> {
  if (input.attemptRealtimeSync) {
    try {
      await syncPlaidTransactionsForUser(input.userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      logServerEvent("warn", "financial_os.realtime_sync.failed", {
        userId: input.userId,
        message,
      });
    }
  }

  const [
    wallet,
    accounts,
    institutions,
    transactions,
    recurring,
    money,
    taskCenter,
    categoryRules,
    dismissedInsights,
    anomalyInsights,
    documents,
    recentSyncRuns,
  ] = await Promise.all([
    getWallet(input.userId),
    listConnectedAccounts(input.userId),
    listConnectedInstitutions(input.userId),
    listNormalizedTransactions({ userId: input.userId, limit: 1500 }),
    listRecurringIntelligence({ userId: input.userId }),
    buildMoneyIntelligenceForUser(input.userId),
    getTaskCenterSnapshot({ userId: input.userId, limit: 80 }),
    listCategoryLearningRules(input.userId),
    listDismissedInsights(input.userId),
    listActiveAnomalyInsights(input.userId),
    listFinancialDocumentHooks({ userId: input.userId, limit: 120 }),
    listRecentFinancialSyncRuns({ userId: input.userId, limit: 24 }),
  ]);

  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const signals: FinancialOsTransactionSignal[] = transactions.map((tx) => ({
    id: tx.id,
    linkedAccountId: tx.linked_account_id,
    merchantName: tx.merchant_name,
    normalizedMerchant: tx.normalized_merchant,
    amount: tx.amount,
    category: tx.category,
    pending: tx.pending,
    occurredAt: tx.occurred_at,
  }));

  const transferPairs = detectInternalTransferPairs({
    transactions: signals,
    nowIso,
  });
  const moneyFlow = buildCrossAccountMoneyFlowAnalysis({
    transactions: signals,
    transferPairs,
  });

  const timeline = composeFinancialTimeline({
    nowIso,
    currency: wallet.currency,
    transactions: signals,
    transferPairs,
    bills: money.billPredictions,
    subscriptions: money.subscriptionTimeline,
    taskActions: taskCenter.actions,
    taskSummary: taskCenter.summary,
    anomalyInsights,
    monthlyBudget: wallet.settings.monthlyBudget,
  });

  const snoozedTasks = taskCenter.actions
    .filter((action) => action.status === "snoozed")
    .map((action) => ({
      id: action.id,
      title: action.title,
      snoozedUntil: action.snoozedUntil,
    }));

  await persistFinancialMemory({
    userId: input.userId,
    categoryRules,
    dismissedInsights,
    snoozedTasks,
    recurringBehavior: recurring,
    preferences: {
      walletSettings: wallet.settings,
      taskCenterDefaultPolicy: taskCenter.policy.defaultMode,
      notificationsMode: "throttled",
    },
  });

  const memoryEntries = await listFinancialMemoryEntries({ userId: input.userId });
  const memory = buildMemorySnapshot({ entries: memoryEntries });

  const nearestBill = money.billPredictions
    .filter((bill) => Date.parse(bill.dueDate) >= nowMs)
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate))[0];
  const latestSyncFailed = recentSyncRuns[0]?.status === "failed";
  const notifications = await buildAndPersistNotifications({
    userId: input.userId,
    staleAccountCount: money.coverage.staleAccountCount,
    pendingConfirmCount: taskCenter.summary.pendingConfirmCount,
    activeAnomalies: anomalyInsights.length,
    safeToSpendThisWeek: money.affordability.safeToSpendThisWeek,
    nearestBillAmount: nearestBill?.amount ?? null,
    nearestBillDate: nearestBill?.dueDate ?? null,
    latestSyncFailed,
    stressStatus: money.advancedIntelligence.financialStressDetection.status,
  });

  const accountsPayload = accounts.map((account) => ({
    id: account.id,
    institutionName: account.institution_name,
    nickname: account.nickname,
    accountType: account.account_type,
    mask: account.mask,
    lastSyncedAt: account.last_synced_at,
    syncFresh: isFresh(account.last_synced_at, nowMs),
  }));
  const freshAccountCount = accountsPayload.filter((account) => account.syncFresh).length;

  return {
    generatedAt: nowIso,
    accounts: accountsPayload,
    institutions: institutions.map((institution) => ({
      institutionName: institution.institution_name,
      accountCount: institution.account_count,
    })),
    sync: {
      connectedAccountCount: accountsPayload.length,
      freshAccountCount,
      staleAccountCount: Math.max(0, accountsPayload.length - freshAccountCount),
      recentRuns: recentSyncRuns,
    },
    moneyFlow,
    timeline,
    memory,
    notifications,
    taskCenter: {
      pendingConfirmCount: taskCenter.summary.pendingConfirmCount,
      activeCount: taskCenter.summary.activeCount,
      completed7dCount: taskCenter.summary.completed7dCount,
      failed7dCount: taskCenter.summary.failed7dCount,
      topActions: taskCenter.summary.topActions.map((action) => ({
        id: action.id,
        title: action.title,
        status: action.status,
        actionType: action.actionType,
        confidence: action.confidence,
      })),
    },
    documents: summarizeDocuments(documents),
  };
}

export async function createFinancialDocumentStorageHook(input: {
  userId: string;
  documentType: FinancialDocumentHook["documentType"];
  fileName: string;
  mimeType: string;
  sourceHash?: string | null;
  storageProvider?: string | null;
  storageReference?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return createFinancialDocumentHook(input);
}

export async function getFinancialDocumentStorageHooks(input: {
  userId: string;
  limit?: number;
}) {
  const docs = await listFinancialDocumentHooks(input);
  return {
    summary: summarizeDocuments(docs),
    documents: docs,
  };
}

export async function getFinancialOsNotifications(input: {
  userId: string;
  limit?: number;
}) {
  return listActiveFinancialNotifications(input);
}

export async function dismissFinancialOsNotification(input: {
  userId: string;
  notificationId: string;
}) {
  return dismissFinancialNotification(input);
}
