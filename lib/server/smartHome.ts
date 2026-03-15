import 'server-only';

import { getWallet } from '@/lib/server/ledger';
import { listConnectedAccounts } from '@/financial_connectors/institutionService';
import { listConnectedApps } from '@/lib/server/connectedApps';
import { detectAndPersistRecurringSubscriptions } from '@/subscription_intelligence/subscriptionService';
import { listNormalizedTransactions } from '@/transactions/transactionRepository';
import { buildSafeSpendingDataset } from '@/security/aiSanitizer';
import { analyzeSpending } from '@/ai_spend_intelligence/spendAnalyzer';
import { detectAnomalies } from '@/ai_spend_intelligence/anomalyDetector';
import { adviseOnSubscriptions } from '@/ai_spend_intelligence/subscriptionAdvisor';
import { listSavedFundingMethods } from '@/lib/server/fundingStripe';

export type SourceState = 'Synced' | 'Imported' | 'Inferred' | 'Manual';

export interface SmartHomeAction {
  label: string;
  href: string;
}

export interface SmartHomeInsightCard {
  id:
    | 'found_money'
    | 'unusual_spending'
    | 'recurring_bills'
    | 'budget_risk'
    | 'connection_health';
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
    mode: 'none' | 'no_connected_accounts' | 'awaiting_sync' | 'thin_history';
    reason: string | null;
    nextBestActions: Array<{
      label: string;
      href: string;
      description: string;
    }>;
  };
  healthScore?: {
    adjustedOverallScore: number;
    trend: 'improving' | 'stable' | 'declining';
    topRecommendation: string;
  };
  cashFlow?: {
    safeToSpendToday: number;
    daysUntilNegative: number | null;
    confidence: number;
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

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthlyToWindow(amountMonthly: number, days: number): number {
  return (amountMonthly / 30) * days;
}

function oldestRecentIso(values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (valid.length === 0) return null;
  const latest = Math.max(...valid);
  return new Date(latest).toISOString();
}

function computeSummarySourceState(input: {
  connectedAccountsCount: number;
  activeTransactionsCount: number;
}): SourceState {
  if (input.connectedAccountsCount > 0 || input.activeTransactionsCount > 0) {
    return 'Synced';
  }
  return 'Manual';
}

type LowDataMode = 'none' | 'no_connected_accounts' | 'awaiting_sync' | 'thin_history';

function resolveLowDataMode(input: {
  connectedAccountsCount: number;
  activeTransactionsCount: number;
}): LowDataMode {
  if (input.connectedAccountsCount === 0) return 'no_connected_accounts';
  if (input.activeTransactionsCount === 0) return 'awaiting_sync';
  if (input.activeTransactionsCount < 25) return 'thin_history';
  return 'none';
}

export async function buildSmartHomePayload(userId: string): Promise<SmartHomePayload> {
  const [wallet, connectedAccounts, connectedApps, recurring, transactions, paymentMethods] = await Promise.all([
    getWallet(userId),
    listConnectedAccounts(userId),
    listConnectedApps(userId),
    detectAndPersistRecurringSubscriptions(userId),
    listNormalizedTransactions({ userId, limit: 500 }),
    listSavedFundingMethods(userId),
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

  const spend = analyzeSpending(safeDataset.normalizedTransactions, {
    topMerchantLimit: 5,
  });
  const anomalies = detectAnomalies(safeDataset.normalizedTransactions);
  const subscriptionAdvice = adviseOnSubscriptions({
    subscriptions: recurring,
    transactions: safeDataset.normalizedTransactions,
  });

  const recurringMonthly = recurring.reduce((sum, item) => sum + item.estimated_monthly_cost, 0);
  const upcomingBills7d = roundCurrency(monthlyToWindow(recurringMonthly, 7));
  const outlook30dDelta = roundCurrency(wallet.balance - recurringMonthly);

  const foundMoney = roundCurrency(
    subscriptionAdvice.cancellation_suggestions.reduce((sum, s) => sum + s.monthly_cost, 0),
  );

  const staleAccounts = connectedAccounts.filter((account) => {
    if (!account.last_synced_at) return true;
    const ageMs = Date.now() - Date.parse(account.last_synced_at);
    return ageMs > 1000 * 60 * 60 * 24 * 3;
  });

  const latestSync = oldestRecentIso([
    ...connectedAccounts.map((account) => account.last_synced_at),
    activeTransactions[0]?.occurred_at,
  ]);
  const nowIso = new Date().toISOString();
  const lowDataMode = resolveLowDataMode({
    connectedAccountsCount: connectedAccounts.length,
    activeTransactionsCount: activeTransactions.length,
  });
  const lowData = lowDataMode !== 'none';
  const lowDataReason =
    lowDataMode === 'no_connected_accounts'
      ? 'No connected accounts yet. Calico can show setup guidance only.'
      : lowDataMode === 'awaiting_sync'
        ? 'Accounts are connected, but posted transactions have not synced yet.'
        : lowDataMode === 'thin_history'
          ? 'Transaction history is still thin. Insights are conservative until more posted data arrives.'
          : null;
  const lowDataNextBestActions = lowData
    ? lowDataMode === 'no_connected_accounts'
      ? [
          {
            label: 'Step 1: Connect an account',
            href: '/connect',
            description: 'Use Connections to start a real institution link flow.',
          },
          {
            label: 'Step 2: Wait for first sync',
            href: '/connect#health',
            description: 'Return to Connections and verify at least one healthy synced account.',
          },
          {
            label: 'Step 3: Review recurring',
            href: '/statements?panel=recurring',
            description: 'Confirm recurring bills so Home recommendations become more useful.',
          },
        ]
      : lowDataMode === 'awaiting_sync'
        ? [
            {
              label: 'Step 1: Verify account health',
              href: '/connect#health',
              description: 'Check whether the account is healthy or needs reconnect.',
            },
            {
              label: 'Step 2: Refresh sync',
              href: '/connect#accounts',
              description: 'Trigger a sync/reconnect in Connections if data is still missing.',
            },
            {
              label: 'Step 3: Review statements',
              href: '/statements?panel=recurring',
              description: 'Open recurring and unusual-spend views after sync completes.',
            },
          ]
        : [
            {
              label: 'Step 1: Review recurring',
              href: '/statements?panel=recurring',
              description: 'Confirm or ignore detected merchants to improve forecast quality.',
            },
            {
              label: 'Step 2: Check unusual spend',
              href: '/statements?panel=anomalies',
              description: 'Inspect flagged transactions and filter statements by merchant.',
            },
            {
              label: 'Step 3: Re-check Home',
              href: '/home',
              description: 'Return to Home after these actions to refresh opportunities and risk.',
            },
          ]
    : [];
  const summarySourceState = computeSummarySourceState({
    connectedAccountsCount: connectedAccounts.length,
    activeTransactionsCount: activeTransactions.length,
  });
  const hasInferenceInputs = activeTransactions.length > 0;
  const recurringSourceState: SourceState = hasInferenceInputs ? 'Inferred' : 'Manual';
  const foundMoneySourceState: SourceState = hasInferenceInputs ? 'Inferred' : 'Manual';
  const unusualSpendSourceState: SourceState = hasInferenceInputs ? 'Inferred' : 'Manual';
  const budgetSourceState: SourceState = recurring.length > 0 ? 'Inferred' : summarySourceState;
  const connectionHealthState: SourceState = connectedAccounts.length > 0 || connectedApps.length > 0 ? 'Synced' : 'Manual';

  const cards: SmartHomeInsightCard[] = [
    {
      id: 'found_money',
      title: 'Found Money',
      summary:
        foundMoney > 0
          ? `Potential monthly savings of $${foundMoney.toFixed(2)} from likely downgrade/cancel opportunities.`
          : hasInferenceInputs
            ? 'No strong cancellation opportunities detected right now.'
            : 'Connect account data to unlock found-money opportunities.',
      whyThisCard: hasInferenceInputs
        ? "Based on recurring merchants and cancellation heuristics from synced statement activity."
        : "This card appears because lower-bill opportunities require synced statement history.",
      canDoNow: "Open recurring spend, confirm recurring merchants, and review top monthly-cost candidates.",
      sourceState: foundMoneySourceState,
      lastUpdatedAt: latestSync || nowIso,
      actions: [
        { label: 'Review recurring spend', href: '/statements?panel=recurring' },
        { label: 'Open all transactions', href: '/statements' },
      ],
    },
    {
      id: 'unusual_spending',
      title: 'Unusual Spending',
      summary:
        anomalies.unusual_charges.length > 0
          ? `${anomalies.unusual_charges.length} unusual charge${anomalies.unusual_charges.length === 1 ? '' : 's'} need review.`
          : hasInferenceInputs
            ? 'No unusual spending spikes detected in the current window.'
            : 'Connect account data to monitor unusual spending.',
      whyThisCard: hasInferenceInputs
        ? "Derived from anomaly checks over synced transaction patterns."
        : "This card appears to show anomaly monitoring readiness once sync coverage improves.",
      canDoNow: "Open anomalies, inspect flagged merchants, and dismiss false positives.",
      sourceState: unusualSpendSourceState,
      lastUpdatedAt: latestSync || nowIso,
      actions: [
        { label: 'Inspect unusual transactions', href: '/statements?panel=anomalies' },
        { label: 'Categorize spend', href: '/statements?panel=categories' },
      ],
    },
    {
      id: 'recurring_bills',
      title: 'Recurring Subscriptions & Bills',
      summary:
        recurring.length > 0
          ? `${recurring.length} recurring merchant${recurring.length === 1 ? '' : 's'} tracked, about $${recurringMonthly.toFixed(2)}/month.`
          : hasInferenceInputs
            ? 'No recurring bills confirmed yet. Keep syncing to improve recurring detection.'
            : 'No recurring bills yet. Connect accounts to start recurring detection.',
      whyThisCard: hasInferenceInputs
        ? "Built from recurring cadence detection and manual recurring tracking signals."
        : "Recurring intelligence is limited until account transactions are synced.",
      canDoNow: "Confirm recurring items, ignore merchants, or manually track known bills.",
      sourceState: recurringSourceState,
      lastUpdatedAt: latestSync || nowIso,
      actions: [
        { label: 'Open recurring panel', href: '/statements?panel=recurring' },
        { label: 'Connect accounts', href: '/connect' },
      ],
    },
    {
      id: 'budget_risk',
      title: 'Budget / Cash Risk',
      summary:
        outlook30dDelta < 0
          ? `Projected 30-day cash delta is negative (${outlook30dDelta.toFixed(2)}).`
          : `Projected 30-day cash delta is positive (+$${outlook30dDelta.toFixed(2)}).`,
      whyThisCard: recurring.length > 0
        ? "Projection combines current wallet balance with tracked recurring obligations."
        : "Projection currently uses wallet balance and limited recurring inputs.",
      canDoNow: "Add funding methods, adjust guardrails, and improve recurring coverage for better projections.",
      sourceState: budgetSourceState,
      lastUpdatedAt: latestSync || nowIso,
      actions: [
        { label: 'Fund wallet', href: '/wallet?open_payment_setup=1' },
        { label: 'Adjust guardrails', href: '/wallet#guardrails' },
      ],
    },
    {
      id: 'connection_health',
      title: 'Connection Health',
      summary:
        staleAccounts.length > 0
          ? `${staleAccounts.length} account connection${staleAccounts.length === 1 ? '' : 's'} need attention.`
          : connectedAccounts.length > 0 || connectedApps.length > 0
            ? 'Connected sources look healthy.'
            : 'No connected sources yet. Add accounts to activate sync health signals.',
      whyThisCard: "Connection health controls whether Calico insights are current and trustworthy.",
      canDoNow: "Reconnect stale sources or remove inactive ones from active logic.",
      sourceState: connectionHealthState,
      lastUpdatedAt: latestSync || nowIso,
      actions: [
        { label: 'Open connect center', href: '/connect' },
        { label: 'Reconnect sources', href: '/connect#health' },
      ],
    },
  ];

  let healthScore: SmartHomePayload['healthScore'];
  let cashFlow: SmartHomePayload['cashFlow'];

  try {
    const { computeHealthScore } = await import('@/lib/server/engines/healthScoreEngine');
    const healthResult = await computeHealthScore(userId);
    if (healthResult.status === 'success') {
      healthScore = {
        adjustedOverallScore: healthResult.data.adjustedOverallScore,
        trend: healthResult.data.trend,
        topRecommendation: healthResult.data.topRecommendation,
      };
    }
  } catch { /* engine not yet available */ }

  try {
    const { predictCashFlow } = await import('@/lib/server/engines/cashFlowEngine');
    const cashFlowResult = await predictCashFlow(userId);
    if (cashFlowResult.status === 'success') {
      cashFlow = {
        safeToSpendToday: cashFlowResult.data.safeToSpendToday,
        daysUntilNegative: cashFlowResult.data.daysUntilNegative,
        confidence: cashFlowResult.confidence,
      };
    }
  } catch { /* engine not yet available */ }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      netCashPosition: roundCurrency(wallet.balance - spend.total_spend),
      availableCash: roundCurrency(wallet.balance),
      upcomingBills7d,
      outlook30dDelta,
      currency: wallet.currency,
      sourceState: summarySourceState,
      lastUpdatedAt: latestSync,
    },
    freshness: {
      label: latestSync ? 'Synced' : 'Awaiting first sync',
      lastSyncedAt: latestSync,
      sourceState: latestSync ? 'Synced' : 'Manual',
    },
    dataQuality: {
      lowData,
      mode: lowDataMode,
      reason: lowDataReason,
      nextBestActions: lowDataNextBestActions,
    },
    healthScore,
    cashFlow,
    quickIntents: ['Lower bills', 'Review unusual spend', 'Plan cash next 30 days', 'Check account health'],
    insightCards: cards,
    walletStrip: [
      { label: 'Fund', href: '/wallet?open_payment_setup=1' },
      { label: 'Saved payment methods', href: '/wallet#payment-methods' },
      { label: 'Recent ledger', href: '/wallet#ledger' },
    ],
    statementsStrip: [
      { label: 'All transactions', href: '/statements' },
      { label: 'Recurring', href: '/statements?panel=recurring' },
      { label: 'Merchant view', href: '/statements?panel=merchants' },
      { label: 'Category view', href: '/statements?panel=categories' },
    ],
    trust: {
      knows: `Calico knows ${connectedAccounts.length} connected accounts, ${connectedApps.length} connected apps, ${activeTransactions.length} synced transactions, and ${paymentMethods.length} saved funding methods.`,
      infers: hasInferenceInputs
        ? 'Calico infers recurring bills, unusual spend, and budget risk from synced transaction data.'
        : 'Calico has limited inference until connected account data is available.',
      recommends: lowData
        ? 'Calico recommends a fixed sequence: connect, sync, then review recurring and unusual spending.'
        : 'Calico recommends prioritized actions based on impact and confidence.',
      canDo: lowData
        ? 'Calico can route you through setup and first analysis actions immediately, then expand recommendations once sync coverage improves.'
        : 'Calico can route you to statement drill-ins, recurring lifecycle actions, funding setup, and source reconnect immediately.',
    },
  };
}
