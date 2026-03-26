import 'server-only';

import type {
  MoneyAdvancedIntelligence,
  MoneyAffordability,
  MoneyBillPrediction,
  MoneyCategoryRule,
  MoneyCoverage,
  MoneyMonthlySurvivalForecast,
  MoneyRecurringInput,
  MoneyTransactionInput,
} from '../moneyIntelligence/types.ts';
import type {
  AutomationActionType,
  AutomationPolicyMode,
} from '../../types.ts';
import type {
  AutomationDetectionCandidate,
  AutomationDetectionContext,
} from './types.ts';

interface DetectionTx {
  id: string;
  merchant: string;
  normalizedMerchant: string;
  amount: number;
  category: string;
  occurredAt: string;
  occurredAtMs: number;
  kind:
    | 'expense'
    | 'income'
    | 'transfer'
    | 'refund'
    | 'reversal'
    | 'credit_payment'
    | 'duplicate'
    | 'pending'
    | 'ignored';
}

export interface AutomationDetectorInput {
  userId: string;
  nowIso: string;
  transactions: MoneyTransactionInput[];
  recurring: MoneyRecurringInput[];
  categoryRules: MoneyCategoryRule[];
  coverage: MoneyCoverage;
  affordability: MoneyAffordability;
  monthlySurvivalForecast: MoneyMonthlySurvivalForecast;
  billPredictions: MoneyBillPrediction[];
  advancedIntelligence?: MoneyAdvancedIntelligence;
  currency: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TRANSFER_KEYWORDS = ['transfer', 'wire', 'ach', 'zelle', 'venmo', 'cash app'];
const REFUND_KEYWORDS = ['refund', 'reimbursement', 'return'];
const REVERSAL_KEYWORDS = ['reversal', 'chargeback', 'dispute'];
const CREDIT_PAYMENT_KEYWORDS = ['credit card payment', 'payment thank you', 'autopay'];
const SPLIT_BILL_KEYWORDS = ['rent', 'utilities', 'internet', 'phone', 'insurance', 'tuition', 'electric', 'water', 'gas'];
const DEBT_KEYWORDS = ['loan', 'interest', 'apr', 'credit card', 'student loan', 'debt'];
const SUBSCRIPTION_HINT_KEYWORDS = ['subscription', 'stream', 'music', 'video', 'cloud', 'membership'];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(haystack: string, needles: string[]): boolean {
  const normalized = normalizeText(haystack);
  return needles.some((needle) => normalized.includes(needle));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function monthWindow(nowIso: string): string {
  return nowIso.slice(0, 7);
}

function weekWindow(nowIso: string): string {
  const nowMs = parseDate(nowIso);
  const week = Math.floor(nowMs / (7 * MS_PER_DAY));
  return `w${week}`;
}

function buildAutomationDedupKey(input: {
  userId: string;
  actionType: AutomationActionType;
  entity: string;
  window: string;
}): string {
  return `${input.userId}:automation:${input.actionType}:${input.entity}:${input.window}:1.0.0`;
}

function applyCoveragePenalty(value: number, coverage: MoneyCoverage): number {
  const penalty = coverage.lowData ? 0.18 : 0;
  const stalePenalty = coverage.connectedAccountCount > 0
    ? (coverage.staleAccountCount / coverage.connectedAccountCount) * 0.14
    : 0.12;
  return Math.max(0.3, Math.min(0.98, value - penalty - stalePenalty));
}

function classifyTransactions(transactions: MoneyTransactionInput[]): DetectionTx[] {
  const rows = transactions.map((tx) => {
    const occurredAtMs = parseDate(tx.occurredAt);
    const merchant = tx.merchantName || tx.normalizedMerchant || 'Unknown merchant';
    const normalizedMerchant = normalizeText(tx.normalizedMerchant || tx.merchantName || 'unknown');
    const amount = Number(tx.amount) || 0;

    const joinedText = `${tx.category} ${merchant} ${tx.normalizedMerchant}`;
    let kind: DetectionTx['kind'] = 'ignored';

    if (tx.pending) {
      kind = 'pending';
    } else if (!Number.isFinite(amount) || amount === 0) {
      kind = 'ignored';
    } else if (includesAny(joinedText, TRANSFER_KEYWORDS)) {
      kind = 'transfer';
    } else if (includesAny(joinedText, CREDIT_PAYMENT_KEYWORDS)) {
      kind = 'credit_payment';
    } else if (amount < 0 && includesAny(joinedText, REFUND_KEYWORDS)) {
      kind = 'refund';
    } else if (amount < 0 && includesAny(joinedText, REVERSAL_KEYWORDS)) {
      kind = 'reversal';
    } else if (amount < 0) {
      kind = 'income';
    } else {
      kind = 'expense';
    }

    return {
      id: tx.id,
      merchant,
      normalizedMerchant,
      amount,
      category: tx.category || 'uncategorized',
      occurredAt: new Date(occurredAtMs).toISOString(),
      occurredAtMs,
      kind,
    } satisfies DetectionTx;
  });

  const sorted = [...rows].sort((a, b) => a.occurredAtMs - b.occurredAtMs);

  const expenses = sorted.filter((tx) => tx.kind === 'expense');
  const credits = sorted.filter((tx) => tx.kind === 'income' || tx.kind === 'refund' || tx.kind === 'reversal');

  for (const credit of credits) {
    if (credit.amount >= 0) continue;
    const paired = expenses.find((expense) => {
      if (expense.normalizedMerchant !== credit.normalizedMerchant) return false;
      if (Math.abs(expense.amount + credit.amount) > 0.01) return false;
      const deltaDays = Math.abs(expense.occurredAtMs - credit.occurredAtMs) / MS_PER_DAY;
      return deltaDays <= 12;
    });
    if (!paired) continue;

    const preferReversal = includesAny(`${credit.category} ${credit.merchant}`, REVERSAL_KEYWORDS);
    credit.kind = preferReversal ? 'reversal' : 'refund';
    paired.kind = preferReversal ? 'reversal' : 'refund';
  }

  const seen = new Map<string, number>();
  for (const tx of sorted) {
    if (tx.kind !== 'expense' && tx.kind !== 'income') continue;
    const key = `${tx.normalizedMerchant}:${Math.abs(tx.amount).toFixed(2)}:${Math.sign(tx.amount)}`;
    const prior = seen.get(key);
    if (typeof prior === 'number' && Math.abs(tx.occurredAtMs - prior) <= MS_PER_DAY) {
      (tx as DetectionTx).kind = 'duplicate';
      continue;
    }
    seen.set(key, tx.occurredAtMs);
  }

  return sorted;
}

interface RecurringPattern {
  merchant: string;
  normalizedMerchant: string;
  meanIntervalDays: number;
  intervalStdDevDays: number;
  estimatedMonthlyCost: number;
  transactionCount: number;
  mostRecentChargeAt: string;
  confidence: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function monthlyCostFromInterval(avgCharge: number, intervalDays: number): number {
  if (intervalDays <= 8) return avgCharge * 4.345;
  if (intervalDays <= 17) return avgCharge * 2.1725;
  if (intervalDays <= 50) return avgCharge;
  if (intervalDays <= 110) return avgCharge / 3;
  return avgCharge / 12;
}

export function detectRecurringChargePatterns(transactions: DetectionTx[]): RecurringPattern[] {
  const spend = transactions
    .filter((tx) => tx.kind === 'expense')
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs);

  const byMerchant = new Map<string, DetectionTx[]>();
  for (const tx of spend) {
    const key = tx.normalizedMerchant;
    const bucket = byMerchant.get(key) || [];
    bucket.push(tx);
    byMerchant.set(key, bucket);
  }

  const patterns: RecurringPattern[] = [];

  for (const [normalizedMerchant, rows] of byMerchant.entries()) {
    if (rows.length < 3) continue;

    const intervals: number[] = [];
    for (let i = 1; i < rows.length; i += 1) {
      intervals.push((rows[i].occurredAtMs - rows[i - 1].occurredAtMs) / MS_PER_DAY);
    }
    if (intervals.length < 2) continue;

    const avgInterval = mean(intervals);
    const intervalDeviation = stdDev(intervals);

    if (avgInterval < 6 || avgInterval > 45) continue;
    if (intervalDeviation > 7.5) continue;

    const avgCharge = mean(rows.map((row) => row.amount));
    const monthly = monthlyCostFromInterval(avgCharge, avgInterval);
    const cadenceConfidence = Math.max(0, 1 - intervalDeviation / Math.max(avgInterval, 1));
    const confidence = Math.min(0.95, 0.55 + cadenceConfidence * 0.25 + Math.min(rows.length, 6) * 0.04);

    patterns.push({
      merchant: rows[rows.length - 1].merchant,
      normalizedMerchant,
      meanIntervalDays: round(avgInterval),
      intervalStdDevDays: round(intervalDeviation),
      estimatedMonthlyCost: round(monthly),
      transactionCount: rows.length,
      mostRecentChargeAt: rows[rows.length - 1].occurredAt,
      confidence: round(confidence),
    });
  }

  return patterns.sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost);
}

interface TrialConversionSignal {
  merchant: string;
  normalizedMerchant: string;
  trialAmount: number;
  convertedAmount: number;
  trialAt: string;
  convertedAt: string;
  confidence: number;
}

export function detectTrialConversions(transactions: DetectionTx[]): TrialConversionSignal[] {
  const spend = transactions.filter((tx) => tx.kind === 'expense').sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  const byMerchant = new Map<string, DetectionTx[]>();

  for (const tx of spend) {
    const key = tx.normalizedMerchant;
    const bucket = byMerchant.get(key) || [];
    bucket.push(tx);
    byMerchant.set(key, bucket);
  }

  const signals: TrialConversionSignal[] = [];

  for (const [normalizedMerchant, rows] of byMerchant.entries()) {
    if (rows.length < 2) continue;

    const trialLike = rows.find((row) => row.amount <= 5 || includesAny(`${row.category} ${row.merchant}`, ['trial', 'intro']));
    if (!trialLike) continue;

    const conversion = rows.find((row) => {
      if (row.occurredAtMs <= trialLike.occurredAtMs) return false;
      if (row.amount < Math.max(8, trialLike.amount * 3)) return false;
      const deltaDays = (row.occurredAtMs - trialLike.occurredAtMs) / MS_PER_DAY;
      return deltaDays >= 5 && deltaDays <= 65;
    });

    if (!conversion) continue;

    const deltaDays = (conversion.occurredAtMs - trialLike.occurredAtMs) / MS_PER_DAY;
    const confidence = Math.min(
      0.95,
      0.58
      + (deltaDays >= 6 && deltaDays <= 40 ? 0.14 : 0)
      + (includesAny(`${conversion.category} ${conversion.merchant}`, SUBSCRIPTION_HINT_KEYWORDS) ? 0.12 : 0)
      + (conversion.amount >= 20 ? 0.08 : 0),
    );

    signals.push({
      merchant: conversion.merchant,
      normalizedMerchant,
      trialAmount: round(trialLike.amount),
      convertedAmount: round(conversion.amount),
      trialAt: trialLike.occurredAt,
      convertedAt: conversion.occurredAt,
      confidence: round(confidence),
    });
  }

  return signals;
}

interface RefundBudgetSignal {
  merchant: string;
  normalizedMerchant: string;
  amount: number;
  occurredAt: string;
  confidence: number;
}

export function detectRefundBudgetFlows(input: {
  transactions: DetectionTx[];
  nowIso: string;
}): RefundBudgetSignal[] {
  const nowMs = parseDate(input.nowIso);
  const lookbackMs = 28 * MS_PER_DAY;

  return input.transactions
    .filter((tx) => tx.kind === 'refund' || tx.kind === 'reversal')
    .filter((tx) => tx.amount < 0)
    .filter((tx) => nowMs - tx.occurredAtMs <= lookbackMs)
    .map((tx) => ({
      merchant: tx.merchant,
      normalizedMerchant: tx.normalizedMerchant,
      amount: round(Math.abs(tx.amount)),
      occurredAt: tx.occurredAt,
      confidence: round(tx.kind === 'reversal' ? 0.74 : 0.68),
    }))
    .sort((a, b) => b.amount - a.amount);
}

interface SplitEligibleBillSignal {
  merchant: string;
  normalizedMerchant: string;
  amount: number;
  category: string;
  occurredAt: string;
  confidence: number;
}

export function detectSplitEligibleBills(input: {
  transactions: DetectionTx[];
  nowIso: string;
}): SplitEligibleBillSignal[] {
  const nowMs = parseDate(input.nowIso);
  const lookbackMs = 40 * MS_PER_DAY;

  return input.transactions
    .filter((tx) => tx.kind === 'expense')
    .filter((tx) => tx.amount >= 40)
    .filter((tx) => nowMs - tx.occurredAtMs <= lookbackMs)
    .filter((tx) => includesAny(`${tx.category} ${tx.merchant}`, SPLIT_BILL_KEYWORDS))
    .map((tx) => ({
      merchant: tx.merchant,
      normalizedMerchant: tx.normalizedMerchant,
      amount: round(tx.amount),
      category: tx.category,
      occurredAt: tx.occurredAt,
      confidence: 0.66,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);
}

function deriveContext(input: AutomationDetectorInput): AutomationDetectionContext {
  return {
    nowIso: input.nowIso,
    transactionCoverageDays: input.coverage.transactionCoverageDays,
    connectedAccountCount: input.coverage.connectedAccountCount,
    staleAccountCount: input.coverage.staleAccountCount,
    lowData: input.coverage.lowData,
    currency: input.currency,
  };
}

function toCandidate(input: {
  userId: string;
  nowIso: string;
  actionType: AutomationActionType;
  title: string;
  summary: string;
  confidence: number;
  coverageConfidence: number;
  factors: string[];
  payload: Record<string, unknown>;
  amount?: number | null;
  currency?: string | null;
  window: string;
  entity: string;
  suggestedPolicy?: AutomationPolicyMode;
}): AutomationDetectionCandidate {
  const confidence = round(Math.max(0.3, Math.min(0.98, input.confidence)));
  const coverageConfidence = round(Math.max(0.3, Math.min(0.98, input.coverageConfidence)));
  return {
    actionType: input.actionType,
    title: input.title,
    summary: input.summary,
    dedupKey: buildAutomationDedupKey({
      userId: input.userId,
      actionType: input.actionType,
      entity: input.entity,
      window: input.window,
    }),
    confidence,
    coverageConfidence,
    explainability: {
      summary: input.summary,
      factors: input.factors,
      confidence,
      coverageConfidence,
    },
    payload: input.payload,
    amount: input.amount ?? null,
    currency: input.currency ?? null,
    suggestedPolicy: input.suggestedPolicy,
    detectedAt: input.nowIso,
  };
}

function detectDebtOptimizationCandidate(input: {
  transactions: DetectionTx[];
  context: AutomationDetectionContext;
  userId: string;
}): AutomationDetectionCandidate[] {
  const debtSpend = input.transactions
    .filter((tx) => tx.kind === 'expense')
    .filter((tx) => includesAny(`${tx.category} ${tx.merchant}`, DEBT_KEYWORDS));

  const total = round(debtSpend.reduce((sum, tx) => sum + tx.amount, 0));
  if (total < 120) return [];

  const confidence = applyCoveragePenalty(0.71, {
    connectedAccountCount: input.context.connectedAccountCount,
    staleAccountCount: input.context.staleAccountCount,
    lowData: input.context.lowData,
    transactionCoverageDays: input.context.transactionCoverageDays,
    sourceState: 'synced',
    insufficientDataReasons: [],
    confidence: 0.7,
    explanation: '',
    factors: [],
  });

  return [
    toCandidate({
      userId: input.userId,
      nowIso: input.context.nowIso,
      actionType: 'debt_optimize',
      title: 'Optimize debt payments',
      summary: `Detected ${total.toFixed(2)} in likely debt-related payments. Consider re-ordering payoff for lower interest cost.`,
      confidence,
      coverageConfidence: confidence,
      factors: [
        `${debtSpend.length} debt-related charge(s) detected.`,
        `Estimated monthly debt outflow: ${total.toFixed(2)} ${input.context.currency}.`,
      ],
      payload: {
        estimatedMonthlyDebtOutflow: total,
        debtChargeCount: debtSpend.length,
      },
      amount: total,
      currency: input.context.currency,
      window: monthWindow(input.context.nowIso),
      entity: 'debt_optimize',
      suggestedPolicy: 'user_confirm_required',
    }),
  ];
}

function detectExpenseCategorizationCandidate(input: {
  transactions: DetectionTx[];
  categoryRules: MoneyCategoryRule[];
  context: AutomationDetectionContext;
  userId: string;
}): AutomationDetectionCandidate[] {
  const uncategorized = input.transactions.filter((tx) => tx.kind === 'expense' && normalizeText(tx.category) === 'uncategorized');
  if (uncategorized.length === 0) return [];

  const activeRules = input.categoryRules.filter((rule) => rule.status === 'active' && rule.confidence >= 0.7);
  if (activeRules.length === 0) return [];

  const byMerchant = new Map(activeRules.map((rule) => [normalizeText(rule.normalizedMerchant), rule]));
  const impacted = uncategorized.filter((tx) => byMerchant.has(tx.normalizedMerchant));
  if (impacted.length < 2) return [];

  const confidence = applyCoveragePenalty(0.8, {
    connectedAccountCount: input.context.connectedAccountCount,
    staleAccountCount: input.context.staleAccountCount,
    lowData: input.context.lowData,
    transactionCoverageDays: input.context.transactionCoverageDays,
    sourceState: 'synced',
    insufficientDataReasons: [],
    confidence: 0.8,
    explanation: '',
    factors: [],
  });

  return [
    toCandidate({
      userId: input.userId,
      nowIso: input.context.nowIso,
      actionType: 'expense_categorization',
      title: 'Auto-categorize uncategorized spending',
      summary: `${impacted.length} uncategorized transactions match learned category rules from prior corrections.`,
      confidence,
      coverageConfidence: confidence,
      factors: [
        `${activeRules.length} active learned merchant rules available.`,
        `${impacted.length} transactions can be categorized deterministically.`,
      ],
      payload: {
        impactedTransactionIds: impacted.map((tx) => tx.id),
        impactedMerchants: [...new Set(impacted.map((tx) => tx.normalizedMerchant))],
      },
      window: weekWindow(input.context.nowIso),
      entity: `expense_categorization:${impacted.length}`,
      suggestedPolicy: 'autopilot_allowed',
    }),
  ];
}

function detectAdvancedIntelligenceCandidates(input: {
  advancedIntelligence: MoneyAdvancedIntelligence | undefined;
  affordability: MoneyAffordability;
  coverage: MoneyCoverage;
  context: AutomationDetectionContext;
  userId: string;
}): AutomationDetectionCandidate[] {
  if (!input.advancedIntelligence) return [];
  const advanced = input.advancedIntelligence;
  const candidates: AutomationDetectionCandidate[] = [];

  if (
    advanced.creditUtilizationOptimizer.status !== 'manual'
    && advanced.creditUtilizationOptimizer.paymentToReachSafeUtilization >= 40
  ) {
    const confidence = applyCoveragePenalty(
      (advanced.creditUtilizationOptimizer.confidence + advanced.debtPayoffSimulator.confidence) / 2,
      input.coverage,
    );
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.context.nowIso,
        actionType: 'debt_optimize',
        title: 'Reduce credit utilization risk',
        summary: `Estimated utilization is ${Math.round((advanced.creditUtilizationOptimizer.utilizationRatio || 0) * 100)}%. A safer payment target is ${advanced.creditUtilizationOptimizer.recommendedPaymentThisMonth.toFixed(2)} this month.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Payment to reach <=30% utilization: ${advanced.creditUtilizationOptimizer.paymentToReachSafeUtilization.toFixed(2)}.`,
          `Recommended payoff strategy: ${advanced.debtPayoffSimulator.recommendedStrategy}.`,
          'Recommendation only: no payment is executed without explicit confirmation controls.',
        ],
        payload: {
          source: 'advanced_intelligence',
          utilizationRatio: advanced.creditUtilizationOptimizer.utilizationRatio,
          paymentToSafeUtilization: advanced.creditUtilizationOptimizer.paymentToReachSafeUtilization,
          recommendedPaymentThisMonth: advanced.creditUtilizationOptimizer.recommendedPaymentThisMonth,
          recommendedDebtStrategy: advanced.debtPayoffSimulator.recommendedStrategy,
        },
        amount: advanced.creditUtilizationOptimizer.recommendedPaymentThisMonth,
        currency: input.context.currency,
        window: monthWindow(input.context.nowIso),
        entity: 'debt_optimize',
        suggestedPolicy: 'user_confirm_required',
      }),
    );
  }

  if (
    advanced.lifeGoalPlanning.recommendedContributionNow >= 30
    && advanced.financialStressDetection.status !== 'critical'
    && advanced.financialStressDetection.status !== 'high'
    && input.affordability.safeToSpendThisMonth >= advanced.lifeGoalPlanning.recommendedContributionNow
  ) {
    const confidence = applyCoveragePenalty(
      (advanced.lifeGoalPlanning.confidence + advanced.financialRiskScoring.confidence) / 2,
      input.coverage,
    );
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.context.nowIso,
        actionType: 'savings_transfer',
        title: 'Set aside goal contribution',
        summary: `Advanced planning suggests ${advanced.lifeGoalPlanning.recommendedContributionNow.toFixed(2)} this month without breaking safe-to-spend guardrails.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Monthly contribution capacity: ${advanced.lifeGoalPlanning.monthlyContributionCapacity.toFixed(2)}.`,
          `Current stress status: ${advanced.financialStressDetection.status}.`,
          `Safe-to-spend this month: ${input.affordability.safeToSpendThisMonth.toFixed(2)}.`,
        ],
        payload: {
          source: 'advanced_intelligence',
          recommendedContributionNow: advanced.lifeGoalPlanning.recommendedContributionNow,
          monthlyContributionCapacity: advanced.lifeGoalPlanning.monthlyContributionCapacity,
          stressStatus: advanced.financialStressDetection.status,
        },
        amount: advanced.lifeGoalPlanning.recommendedContributionNow,
        currency: input.context.currency,
        window: weekWindow(input.context.nowIso),
        entity: 'savings_transfer',
        suggestedPolicy: 'user_confirm_required',
      }),
    );
  }

  return candidates;
}

