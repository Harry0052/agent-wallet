import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAutomationCandidates } from '../lib/server/automation/detectors.ts';
import { computeMoneyIntelligence } from '../lib/server/moneyIntelligence/core.ts';
import type {
  MoneyAffordability,
  MoneyBillPrediction,
  MoneyCategoryRule,
  MoneyCoverage,
  MoneyMonthlySurvivalForecast,
  MoneyRecurringInput,
  MoneyTransactionInput,
} from '../lib/server/moneyIntelligence/types.ts';

const NOW_ISO = '2026-03-15T12:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function tx(input: {
  id: string;
  daysAgo: number;
  amount: number;
  merchant: string;
  category: string;
  pending?: boolean;
}): MoneyTransactionInput {
  return {
    id: input.id,
    merchantName: input.merchant,
    normalizedMerchant: input.merchant.toLowerCase().replace(/\s+/g, '_'),
    amount: input.amount,
    category: input.category,
    pending: input.pending ?? false,
    occurredAt: new Date(Date.parse(NOW_ISO) - input.daysAgo * DAY_MS).toISOString(),
  };
}

const COVERAGE: MoneyCoverage = {
  sourceState: 'synced',
  lowData: false,
  staleAccountCount: 0,
  connectedAccountCount: 2,
  transactionCoverageDays: 95,
  confidence: 0.9,
  explanation: 'good',
  factors: ['enough data'],
  insufficientDataReasons: [],
};

const AFFORDABILITY: MoneyAffordability = {
  safeToSpendToday: 120,
  safeToSpendThisWeek: 460,
  safeToSpendThisMonth: 900,
  safeToSpendUntilNextIncome: 780,
  nextIncomeDate: '2026-03-28T12:00:00.000Z',
  incomeCadenceReliable: true,
  dailyEssentialSpend: 42,
  confidence: 0.84,
  explanation: 'deterministic',
  factors: ['coverage', 'income cadence'],
};

const FORECAST: MoneyMonthlySurvivalForecast = {
  projectedIncome30d: 2400,
  projectedBills30d: 1100,
  projectedVariableSpend30d: 720,
  projectedEndBalance30d: 1280,
  estimatedRunwayDays: null,
  status: 'safe',
  confidence: 0.8,
  explanation: 'forecast safe',
  factors: ['income > bills'],
};

test('detectors produce recurring, trial, refund, split, affordability, and bill actions with dedup keys', () => {
  const transactions: MoneyTransactionInput[] = [
    tx({ id: 'netflix_1', merchant: 'Netflix', amount: 18, category: 'subscription', daysAgo: 61 }),
    tx({ id: 'netflix_2', merchant: 'Netflix', amount: 18, category: 'subscription', daysAgo: 31 }),
    tx({ id: 'netflix_3', merchant: 'Netflix', amount: 18, category: 'subscription', daysAgo: 1 }),
    tx({ id: 'trial_small', merchant: 'Music App', amount: 1.99, category: 'trial', daysAgo: 52 }),
    tx({ id: 'trial_large', merchant: 'Music App', amount: 19.99, category: 'subscription', daysAgo: 24 }),
    tx({ id: 'refund', merchant: 'Shop Co', amount: -42, category: 'refund', daysAgo: 5 }),
    tx({ id: 'split_bill', merchant: 'City Utilities', amount: 130, category: 'utilities', daysAgo: 2 }),
    tx({ id: 'uncat_1', merchant: 'Campus Cafe', amount: 12, category: 'uncategorized', daysAgo: 3 }),
    tx({ id: 'uncat_2', merchant: 'Campus Cafe', amount: 9, category: 'uncategorized', daysAgo: 8 }),
    tx({ id: 'debt_interest', merchant: 'Student Loan Servicer', amount: 180, category: 'loan payment', daysAgo: 7 }),
  ];

  const recurring: MoneyRecurringInput[] = [
    {
      id: 'sub_1',
      merchant: 'Netflix',
      estimatedMonthlyCost: 18,
      recurrenceInterval: 'monthly',
      confidence: 0.9,
      lastSeen: '2026-03-14T12:00:00.000Z',
      lifecycleStatus: 'confirmed',
    },
    {
      id: 'sub_2',
      merchant: 'Cloud Storage Pro',
      estimatedMonthlyCost: 45,
      recurrenceInterval: 'monthly',
      confidence: 0.88,
      lastSeen: '2026-03-12T12:00:00.000Z',
      lifecycleStatus: 'detected',
    },
  ];

  const billPredictions: MoneyBillPrediction[] = [
    {
      id: 'bill_1',
      merchant: 'Power Co',
      amount: 92,
      dueDate: '2026-03-19T12:00:00.000Z',
      intervalDays: 30,
      source: 'recurrence',
      confidence: 0.82,
      explanation: 'monthly cadence',
      factors: ['3 prior bills'],
    },
  ];

  const categoryRules: MoneyCategoryRule[] = [
    {
      normalizedMerchant: 'campus_cafe',
      learnedCategory: 'food',
      supportCount: 3,
      totalCorrections: 3,
      dominanceRatio: 1,
      confidence: 0.9,
      lastCorrectedAt: NOW_ISO,
      status: 'active',
    },
  ];

  const candidates = detectAutomationCandidates({
    userId: 'user_1',
    nowIso: NOW_ISO,
    transactions,
    recurring,
    categoryRules,
    coverage: COVERAGE,
    affordability: AFFORDABILITY,
    monthlySurvivalForecast: FORECAST,
    billPredictions,
    currency: 'USD',
  });

  const actionTypes = new Set(candidates.map((candidate) => candidate.actionType));

  assert.ok(actionTypes.has('recurring_review'));
  assert.ok(actionTypes.has('trial_conversion_review'));
  assert.ok(actionTypes.has('refund_budget'));
  assert.ok(actionTypes.has('bill_split'));
  assert.ok(actionTypes.has('subscription_cancel'));
  assert.ok(actionTypes.has('subscription_negotiate'));
  assert.ok(actionTypes.has('bill_pay'));
  assert.ok(actionTypes.has('savings_transfer'));
  assert.ok(actionTypes.has('debt_optimize'));
  assert.ok(actionTypes.has('expense_categorization'));

  const dedupSet = new Set(candidates.map((candidate) => candidate.dedupKey));
  assert.equal(dedupSet.size, candidates.length);

  assert.ok(candidates.every((candidate) => candidate.confidence >= 0.3 && candidate.confidence <= 0.98));
});

