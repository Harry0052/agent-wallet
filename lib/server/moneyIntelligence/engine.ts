import 'server-only';

import { getWallet } from '@/lib/server/ledger';
import { listConnectedAccounts } from '@/financial_connectors/institutionService';
import { listNormalizedTransactions } from '@/transactions/transactionRepository';
import { listRecurringIntelligence } from '@/subscription_intelligence/subscriptionService';
import {
  listCategoryLearningRules,
} from '@/lib/server/moneyIntelligence/categoryLearningStore';
import { computeMoneyIntelligence } from '@/lib/server/moneyIntelligence/core';
import type {
  MoneyCategoryRule,
  MoneyConnectedAccountInput,
  MoneyIntelligenceResult,
  MoneyRecurringInput,
  MoneyTransactionInput,
} from '@/lib/server/moneyIntelligence/types';

export interface MoneyIntelligenceSourceBundle {
  walletBalance: number;
  currency: string;
  transactions: MoneyTransactionInput[];
  recurring: MoneyRecurringInput[];
  connectedAccounts: MoneyConnectedAccountInput[];
  categoryRules: MoneyCategoryRule[];
}

function mapTransactions(
  rows: Array<{
    id: string;
    merchant_name: string;
    normalized_merchant: string;
    amount: number;
    category: string;
    pending: boolean;
    occurred_at: string;
    linked_account_id: string;
  }>,
): MoneyTransactionInput[] {
  return rows.map((row) => ({
    id: row.id,
    merchantName: row.merchant_name,
    normalizedMerchant: row.normalized_merchant,
    amount: row.amount,
    category: row.category,
    pending: row.pending,
    occurredAt: row.occurred_at,
    linkedAccountId: row.linked_account_id,
  }));
}

function mapRecurring(
  rows: Array<{
    id: string;
    merchant: string;
    estimated_monthly_cost: number;
    recurrence_interval: string;
    confidence: number;
    last_seen: string;
    lifecycle_status?: 'detected' | 'confirmed' | 'ignored' | 'inactive' | 'manual';
  }>,
): MoneyRecurringInput[] {
  return rows.map((row) => ({
    id: row.id,
    merchant: row.merchant,
    estimatedMonthlyCost: row.estimated_monthly_cost,
    recurrenceInterval: row.recurrence_interval,
    confidence: row.confidence,
    lastSeen: row.last_seen,
    lifecycleStatus: row.lifecycle_status || 'detected',
  }));
}

function mapAccounts(
  rows: Array<{
    id: string;
    last_synced_at: string | null;
    account_type?: string;
    balance?: number;
  }>,
): MoneyConnectedAccountInput[] {
  return rows.map((row) => ({
    id: row.id,
    lastSyncedAt: row.last_synced_at,
    type: row.account_type,
    balance: typeof row.balance === 'number' ? row.balance : undefined,
  }));
}

export async function loadMoneyIntelligenceSources(
  userId: string,
): Promise<MoneyIntelligenceSourceBundle> {
  const [wallet, connectedAccounts, transactions, recurring, categoryRules] = await Promise.all([
    getWallet(userId),
    listConnectedAccounts(userId),
    listNormalizedTransactions({ userId, limit: 1200 }),
    listRecurringIntelligence({ userId }),
    listCategoryLearningRules(userId),
  ]);

  return {
    walletBalance: wallet.balance,
    currency: wallet.currency,
    transactions: mapTransactions(transactions),
    recurring: mapRecurring(recurring),
    connectedAccounts: mapAccounts(connectedAccounts),
    categoryRules,
  };
}

export function buildMoneyIntelligenceFromSources(input: {
  sources: MoneyIntelligenceSourceBundle;
  nowIso?: string;
}): MoneyIntelligenceResult {
  return computeMoneyIntelligence({
    walletBalance: input.sources.walletBalance,
    currency: input.sources.currency,
    transactions: input.sources.transactions,
    recurring: input.sources.recurring,
    connectedAccounts: input.sources.connectedAccounts,
    categoryRules: input.sources.categoryRules,
    nowIso: input.nowIso,
  });
}

export async function buildMoneyIntelligenceForUser(
  userId: string,
  input?: { nowIso?: string },
): Promise<MoneyIntelligenceResult> {
  const sources = await loadMoneyIntelligenceSources(userId);
  return buildMoneyIntelligenceFromSources({
    sources,
    nowIso: input?.nowIso,
  });
}