// ── Phase 3 Detectors ──────────────────────────────────────────────────────

function detectSpendingGuardrails(input: {
  transactions: DetectionTx[];
  coverage: MoneyCoverage;
  context: AutomationDetectionContext;
  userId: string;
  currency: string;
}): AutomationDetectionCandidate[] {
  const nowMs = parseDate(input.context.nowIso);
  const candidates: AutomationDetectionCandidate[] = [];

  // Group expenses by category and month
  const expenseTxs = input.transactions.filter((tx) => tx.kind === 'expense');
  const byCategory = new Map<string, DetectionTx[]>();
  for (const tx of expenseTxs) {
    const cat = normalizeText(tx.category);
    const bucket = byCategory.get(cat) || [];
    bucket.push(tx);
    byCategory.set(cat, bucket);
  }

  const currentMonth = input.context.nowIso.slice(0, 7);

  for (const [category, txs] of byCategory.entries()) {
    if (category === 'uncategorized') continue;

    // Get per-month totals for prior 3 months
    const monthTotals = new Map<string, number>();
    for (const tx of txs) {
      const m = tx.occurredAt.slice(0, 7);
      monthTotals.set(m, (monthTotals.get(m) || 0) + tx.amount);
    }

    const priorMonths = [...monthTotals.entries()]
      .filter(([m]) => m < currentMonth)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 3);

    if (priorMonths.length < 2) continue;

    const priorAvg = mean(priorMonths.map(([, total]) => total));
    const currentTotal = monthTotals.get(currentMonth) || 0;

    if (priorAvg > 0 && currentTotal > priorAvg * 1.5) {
      const confidence = applyCoveragePenalty(0.72, input.coverage);
      candidates.push(
        toCandidate({
          userId: input.userId,
          nowIso: input.context.nowIso,
          actionType: 'expense_categorization',
          title: `Spending guardrail: ${category} over 1.5x average`,
          summary: `${category} spending this month (${currentTotal.toFixed(2)}) exceeds 1.5x the ${priorMonths.length}-month average of ${priorAvg.toFixed(2)}.`,
          confidence,
          coverageConfidence: input.coverage.confidence,
          factors: [
            `Current month spend: ${currentTotal.toFixed(2)} ${input.currency}.`,
            `Prior ${priorMonths.length}-month average: ${priorAvg.toFixed(2)} ${input.currency}.`,
          ],
          payload: {
            guardrailType: 'category_overspend',
            category,
            currentTotal: round(currentTotal),
            priorAvg: round(priorAvg),
            ratio: round(currentTotal / priorAvg),
          },
          amount: round(currentTotal - priorAvg),
          currency: input.currency,
          window: monthWindow(input.context.nowIso),
          entity: `guardrail:${category}`,
          suggestedPolicy: 'suggest_only',
        }),
      );
    }
  }

  // Daily food spend > $50
  const todayStart = new Date(input.context.nowIso).toISOString().slice(0, 10);
  const foodKeywords = ['food', 'restaurant', 'dining', 'eat', 'cafe', 'coffee', 'fast food', 'delivery', 'doordash', 'uber eats', 'grubhub'];
  const todayFood = expenseTxs
    .filter((tx) => tx.occurredAt.slice(0, 10) === todayStart)
    .filter((tx) => includesAny(`${tx.category} ${tx.merchant}`, foodKeywords));
  const todayFoodTotal = todayFood.reduce((sum, tx) => sum + tx.amount, 0);

  if (todayFoodTotal > 50) {
    const confidence = applyCoveragePenalty(0.68, input.coverage);
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.context.nowIso,
        actionType: 'expense_categorization',
        title: 'Daily food spend exceeds $50',
        summary: `Food spending today (${todayFoodTotal.toFixed(2)}) is above the $50 guardrail.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Food spend today: ${todayFoodTotal.toFixed(2)} ${input.currency}.`,
          `${todayFood.length} food-related transaction(s) today.`,
        ],
        payload: {
          guardrailType: 'daily_food_overspend',
          todayFoodTotal: round(todayFoodTotal),
          foodTransactionCount: todayFood.length,
        },
        amount: round(todayFoodTotal),
        currency: input.currency,
        window: `${todayStart}:food`,
        entity: 'guardrail:daily_food',
        suggestedPolicy: 'suggest_only',
      }),
    );
  }

  // Weekly discretionary > $300
  const weekStart = nowMs - 7 * MS_PER_DAY;
  const discretionaryKeywords = ['shopping', 'entertainment', 'dining', 'restaurant', 'clothing', 'electronics', 'hobby', 'gaming'];
  const weekDiscretionary = expenseTxs
    .filter((tx) => tx.occurredAtMs >= weekStart)
    .filter((tx) => includesAny(`${tx.category} ${tx.merchant}`, discretionaryKeywords));
  const weekDiscTotal = weekDiscretionary.reduce((sum, tx) => sum + tx.amount, 0);

  if (weekDiscTotal > 300) {
    const confidence = applyCoveragePenalty(0.66, input.coverage);
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.context.nowIso,
        actionType: 'expense_categorization',
        title: 'Weekly discretionary spend exceeds $300',
        summary: `Discretionary spending this week (${weekDiscTotal.toFixed(2)}) is above the $300 guardrail.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Discretionary spend this week: ${weekDiscTotal.toFixed(2)} ${input.currency}.`,
          `${weekDiscretionary.length} discretionary transaction(s) this week.`,
        ],
        payload: {
          guardrailType: 'weekly_discretionary_overspend',
          weekDiscretionaryTotal: round(weekDiscTotal),
          discretionaryCount: weekDiscretionary.length,
        },
        amount: round(weekDiscTotal),
        currency: input.currency,
        window: weekWindow(input.context.nowIso),
        entity: 'guardrail:weekly_discretionary',
        suggestedPolicy: 'suggest_only',
      }),
    );
  }

  return candidates.slice(0, 3);
}

