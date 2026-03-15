import "server-only";

import { getWallet } from "@/lib/server/ledger";
import { listSavedFundingMethods } from "@/lib/server/fundingStripe";
import { listConnectedAccounts } from "@/financial_connectors/institutionService";
import { listConnectedApps } from "@/lib/server/connectedApps";
import { listNormalizedTransactions } from "@/transactions/transactionRepository";
import { detectAndPersistRecurringSubscriptions } from "@/subscription_intelligence/subscriptionService";
import { buildSafeSpendingDataset } from "@/security/aiSanitizer";
import { detectAnomalies } from "@/ai_spend_intelligence/anomalyDetector";
import { adviseOnSubscriptions } from "@/ai_spend_intelligence/subscriptionAdvisor";
import type { SmartSurfaceContext } from "@/lib/server/smartSurface/types";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function assembleSmartSurfaceContext(userId: string): Promise<SmartSurfaceContext> {
  const [wallet, fundingMethods, connectedAccounts, connectedApps, transactions, recurring] = await Promise.all([
    getWallet(userId),
    listSavedFundingMethods(userId),
    listConnectedAccounts(userId),
    listConnectedApps(userId),
    listNormalizedTransactions({ userId, limit: 500 }),
    detectAndPersistRecurringSubscriptions(userId),
  ]);

  const activeAccountIds = new Set(connectedAccounts.map((account) => account.id));
  const activeTransactions = transactions.filter((tx) => activeAccountIds.has(tx.linked_account_id));

  const safeDataset = buildSafeSpendingDataset(
    activeTransactions.map((tx) => ({
      merchant_name: tx.merchant_name,
      normalized_merchant: tx.normalized_merchant,
      amount: tx.amount,
      category: tx.category,
      pending: tx.pending,
      occurred_at: tx.occurred_at,
    })),
  );

  const anomalies = detectAnomalies(safeDataset.normalizedTransactions);
  const subscriptionAdvice = adviseOnSubscriptions({
    subscriptions: recurring,
    transactions: safeDataset.normalizedTransactions,
  });

  const recurringMonthlyTotal = recurring.reduce((sum, item) => sum + item.estimated_monthly_cost, 0);
  const cancellationCandidateMonthlyTotal = subscriptionAdvice.cancellation_suggestions.reduce(
    (sum, item) => sum + item.monthly_cost,
    0,
  );

  const staleAccountCount = connectedAccounts.filter((account) => {
    if (!account.last_synced_at) return true;
    const ageMs = Date.now() - Date.parse(account.last_synced_at);
    return ageMs > 1000 * 60 * 60 * 24 * 3;
  }).length;

  const hasAnyConnectedSource = connectedAccounts.length > 0 || connectedApps.length > 0;
  const hasRecentData = activeTransactions.length > 0;
  const lowDataReason = hasRecentData
    ? null
    : hasAnyConnectedSource
      ? "Sources are connected but there is not enough recent posted transaction history yet."
      : "No connected sources yet. Sync accounts first to unlock full Calico intelligence.";
  const contextSourceState: SmartSurfaceContext["dataState"]["sourceState"] = hasRecentData
    ? "Synced"
    : hasAnyConnectedSource
      ? "Manual"
      : "Manual";

  return {
    generatedAt: new Date().toISOString(),
    wallet: {
      balance: roundCurrency(wallet.balance),
      currency: wallet.currency,
      fundingMethodCount: fundingMethods.length,
    },
    statements: {
      transactionCount: activeTransactions.length,
      anomalousChargeCount: anomalies.unusual_charges.length,
      hasRecentData,
    },
    recurring: {
      count: recurring.length,
      monthlyTotal: roundCurrency(recurringMonthlyTotal),
      cancellationCandidateMonthlyTotal: roundCurrency(cancellationCandidateMonthlyTotal),
    },
    connectionHealth: {
      accountCount: connectedAccounts.length,
      appCount: connectedApps.length,
      staleAccountCount,
      hasAnyConnectedSource,
    },
    dataState: {
      sourceState: contextSourceState,
      lowData: !hasRecentData,
      lowDataReason,
    },
    trust: {
      knows: `Calico knows ${connectedAccounts.length} connected accounts, ${connectedApps.length} connected apps, ${activeTransactions.length} synced transactions, and ${fundingMethods.length} funding methods.`,
      infers: hasRecentData
        ? "Calico infers recurring bills, anomalies, and optimization opportunities from synced transactions."
        : "Calico has limited inference until enough posted synced data is available.",
      recommends: hasRecentData
        ? "Calico recommends ranked actions with clear drill-ins."
        : "Calico recommends setup and sync actions first.",
      canDo: "Calico can open statement filters, recurring lifecycle actions, funding setup, and connection-health remediation now.",
    },
  };
}