test('advanced intelligence signals wire into task center detector candidates', () => {
  const transactions: MoneyTransactionInput[] = [
    tx({ id: 'income_1', merchant: 'Payroll', amount: -1400, category: 'payroll', daysAgo: 56 }),
    tx({ id: 'income_2', merchant: 'Payroll', amount: -1450, category: 'payroll', daysAgo: 42 }),
    tx({ id: 'income_3', merchant: 'Payroll', amount: -1425, category: 'payroll', daysAgo: 28 }),
    tx({ id: 'income_4', merchant: 'Payroll', amount: -1475, category: 'payroll', daysAgo: 14 }),
    tx({ id: 'rent', merchant: 'Campus Housing', amount: 820, category: 'housing', daysAgo: 12 }),
    tx({ id: 'grocery', merchant: 'Grocer', amount: 140, category: 'groceries', daysAgo: 3 }),
  ];

  const money = computeMoneyIntelligence({
    walletBalance: 1800,
    currency: 'USD',
    transactions,
    recurring: [
      {
        id: 'rec_1',
        merchant: 'Campus Housing',
        estimatedMonthlyCost: 820,
        recurrenceInterval: 'monthly',
        confidence: 0.9,
        lastSeen: '2026-03-01T00:00:00.000Z',
        lifecycleStatus: 'confirmed',
      },
    ],
    connectedAccounts: [
      { id: 'checking_a', lastSyncedAt: NOW_ISO, type: 'checking', balance: 1800 },
      { id: 'credit_a', lastSyncedAt: NOW_ISO, type: 'credit', balance: -2400 },
      { id: 'loan_a', lastSyncedAt: NOW_ISO, type: 'loan', balance: -6800 },
      { id: 'invest_a', lastSyncedAt: NOW_ISO, type: 'investment', balance: 700 },
    ],
    categoryRules: [],
    nowIso: NOW_ISO,
  });

  const candidates = detectAutomationCandidates({
    userId: 'user_advanced',
    nowIso: NOW_ISO,
    transactions,
    recurring: [],
    categoryRules: [],
    coverage: money.coverage,
    affordability: money.affordability,
    monthlySurvivalForecast: money.monthlySurvivalForecast,
    billPredictions: money.billPredictions,
    advancedIntelligence: money.advancedIntelligence,
    currency: 'USD',
  });

  const advancedCandidates = candidates.filter((candidate) => candidate.payload.source === 'advanced_intelligence');
  assert.ok(advancedCandidates.length >= 1);
  assert.ok(advancedCandidates.some((candidate) => candidate.actionType === 'debt_optimize' || candidate.actionType === 'savings_transfer'));
});