function detectAutoSavingsOpportunity(input: {
  transactions: DetectionTx[];
  affordability: MoneyAffordability;
  coverage: MoneyCoverage;
  monthlySurvivalForecast: MoneyMonthlySurvivalForecast;
  billPredictions: MoneyBillPrediction[];
  context: AutomationDetectionContext;
  userId: string;
  currency: string;
}): AutomationDetectionCandidate[] {
  const candidates: AutomationDetectionCandidate[] = [];
  const nowMs = parseDate(input.context.nowIso);

  // Estimate monthly bills total from predictions
  const monthlyBills = input.billPredictions.reduce((sum, bill) => sum + bill.amount, 0);
  const buffer = 200;
  const walletBalance = input.affordability.safeToSpendThisMonth + monthlyBills;
  const surplus = walletBalance - monthlyBills - buffer;

  if (surplus > 50) {
    const transferAmount = round(Math.min(surplus * 0.6, surplus));
    const confidence = applyCoveragePenalty(0.7, input.coverage);
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.context.nowIso,
        actionType: 'savings_transfer',
        title: 'Surplus balance detected',
        summary: `Balance exceeds monthly bills + $200 buffer by ${surplus.toFixed(2)}. Consider moving ${transferAmount.toFixed(2)} to savings.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Estimated surplus above bills + buffer: ${surplus.toFixed(2)} ${input.currency}.`,
          `Suggested transfer: ${transferAmount.toFixed(2)} ${input.currency}.`,
        ],
        payload: {
          source: 'auto_savings_surplus',
          surplus: round(surplus),
          proposedTransferAmount: transferAmount,
          estimatedMonthlyBills: round(monthlyBills),
        },
        amount: transferAmount,
        currency: input.currency,
        window: weekWindow(input.context.nowIso),
        entity: 'savings_surplus',
        suggestedPolicy: 'user_confirm_required',
      }),
    );
  }

  // If current week spend is < 70% of average weekly spend, suggest saving difference
  const weekMs = 7 * MS_PER_DAY;
  const expenses = input.transactions.filter((tx) => tx.kind === 'expense');
  const currentWeekStart = nowMs - weekMs;
  const currentWeekSpend = expenses
    .filter((tx) => tx.occurredAtMs >= currentWeekStart)
    .reduce((sum, tx) => sum + tx.amount, 0);

  // Calculate average weekly spend over prior 4 weeks
  const priorWeekSpends: number[] = [];
  for (let w = 1; w <= 4; w++) {
    const wStart = nowMs - (w + 1) * weekMs;
    const wEnd = nowMs - w * weekMs;
    const wSpend = expenses
      .filter((tx) => tx.occurredAtMs >= wStart && tx.occurredAtMs < wEnd)
      .reduce((sum, tx) => sum + tx.amount, 0);
    if (wSpend > 0) priorWeekSpends.push(wSpend);
  }

  if (priorWeekSpends.length >= 2) {
    const avgWeeklySpend = mean(priorWeekSpends);
    if (avgWeeklySpend > 0 && currentWeekSpend < avgWeeklySpend * 0.7) {
      const savingsOpportunity = round(avgWeeklySpend - currentWeekSpend);
      if (savingsOpportunity >= 20) {
        const confidence = applyCoveragePenalty(0.65, input.coverage);
        candidates.push(
          toCandidate({
            userId: input.userId,
            nowIso: input.context.nowIso,
            actionType: 'savings_transfer',
            title: 'Low-spend week savings opportunity',
            summary: `This week's spend (${currentWeekSpend.toFixed(2)}) is under 70% of your average (${avgWeeklySpend.toFixed(2)}). Save the difference of ${savingsOpportunity.toFixed(2)}.`,
            confidence,
            coverageConfidence: input.coverage.confidence,
            factors: [
              `Current week spend: ${currentWeekSpend.toFixed(2)} ${input.currency}.`,
              `Average weekly spend: ${avgWeeklySpend.toFixed(2)} ${input.currency}.`,
            ],
            payload: {
              source: 'auto_savings_low_spend_week',
              currentWeekSpend: round(currentWeekSpend),
              avgWeeklySpend: round(avgWeeklySpend),
              proposedTransferAmount: savingsOpportunity,
            },
            amount: savingsOpportunity,
            currency: input.currency,
            window: weekWindow(input.context.nowIso),
            entity: 'savings_low_week',
            suggestedPolicy: 'user_confirm_required',
          }),
        );
      }
    }
  }

  return candidates;
}

function detectPaydayPattern(input: {
  transactions: DetectionTx[];
  coverage: MoneyCoverage;
  context: AutomationDetectionContext;
  userId: string;
  currency: string;
}): AutomationDetectionCandidate[] {
  const candidates: AutomationDetectionCandidate[] = [];

  // Look for large credits (>$500) that recur monthly within a 3-day window
  const credits = input.transactions
    .filter((tx) => tx.kind === 'income' && Math.abs(tx.amount) >= 500)
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs);

  // Group by similar amount (within 10%) and merchant
  const bySource = new Map<string, DetectionTx[]>();
  for (const tx of credits) {
    const key = tx.normalizedMerchant;
    const bucket = bySource.get(key) || [];
    bucket.push(tx);
    bySource.set(key, bucket);
  }

  for (const [source, txs] of bySource.entries()) {
    if (txs.length < 2) continue;

    // Check if they fall within a 3-day window of the same day-of-month
    const daysOfMonth = txs.map((tx) => new Date(tx.occurredAtMs).getDate());
    const refDay = daysOfMonth[0];
    const allWithin3Days = daysOfMonth.every((d) => Math.abs(d - refDay) <= 3 || Math.abs(d - refDay) >= 28);

    if (!allWithin3Days) continue;

    // Check intervals are roughly monthly (25-35 days)
    const intervals: number[] = [];
    for (let i = 1; i < txs.length; i++) {
      intervals.push((txs[i].occurredAtMs - txs[i - 1].occurredAtMs) / MS_PER_DAY);
    }
    const allMonthly = intervals.every((d) => d >= 25 && d <= 35);
    if (!allMonthly) continue;

    const avgAmount = round(mean(txs.map((tx) => Math.abs(tx.amount))));
    const suggestedSplit = round(avgAmount * 0.2);
    const confidence = applyCoveragePenalty(0.74, input.coverage);

    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.context.nowIso,
        actionType: 'savings_transfer',
        title: `Payday detected from ${txs[0].merchant}`,
        summary: `Recurring income of ~${avgAmount.toFixed(2)} detected monthly. Consider allocating ${suggestedSplit.toFixed(2)} to savings on each payday.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `${txs.length} monthly income transactions from ${txs[0].merchant}.`,
          `Average amount: ${avgAmount.toFixed(2)} ${input.currency}.`,
          `Suggested split allocation: ${suggestedSplit.toFixed(2)} ${input.currency} (20%).`,
        ],
        payload: {
          source: 'payday_pattern',
          merchant: txs[0].merchant,
          avgAmount,
          dayOfMonth: refDay,
          occurrences: txs.length,
          suggestedSplitAmount: suggestedSplit,
        },
        amount: suggestedSplit,
        currency: input.currency,
        window: monthWindow(input.context.nowIso),
        entity: `payday:${source}`,
        suggestedPolicy: 'user_confirm_required',
      }),
    );
  }

  return candidates.slice(0, 2);
}

function detectDebtOptimizationOpportunity(input: {
  transactions: DetectionTx[];
  affordability: MoneyAffordability;
  coverage: MoneyCoverage;
  context: AutomationDetectionContext;
  userId: string;
  currency: string;
}): AutomationDetectionCandidate[] {
  const candidates: AutomationDetectionCandidate[] = [];

  // Estimate monthly bills from credit payment transactions
  const creditPayments = input.transactions
    .filter((tx) => tx.kind === 'credit_payment' || includesAny(`${tx.category} ${tx.merchant}`, CREDIT_PAYMENT_KEYWORDS));
  const totalCreditPayments = creditPayments.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  if (totalCreditPayments <= 0) return candidates;

  // If there's surplus cash after bills + buffer, suggest extra debt payment
  const buffer = 200;
  const availableSurplus = input.affordability.safeToSpendThisMonth - buffer;

  if (availableSurplus > 50 && totalCreditPayments > 100) {
    const extraPayment = round(Math.min(availableSurplus * 0.4, availableSurplus));
    const confidence = applyCoveragePenalty(0.68, input.coverage);

    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.context.nowIso,
        actionType: 'debt_optimize',
        title: 'Extra debt payment opportunity',
        summary: `You have ${availableSurplus.toFixed(2)} surplus this month. Consider an extra payment of ${extraPayment.toFixed(2)} toward credit card debt.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Monthly credit card payments detected: ${totalCreditPayments.toFixed(2)} ${input.currency}.`,
          `Available surplus after buffer: ${availableSurplus.toFixed(2)} ${input.currency}.`,
        ],
        payload: {
          source: 'debt_optimization_surplus',
          totalCreditPayments: round(totalCreditPayments),
          availableSurplus: round(availableSurplus),
          suggestedExtraPayment: extraPayment,
        },
        amount: extraPayment,
        currency: input.currency,
        window: monthWindow(input.context.nowIso),
        entity: 'debt_extra_payment',
        suggestedPolicy: 'user_confirm_required',
      }),
    );
  }

  return candidates;
}

function detectRiskProtection(input: {
  transactions: DetectionTx[];
  coverage: MoneyCoverage;
  context: AutomationDetectionContext;
  userId: string;
  currency: string;
}): AutomationDetectionCandidate[] {
  const candidates: AutomationDetectionCandidate[] = [];
  const expenses = input.transactions.filter((tx) => tx.kind === 'expense');

  // Build per-merchant statistics
  const merchantStats = new Map<string, { amounts: number[]; count: number }>();
  for (const tx of expenses) {
    const key = tx.normalizedMerchant;
    const stats = merchantStats.get(key) || { amounts: [], count: 0 };
    stats.amounts.push(tx.amount);
    stats.count += 1;
    merchantStats.set(key, stats);
  }

  // Flag unusual amounts for known merchants (>2x the average)
  for (const tx of expenses) {
    const stats = merchantStats.get(tx.normalizedMerchant);
    if (!stats || stats.count < 3) continue;

    const avgAmount = mean(stats.amounts);
    if (avgAmount <= 0) continue;

    if (tx.amount > avgAmount * 2 && tx.amount > 30) {
      const confidence = applyCoveragePenalty(0.7, input.coverage);
      candidates.push(
        toCandidate({
          userId: input.userId,
          nowIso: input.context.nowIso,
          actionType: 'recurring_review',
          title: `Unusual charge at ${tx.merchant}`,
          summary: `Charge of ${tx.amount.toFixed(2)} is over 2x the average (${avgAmount.toFixed(2)}) for ${tx.merchant}. Please verify.`,
          confidence,
          coverageConfidence: input.coverage.confidence,
          factors: [
            `Charge amount: ${tx.amount.toFixed(2)} ${input.currency}.`,
            `Merchant average: ${avgAmount.toFixed(2)} ${input.currency} over ${stats.count} transactions.`,
          ],
          payload: {
            riskType: 'unusual_amount',
            transactionId: tx.id,
            merchant: tx.merchant,
            chargeAmount: round(tx.amount),
            merchantAverage: round(avgAmount),
          },
          amount: round(tx.amount),
          currency: input.currency,
          window: weekWindow(input.context.nowIso),
          entity: `risk:${tx.id}`,
          suggestedPolicy: 'suggest_only',
        }),
      );
    }
  }

  // Flag unknown merchants with high amounts (>$200, seen only once)
  const nowMs = parseDate(input.context.nowIso);
  const recentExpenses = expenses.filter((tx) => nowMs - tx.occurredAtMs <= 14 * MS_PER_DAY);

  for (const tx of recentExpenses) {
    const stats = merchantStats.get(tx.normalizedMerchant);
    if (!stats || stats.count > 1) continue;

    if (tx.amount >= 200) {
      const confidence = applyCoveragePenalty(0.64, input.coverage);
      candidates.push(
        toCandidate({
          userId: input.userId,
          nowIso: input.context.nowIso,
          actionType: 'recurring_review',
          title: `New high-value merchant: ${tx.merchant}`,
          summary: `First-time charge of ${tx.amount.toFixed(2)} from ${tx.merchant}. Review to confirm this is legitimate.`,
          confidence,
          coverageConfidence: input.coverage.confidence,
          factors: [
            `First transaction from this merchant.`,
            `Amount: ${tx.amount.toFixed(2)} ${input.currency} exceeds $200 threshold.`,
          ],
          payload: {
            riskType: 'unknown_merchant_high_amount',
            transactionId: tx.id,
            merchant: tx.merchant,
            chargeAmount: round(tx.amount),
          },
          amount: round(tx.amount),
          currency: input.currency,
          window: weekWindow(input.context.nowIso),
          entity: `risk:unknown:${tx.id}`,
          suggestedPolicy: 'suggest_only',
        }),
      );
    }
  }

  return candidates.slice(0, 4);
}

export function detectAutomationCandidates(input: AutomationDetectorInput): AutomationDetectionCandidate[] {
  const context = deriveContext(input);
  const classified = classifyTransactions(input.transactions);
  const windowMonth = monthWindow(input.nowIso);

  const recurringPatterns = detectRecurringChargePatterns(classified);
  const trialSignals = detectTrialConversions(classified);
  const refundSignals = detectRefundBudgetFlows({ transactions: classified, nowIso: input.nowIso });
  const splitSignals = detectSplitEligibleBills({ transactions: classified, nowIso: input.nowIso });

  const candidates: AutomationDetectionCandidate[] = [];

  for (const pattern of recurringPatterns.slice(0, 4)) {
    const confidence = applyCoveragePenalty(pattern.confidence, input.coverage);
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.nowIso,
        actionType: 'recurring_review',
        title: `Recurring charge detected: ${pattern.merchant}`,
        summary: `${pattern.transactionCount} charges around every ${pattern.meanIntervalDays} days (~${pattern.estimatedMonthlyCost.toFixed(2)}/month).`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Mean interval ${pattern.meanIntervalDays} days (std dev ${pattern.intervalStdDevDays}).`,
          `${pattern.transactionCount} matched charges for ${pattern.merchant}.`,
        ],
        payload: {
          normalizedMerchant: pattern.normalizedMerchant,
          estimatedMonthlyCost: pattern.estimatedMonthlyCost,
          meanIntervalDays: pattern.meanIntervalDays,
          transactionCount: pattern.transactionCount,
          mostRecentChargeAt: pattern.mostRecentChargeAt,
        },
        amount: pattern.estimatedMonthlyCost,
        currency: input.currency,
        window: windowMonth,
        entity: pattern.normalizedMerchant,
        suggestedPolicy: 'suggest_only',
      }),
    );
  }

  for (const trial of trialSignals.slice(0, 3)) {
    const confidence = applyCoveragePenalty(trial.confidence, input.coverage);
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.nowIso,
        actionType: 'trial_conversion_review',
        title: `Trial likely converted at ${trial.merchant}`,
        summary: `Charge increased from ${trial.trialAmount.toFixed(2)} to ${trial.convertedAmount.toFixed(2)} after trial period.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Trial charge on ${trial.trialAt.slice(0, 10)} and conversion on ${trial.convertedAt.slice(0, 10)}.`,
          `Amount increased by ${(trial.convertedAmount - trial.trialAmount).toFixed(2)} ${input.currency}.`,
        ],
        payload: {
          normalizedMerchant: trial.normalizedMerchant,
          trialAmount: trial.trialAmount,
          convertedAmount: trial.convertedAmount,
          trialAt: trial.trialAt,
          convertedAt: trial.convertedAt,
        },
        amount: trial.convertedAmount,
        currency: input.currency,
        window: windowMonth,
        entity: trial.normalizedMerchant,
        suggestedPolicy: 'suggest_only',
      }),
    );
  }

  for (const refund of refundSignals.slice(0, 3)) {
    const confidence = applyCoveragePenalty(refund.confidence, input.coverage);
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.nowIso,
        actionType: 'refund_budget',
        title: `Budget your ${refund.merchant} refund`,
        summary: `Refund of ${refund.amount.toFixed(2)} can be routed into goal, emergency buffer, or debt payoff.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Refund posted on ${refund.occurredAt.slice(0, 10)}.`,
          'Refunds are treated separately from true spend to avoid over-allocation.',
        ],
        payload: {
          normalizedMerchant: refund.normalizedMerchant,
          refundAmount: refund.amount,
          occurredAt: refund.occurredAt,
        },
        amount: refund.amount,
        currency: input.currency,
        window: weekWindow(input.nowIso),
        entity: `${refund.normalizedMerchant}:${refund.occurredAt.slice(0, 10)}`,
        suggestedPolicy: 'user_confirm_required',
      }),
    );
  }

  for (const split of splitSignals) {
    const confidence = applyCoveragePenalty(split.confidence, input.coverage);
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.nowIso,
        actionType: 'bill_split',
        title: `Split-eligible bill: ${split.merchant}`,
        summary: `${split.category} bill of ${split.amount.toFixed(2)} appears shareable with roommates or family members.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Detected category ${split.category} with bill-like merchant keyword.`,
          `Recent charge posted on ${split.occurredAt.slice(0, 10)}.`,
        ],
        payload: {
          normalizedMerchant: split.normalizedMerchant,
          amount: split.amount,
          category: split.category,
          occurredAt: split.occurredAt,
        },
        amount: split.amount,
        currency: input.currency,
        window: monthWindow(input.nowIso),
        entity: split.normalizedMerchant,
        suggestedPolicy: 'suggest_only',
      }),
    );
  }

  for (const recurring of input.recurring
    .filter((item) => item.lifecycleStatus !== 'ignored' && item.lifecycleStatus !== 'inactive')
    .sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost)
    .slice(0, 4)) {
    const confidence = applyCoveragePenalty(Math.max(0.55, recurring.confidence), input.coverage);
    if (recurring.estimatedMonthlyCost >= 10) {
      candidates.push(
        toCandidate({
          userId: input.userId,
          nowIso: input.nowIso,
          actionType: 'subscription_cancel',
          title: `One-tap cancel for ${recurring.merchant}`,
          summary: `Recurring spend of ${recurring.estimatedMonthlyCost.toFixed(2)}/month detected for ${recurring.merchant}.`,
          confidence,
          coverageConfidence: input.coverage.confidence,
          factors: [
            `Recurring interval: ${recurring.recurrenceInterval}.`,
            `Last seen charge: ${recurring.lastSeen.slice(0, 10)}.`,
          ],
          payload: {
            subscriptionId: recurring.id,
            lifecycleStatus: recurring.lifecycleStatus || 'detected',
            estimatedMonthlyCost: recurring.estimatedMonthlyCost,
          },
          amount: recurring.estimatedMonthlyCost,
          currency: input.currency,
          window: monthWindow(input.nowIso),
          entity: recurring.merchant.trim().toLowerCase(),
          suggestedPolicy: 'user_confirm_required',
        }),
      );
    }

    if (recurring.estimatedMonthlyCost >= 30) {
      candidates.push(
        toCandidate({
          userId: input.userId,
          nowIso: input.nowIso,
          actionType: 'subscription_negotiate',
          title: `Negotiate ${recurring.merchant} subscription`,
          summary: `High monthly spend (${recurring.estimatedMonthlyCost.toFixed(2)}) may qualify for retention pricing or plan downgrade.`,
          confidence: Math.max(0.45, confidence - 0.04),
          coverageConfidence: input.coverage.confidence,
          factors: [
            `Estimated monthly cost: ${recurring.estimatedMonthlyCost.toFixed(2)} ${input.currency}.`,
            'Negotiation requires explicit user-reviewed outreach flow.',
          ],
          payload: {
            subscriptionId: recurring.id,
            estimatedMonthlyCost: recurring.estimatedMonthlyCost,
          },
          amount: recurring.estimatedMonthlyCost,
          currency: input.currency,
          window: monthWindow(input.nowIso),
          entity: recurring.merchant.trim().toLowerCase(),
          suggestedPolicy: 'user_confirm_required',
        }),
      );
    }
  }

  for (const bill of input.billPredictions
    .filter((item) => {
      const dueMs = parseDate(item.dueDate);
      const nowMs = parseDate(input.nowIso);
      return dueMs >= nowMs && dueMs <= nowMs + 8 * MS_PER_DAY;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3)) {
    const confidence = applyCoveragePenalty(Math.max(0.55, bill.confidence), input.coverage);
    candidates.push(
      toCandidate({
        userId: input.userId,
        nowIso: input.nowIso,
        actionType: 'bill_pay',
        title: `Pay upcoming bill: ${bill.merchant}`,
        summary: `Bill of ${bill.amount.toFixed(2)} due on ${bill.dueDate.slice(0, 10)}.`,
        confidence,
        coverageConfidence: input.coverage.confidence,
        factors: [
          `Predicted due date: ${bill.dueDate.slice(0, 10)}.`,
          `Source: ${bill.source} cadence model (${bill.intervalDays} day interval).`,
        ],
        payload: {
          billPredictionId: bill.id,
          merchant: bill.merchant,
          dueDate: bill.dueDate,
          intervalDays: bill.intervalDays,
        },
        amount: bill.amount,
        currency: input.currency,
        window: weekWindow(input.nowIso),
        entity: bill.id,
        suggestedPolicy: 'user_confirm_required',
      }),
    );
  }

  if (
    !input.coverage.lowData
    && input.monthlySurvivalForecast.status !== 'risk'
    && input.affordability.safeToSpendThisMonth > 60
  ) {
    const transferAmount = round(
      Math.min(
        input.affordability.safeToSpendThisMonth * 0.22,
        Math.max(25, input.affordability.safeToSpendToday * 2),
      ),
    );

    if (transferAmount >= 20) {
      const confidence = applyCoveragePenalty(0.73, input.coverage);
      candidates.push(
        toCandidate({
          userId: input.userId,
          nowIso: input.nowIso,
          actionType: 'savings_transfer',
          title: 'Auto-transfer to savings',
          summary: `Current runway supports a transfer of ${transferAmount.toFixed(2)} without violating safe-to-spend windows.`,
          confidence,
          coverageConfidence: input.coverage.confidence,
          factors: [
            `Safe-to-spend this month: ${input.affordability.safeToSpendThisMonth.toFixed(2)}.`,
            `30-day forecast status: ${input.monthlySurvivalForecast.status}.`,
          ],
          payload: {
            proposedTransferAmount: transferAmount,
            safeToSpendToday: input.affordability.safeToSpendToday,
            safeToSpendThisMonth: input.affordability.safeToSpendThisMonth,
          },
          amount: transferAmount,
          currency: input.currency,
          window: weekWindow(input.nowIso),
          entity: 'savings_transfer',
          suggestedPolicy: 'user_confirm_required',
        }),
      );
    }
  }

  candidates.push(...detectDebtOptimizationCandidate({
    transactions: classified,
    context,
    userId: input.userId,
  }));

  candidates.push(...detectExpenseCategorizationCandidate({
    transactions: classified,
    categoryRules: input.categoryRules,
    context,
    userId: input.userId,
  }));

  candidates.push(...detectAdvancedIntelligenceCandidates({
    advancedIntelligence: input.advancedIntelligence,
    affordability: input.affordability,
    coverage: input.coverage,
    context,
    userId: input.userId,
  }));

  candidates.push(...detectSpendingGuardrails({
    transactions: classified,
    coverage: input.coverage,
    context,
    userId: input.userId,
    currency: input.currency,
  }));

  candidates.push(...detectAutoSavingsOpportunity({
    transactions: classified,
    affordability: input.affordability,
    coverage: input.coverage,
    monthlySurvivalForecast: input.monthlySurvivalForecast,
    billPredictions: input.billPredictions,
    context,
    userId: input.userId,
    currency: input.currency,
  }));

  candidates.push(...detectPaydayPattern({
    transactions: classified,
    coverage: input.coverage,
    context,
    userId: input.userId,
    currency: input.currency,
  }));

  candidates.push(...detectDebtOptimizationOpportunity({
    transactions: classified,
    affordability: input.affordability,
    coverage: input.coverage,
    context,
    userId: input.userId,
    currency: input.currency,
  }));

  candidates.push(...detectRiskProtection({
    transactions: classified,
    coverage: input.coverage,
    context,
    userId: input.userId,
    currency: input.currency,
  }));

  const byDedup = new Map<string, AutomationDetectionCandidate>();
  for (const candidate of candidates) {
    const existing = byDedup.get(candidate.dedupKey);
    if (!existing || candidate.confidence > existing.confidence) {
      byDedup.set(candidate.dedupKey, candidate);
    }
  }

  return [...byDedup.values()].sort((a, b) => b.confidence - a.confidence);
}
