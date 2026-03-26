import 'server-only';

import type {
  MoneyAlert,
  MoneyBillPrediction,
  MoneyCategoryLearningSummary,
  MoneyCategoryRule,
  MoneyConnectedAccountInput,
  MoneyCoverage,
  MoneyIntelligenceResult,
  MoneyMonthlySurvivalForecast,
  MoneyRecurringInput,
  MoneySpendingLimits,
  MoneyStatementAggregation,
  MoneyStudentCard,
  MoneyStudentFocus,
  MoneyStudentInsight,
  MoneySubscriptionTimelineItem,
  MoneyTransactionInput,
  MoneyTransactionKind,
  MoneyWeeklyPrediction,
  MoneyAffordability,
  MoneyNetWorthTracking,
} from './types';
import { buildAdvancedIntelligence } from './advanced.ts';

export interface MoneyIntelligenceInput {
  walletBalance: number;
  currency: string;
  transactions: MoneyTransactionInput[];
  recurring: MoneyRecurringInput[];
  connectedAccounts: MoneyConnectedAccountInput[];
  categoryRules: MoneyCategoryRule[];
  nowIso?: string;
}

interface ClassifiedTx {
  id: string;
  merchant: string;
  normalizedMerchant: string;
  amount: number;
  category: string;
  effectiveCategory: string;
  kind: MoneyTransactionKind;
  pending: boolean;
  occurredAt: string;
  occurredAtMs: number;
}

interface IncomeCadenceInfo {
  reliable: boolean;
  confidence: number;
  nextIncomeDate: string | null;
  projectedIncome30d: number;
  meanIntervalDays: number | null;
}

const ENGINE_VERSION = '1.0.0';
const RULES_VERSION = '1.0.0';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STALE_HOURS = 72;

const TRANSFER_KEYWORDS = [
  'transfer',
  'internal transfer',
  'wire',
  'ach',
  'zelle',
  'venmo',
  'cash app',
];

const CREDIT_PAYMENT_KEYWORDS = [
  'credit card payment',
  'card payment',
  'payment thank you',
  'autopay',
];

const REFUND_KEYWORDS = ['refund', 'reimbursement', 'returned'];
const REVERSAL_KEYWORDS = ['reversal', 'chargeback', 'dispute'];
const STUDENT_REFUND_DEPOSIT_KEYWORDS = [
  'financial aid',
  'student aid',
  'aid disbursement',
  'tuition refund',
  'scholarship',
  'grant',
  'bursar',
  'refund',
];
const STUDENT_P2P_KEYWORDS = ['venmo', 'cash app', 'cashapp', 'zelle', 'paypal'];
const STUDENT_MEAL_KEYWORDS = [
  'meal',
  'dining',
  'restaurant',
  'cafeteria',
  'food',
  'grocer',
  'coffee',
  'snack',
  'campus dining',
];
const STUDENT_DORM_KEYWORDS = [
  'dorm',
  'housing',
  'rent',
  'utility',
  'internet',
  'laundry',
  'campus housing',
  'residence',
];
const STUDENT_RENT_KEYWORDS = ['rent', 'landlord', 'apartment', 'property', 'housing'];
const STUDENT_NIGHTLIFE_KEYWORDS = [
  'bar',
  'club',
  'night',
  'party',
  'drinks',
  'liquor',
  'uber',
  'lyft',
  'entertainment',
];
const STUDENT_INTERNSHIP_KEYWORDS = [
  'payroll',
  'paycheck',
  'direct deposit',
  'stipend',
  'intern',
  'work study',
  'salary',
];
const STUDENT_LOAN_KEYWORDS = [
  'student loan',
  'loan',
  'nelnet',
  'mohela',
  'sallie mae',
  'aidvantage',
  'federal student aid',
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function safeParseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(value: string, keywords: string[]): boolean {
  const normalized = normalizeText(value);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function recurrenceIntervalDays(interval: string): number {
  const normalized = normalizeText(interval);
  if (normalized === 'weekly') return 7;
  if (normalized === 'biweekly') return 14;
  if (normalized === 'quarterly') return 90;
  if (normalized === 'annual' || normalized === 'yearly') return 365;
  return 30;
}

function intervalChargeAmount(monthlyAmount: number, intervalDays: number): number {
  if (intervalDays === 7) return monthlyAmount / 4.345;
  if (intervalDays === 14) return monthlyAmount / 2.1725;
  if (intervalDays === 90) return monthlyAmount * 3;
  if (intervalDays === 365) return monthlyAmount * 12;
  return monthlyAmount;
}

function buildCoverage(input: {
  connectedAccounts: MoneyConnectedAccountInput[];
  settledTransactions: ClassifiedTx[];
  nowMs: number;
}): MoneyCoverage {
  const connectedCount = input.connectedAccounts.length;
  const staleCount = input.connectedAccounts.filter((account) => {
    if (!account.lastSyncedAt) return true;
    const ageHours = (input.nowMs - safeParseDate(account.lastSyncedAt)) / (60 * 60 * 1000);
    return ageHours > STALE_HOURS;
  }).length;

  const settled = input.settledTransactions.filter((tx) => tx.kind !== 'pending');
  const dateValues = settled.map((tx) => tx.occurredAtMs).sort((a, b) => a - b);
  const coverageDays =
    dateValues.length > 1
      ? Math.max(1, Math.round((dateValues[dateValues.length - 1] - dateValues[0]) / MS_PER_DAY))
      : dateValues.length === 1
        ? 1
        : 0;

  const freshRatio = connectedCount > 0 ? (connectedCount - staleCount) / connectedCount : 0;
  const txFactor = clamp(settled.length / 120, 0, 1);
  const accountFactor = connectedCount > 0 ? 1 : 0;
  const coverageConfidence = clamp(
    0.15 + txFactor * 0.45 + freshRatio * 0.25 + accountFactor * 0.15,
    0.05,
    0.98,
  );

  const reasons: string[] = [];
  if (connectedCount === 0) reasons.push('No connected accounts are available yet.');
  if (settled.length < 25) reasons.push(`Only ${settled.length} settled transactions are available.`);
  if (staleCount > 0) reasons.push(`${staleCount} connected account(s) are stale.`);
  if (coverageDays < 30) reasons.push(`Only ${coverageDays} day(s) of transaction coverage are available.`);

  const sourceState = connectedCount > 0 ? 'synced' : 'manual';

  return {
    sourceState,
    lowData: reasons.length > 0,
    staleAccountCount: staleCount,
    connectedAccountCount: connectedCount,
    transactionCoverageDays: coverageDays,
    confidence: round(coverageConfidence),
    explanation: reasons.length === 0
      ? 'Coverage is healthy across account freshness and transaction depth.'
      : 'Coverage is limited; projections are intentionally conservative.',
    factors: [
      `${connectedCount} connected account(s), ${staleCount} stale.`,
      `${settled.length} settled transactions over ${coverageDays} day(s).`,
    ],
    insufficientDataReasons: reasons,
  };
}

function classifyBaseKind(tx: MoneyTransactionInput): MoneyTransactionKind {
  if (tx.pending) return 'pending';
  if (!Number.isFinite(tx.amount) || tx.amount === 0) return 'ignored';

  const category = normalizeText(tx.category);
  const merchant = normalizeText(`${tx.merchantName} ${tx.normalizedMerchant}`);

  if (includesAny(category, TRANSFER_KEYWORDS) || includesAny(merchant, TRANSFER_KEYWORDS)) {
    return 'transfer';
  }

  if (includesAny(category, CREDIT_PAYMENT_KEYWORDS) || includesAny(merchant, CREDIT_PAYMENT_KEYWORDS)) {
    return 'credit_card_payment';
  }

  if (tx.amount < 0 && (includesAny(category, REFUND_KEYWORDS) || includesAny(merchant, REFUND_KEYWORDS))) {
    return 'refund';
  }

  if (tx.amount < 0 && (includesAny(category, REVERSAL_KEYWORDS) || includesAny(merchant, REVERSAL_KEYWORDS))) {
    return 'reversal';
  }

  return tx.amount > 0 ? 'expense' : 'income';
}

function applyCategoryLearning(
  tx: ClassifiedTx,
  rulesByMerchant: Map<string, MoneyCategoryRule>,
): { effectiveCategory: string; applied: boolean } {
  if (tx.kind !== 'expense') {
    return { effectiveCategory: tx.category, applied: false };
  }

  const rule = rulesByMerchant.get(tx.normalizedMerchant);
  if (!rule) return { effectiveCategory: tx.category, applied: false };
  if (rule.status !== 'active' || rule.supportCount < 2 || rule.confidence < 0.7) {
    return { effectiveCategory: tx.category, applied: false };
  }

  if (normalizeText(tx.category) === normalizeText(rule.learnedCategory)) {
    return { effectiveCategory: tx.category, applied: false };
  }

  return { effectiveCategory: rule.learnedCategory, applied: true };
}

function classifyTransactions(input: {
  transactions: MoneyTransactionInput[];
  categoryRules: MoneyCategoryRule[];
}): { classified: ClassifiedTx[]; learningAppliedCount: number } {
  const base = input.transactions.map((tx) => {
    const occurredAtMs = safeParseDate(tx.occurredAt);
    return {
      id: tx.id,
      merchant: tx.merchantName || tx.normalizedMerchant || 'Unknown merchant',
      normalizedMerchant: normalizeText(tx.normalizedMerchant || tx.merchantName || 'unknown'),
      amount: Number(tx.amount) || 0,
      category: tx.category || 'uncategorized',
      effectiveCategory: tx.category || 'uncategorized',
      kind: classifyBaseKind(tx),
      pending: tx.pending,
      occurredAt: new Date(occurredAtMs).toISOString(),
      occurredAtMs,
    } satisfies ClassifiedTx;
  });

  const settled = [...base].sort((a, b) => a.occurredAtMs - b.occurredAtMs);

  const expenses = settled.filter((tx) => tx.kind === 'expense');
  const credits = settled.filter((tx) => tx.kind === 'income' || tx.kind === 'refund' || tx.kind === 'reversal');

  for (const credit of credits) {
    if (credit.amount >= 0) continue;
    const match = expenses.find((expense) => {
      if (expense.normalizedMerchant !== credit.normalizedMerchant) return false;
      if (Math.abs(expense.amount + credit.amount) > 0.01) return false;
      const deltaDays = Math.abs(expense.occurredAtMs - credit.occurredAtMs) / MS_PER_DAY;
      return deltaDays <= 10;
    });
    if (!match) continue;

    const preferReversal =
      includesAny(credit.category, REVERSAL_KEYWORDS)
      || includesAny(credit.merchant, REVERSAL_KEYWORDS);
    credit.kind = preferReversal ? 'reversal' : 'refund';
    match.kind = preferReversal ? 'reversal' : 'refund';
  }

  const seenByKey = new Map<string, number>();
  for (const tx of settled) {
    if (tx.kind !== 'expense' && tx.kind !== 'income') continue;
    const key = `${tx.normalizedMerchant}:${Math.abs(tx.amount).toFixed(2)}:${Math.sign(tx.amount)}`;
    const previous = seenByKey.get(key);
    if (typeof previous === 'number' && Math.abs(tx.occurredAtMs - previous) <= MS_PER_DAY) {
      tx.kind = 'duplicate';
      continue;
    }
    seenByKey.set(key, tx.occurredAtMs);
  }

  const rulesByMerchant = new Map(
    input.categoryRules.map((rule) => [normalizeText(rule.normalizedMerchant), rule]),
  );

  let learningAppliedCount = 0;
  for (const tx of settled) {
    const learning = applyCategoryLearning(tx, rulesByMerchant);
    tx.effectiveCategory = learning.effectiveCategory;
    if (learning.applied) learningAppliedCount += 1;
  }

  return {
    classified: settled,
    learningAppliedCount,
  };
}

function buildStatementAggregation(input: {
  classified: ClassifiedTx[];
  currency: string;
  coverageConfidence: number;
}): MoneyStatementAggregation {
  let trueSpendAmount = 0;
  let trueIncomeAmount = 0;
  let transferAmount = 0;
  let refundAmount = 0;
  let reversalAmount = 0;
  let creditCardPaymentAmount = 0;
  let duplicateAmount = 0;
  let spendTransactions = 0;
  let incomeTransactions = 0;
  let transferTransactions = 0;
  let refundTransactions = 0;
  let reversalTransactions = 0;
  let creditCardPaymentTransactions = 0;
  let duplicateTransactions = 0;
  let pendingTransactions = 0;
  let ignoredTransactions = 0;

  for (const tx of input.classified) {
    if (tx.kind === 'expense') {
      spendTransactions += 1;
      trueSpendAmount += Math.abs(tx.amount);
      continue;
    }
    if (tx.kind === 'income') {
      incomeTransactions += 1;
      trueIncomeAmount += Math.abs(tx.amount);
      continue;
    }
    if (tx.kind === 'transfer') {
      transferTransactions += 1;
      transferAmount += Math.abs(tx.amount);
      continue;
    }
    if (tx.kind === 'refund') {
      refundTransactions += 1;
      refundAmount += Math.abs(tx.amount);
      continue;
    }
    if (tx.kind === 'reversal') {
      reversalTransactions += 1;
      reversalAmount += Math.abs(tx.amount);
      continue;
    }
    if (tx.kind === 'credit_card_payment') {
      creditCardPaymentTransactions += 1;
      creditCardPaymentAmount += Math.abs(tx.amount);
      continue;
    }
    if (tx.kind === 'duplicate') {
      duplicateTransactions += 1;
      duplicateAmount += Math.abs(tx.amount);
      continue;
    }
    if (tx.kind === 'pending') {
      pendingTransactions += 1;
      continue;
    }
    ignoredTransactions += 1;
  }

  const netCashFlow = trueIncomeAmount - trueSpendAmount;

  return {
    currency: input.currency,
    totalTransactions: input.classified.length,
    spendTransactions,
    incomeTransactions,
    transferTransactions,
    refundTransactions,
    reversalTransactions,
    creditCardPaymentTransactions,
    duplicateTransactions,
    pendingTransactions,
    ignoredTransactions,
    trueSpendAmount: round(trueSpendAmount),
    trueIncomeAmount: round(trueIncomeAmount),
    transferAmount: round(transferAmount),
    refundAmount: round(refundAmount),
    reversalAmount: round(reversalAmount),
    creditCardPaymentAmount: round(creditCardPaymentAmount),
    duplicateAmount: round(duplicateAmount),
    netCashFlow: round(netCashFlow),
    confidence: round(input.coverageConfidence),
    explanation: 'Spend totals exclude transfers, refunds, reversals, card payments, and detected duplicates.',
    factors: [
      `${spendTransactions} spend and ${incomeTransactions} income transaction(s) included.`,
      `${transferTransactions + refundTransactions + reversalTransactions + creditCardPaymentTransactions + duplicateTransactions} transaction(s) excluded from true spend.`,
    ],
    classifiedTransactions: input.classified.map((tx) => ({
      id: tx.id,
      kind: tx.kind,
      amount: round(tx.amount),
      category: tx.category,
      effectiveCategory: tx.effectiveCategory,
      occurredAt: tx.occurredAt,
      merchant: tx.merchant,
    })),
  };
}

function buildWeeklyPrediction(input: {
  classified: ClassifiedTx[];
  nowMs: number;
  coverageConfidence: number;
}): MoneyWeeklyPrediction {
  const spendByDay = new Map<string, number>();
  for (const tx of input.classified) {
    if (tx.kind !== 'expense') continue;
    if (tx.occurredAtMs < input.nowMs - 56 * MS_PER_DAY) continue;
    const day = toDateKey(tx.occurredAtMs);
    spendByDay.set(day, (spendByDay.get(day) ?? 0) + Math.abs(tx.amount));
  }

  const today = toDateKey(input.nowMs);
  const orderedDays: string[] = [];
  for (let i = 55; i >= 0; i -= 1) {
    orderedDays.push(toDateKey(input.nowMs - i * MS_PER_DAY));
  }
  const values = orderedDays.map((day) => spendByDay.get(day) ?? 0);

  const recent14 = values.slice(-14);
  const prior42 = values.slice(0, 42);
  const recentAvg = mean(recent14);
  const priorAvg = mean(prior42);
  const predictedDailyBurn = recentAvg * 0.7 + priorAvg * 0.3;
  const observedSpendLast7d = values.slice(-7).reduce((sum, value) => sum + value, 0);
  const predictedSpendNext7d = predictedDailyBurn * 7;
  const daysWithSignals = values.filter((value) => value > 0).length;
  const confidence = clamp(
    (daysWithSignals / 56) * 0.55 + input.coverageConfidence * 0.45,
    0.2,
    0.97,
  );

  return {
    predictedSpendNext7d: round(predictedSpendNext7d),
    predictedDailyBurn: round(predictedDailyBurn),
    observedSpendLast7d: round(observedSpendLast7d),
    confidence: round(confidence),
    explanation: 'Weekly prediction blends recent spending pace with the prior six-week baseline.',
    factors: [
      `Recent 14-day average: ${round(recentAvg)}.`,
      `Signal days in 56-day window: ${daysWithSignals}.`,
      `Reference date: ${today}.`,
    ],
  };
}

function buildIncomeCadence(input: {
  classified: ClassifiedTx[];
  nowMs: number;
}): IncomeCadenceInfo {
  const incomes = input.classified
    .filter((tx) => tx.kind === 'income' && Math.abs(tx.amount) >= 20)
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs);

  if (incomes.length < 3) {
    return {
      reliable: false,
      confidence: 0.25,
      nextIncomeDate: null,
      projectedIncome30d: 0,
      meanIntervalDays: null,
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < incomes.length; i += 1) {
    intervals.push((incomes[i].occurredAtMs - incomes[i - 1].occurredAtMs) / MS_PER_DAY);
  }

  const meanInterval = mean(intervals);
  const cv = meanInterval > 0 ? stdDev(intervals) / meanInterval : 1;
  const reliability = clamp((1 - cv) * Math.min(incomes.length / 8, 1), 0, 0.99);
  const reliable = meanInterval >= 7 && meanInterval <= 45 && cv <= 0.35 && reliability >= 0.6;
  const avgIncome = mean(incomes.map((tx) => Math.abs(tx.amount)));

  if (!reliable) {
    return {
      reliable: false,
      confidence: round(reliability),
      nextIncomeDate: null,
      projectedIncome30d: 0,
      meanIntervalDays: round(meanInterval),
    };
  }

  let nextMs = incomes[incomes.length - 1].occurredAtMs + meanInterval * MS_PER_DAY;
  while (nextMs <= input.nowMs) {
    nextMs += meanInterval * MS_PER_DAY;
  }

  const horizon = input.nowMs + 30 * MS_PER_DAY;
  let projectedIncome30d = 0;
  let cursor = nextMs;
  while (cursor <= horizon) {
    projectedIncome30d += avgIncome;
    cursor += meanInterval * MS_PER_DAY;
  }

  return {
    reliable: true,
    confidence: round(reliability),
    nextIncomeDate: new Date(nextMs).toISOString(),
    projectedIncome30d: round(projectedIncome30d),
    meanIntervalDays: round(meanInterval),
  };
}

function buildBillPredictions(input: {
  recurring: MoneyRecurringInput[];
  nowMs: number;
  coverageConfidence: number;
}): { bills: MoneyBillPrediction[]; projectedBills30d: number } {
  const bills: MoneyBillPrediction[] = [];

  for (const item of input.recurring) {
    const lifecycle = (item.lifecycleStatus || '').toLowerCase();
    if (lifecycle === 'ignored' || lifecycle === 'inactive') continue;
    if (!Number.isFinite(item.estimatedMonthlyCost) || item.estimatedMonthlyCost <= 0) continue;

    const intervalDays = recurrenceIntervalDays(item.recurrenceInterval);
    const chargeAmount = intervalChargeAmount(item.estimatedMonthlyCost, intervalDays);
    let dueMs = safeParseDate(item.lastSeen) + intervalDays * MS_PER_DAY;
    while (dueMs < input.nowMs) {
      dueMs += intervalDays * MS_PER_DAY;
    }

    const horizon45 = input.nowMs + 45 * MS_PER_DAY;
    let step = 0;
    while (dueMs <= horizon45 && step < 3) {
      const confidence = clamp(item.confidence * 0.7 + input.coverageConfidence * 0.3, 0.3, 0.98);
      bills.push({
        id: `${item.id}:${step}`,
        merchant: item.merchant,
        amount: round(chargeAmount),
        dueDate: new Date(dueMs).toISOString(),
        intervalDays,
        source: 'subscription',
        confidence: round(confidence),
        explanation: 'Predicted from recurring cadence and last observed charge date.',
        factors: [
          `Last seen: ${item.lastSeen}.`,
          `Interval: ${intervalDays} day(s).`,
          `Lifecycle: ${item.lifecycleStatus || 'detected'}.`,
        ],
      });
      dueMs += intervalDays * MS_PER_DAY;
      step += 1;
    }
  }

  bills.sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
  const projectedBills30d = bills
    .filter((bill) => Date.parse(bill.dueDate) <= input.nowMs + 30 * MS_PER_DAY)
    .reduce((sum, bill) => sum + bill.amount, 0);

  return { bills, projectedBills30d: round(projectedBills30d) };
}

function buildSpendingLimits(input: {
  classified: ClassifiedTx[];
  walletBalance: number;
  projectedIncome30d: number;
  projectedBills30d: number;
  weeklyPrediction: MoneyWeeklyPrediction;
  coverageConfidence: number;
  nowMs: number;
}): MoneySpendingLimits {
  const lookbackStart = input.nowMs - 90 * MS_PER_DAY;
  const spendByCategory = new Map<string, number>();

  for (const tx of input.classified) {
    if (tx.kind !== 'expense') continue;
    if (tx.occurredAtMs < lookbackStart) continue;
    const key = normalizeText(tx.effectiveCategory || tx.category || 'uncategorized');
    spendByCategory.set(key, (spendByCategory.get(key) ?? 0) + Math.abs(tx.amount));
  }

  const observedDays = 90;
  const categoryBudgets = [...spendByCategory.entries()]
    .map(([category, total]) => {
      const observedMonthlySpend = total * (30 / observedDays);
      const recommendedMonthlyBudget = observedMonthlySpend * 1.12 + 5;
      return {
        category,
        observedMonthlySpend: round(observedMonthlySpend),
        recommendedMonthlyBudget: round(recommendedMonthlyBudget),
      };
    })
    .sort((a, b) => b.observedMonthlySpend - a.observedMonthlySpend)
    .slice(0, 6);

  const disposableMonth = Math.max(
    0,
    input.walletBalance + input.projectedIncome30d - input.projectedBills30d,
  );
  const dailyLimit = disposableMonth / 30;
  const weeklyLimit = dailyLimit * 7;

  return {
    dailyLimit: round(dailyLimit),
    weeklyLimit: round(weeklyLimit),
    monthlyLimit: round(disposableMonth),
    categoryBudgets,
    confidence: round(clamp(input.coverageConfidence * 0.7 + input.weeklyPrediction.confidence * 0.3, 0.25, 0.98)),
    explanation: 'Dynamic limits are based on projected obligations, predicted burn rate, and available liquidity.',
    factors: [
      `Projected income (30d): ${round(input.projectedIncome30d)}.`,
      `Projected bills (30d): ${round(input.projectedBills30d)}.`,
      `Predicted weekly spend: ${input.weeklyPrediction.predictedSpendNext7d}.`,
    ],
  };
}

function buildAffordability(input: {
  walletBalance: number;
  bills: MoneyBillPrediction[];
  spendingLimits: MoneySpendingLimits;
  weeklyPrediction: MoneyWeeklyPrediction;
  incomeCadence: IncomeCadenceInfo;
  nowMs: number;
  coverageConfidence: number;
}): MoneyAffordability {
  const startOfToday = new Date(toDateKey(input.nowMs)).getTime();
  const endOfToday = startOfToday + MS_PER_DAY - 1;
  const endOfWeek = input.nowMs + 7 * MS_PER_DAY;
  const monthEnd = new Date(new Date(input.nowMs).getFullYear(), new Date(input.nowMs).getMonth() + 1, 1).getTime() - 1;

  const dueToday = input.bills
    .filter((bill) => {
      const due = Date.parse(bill.dueDate);
      return due >= startOfToday && due <= endOfToday;
    })
    .reduce((sum, bill) => sum + bill.amount, 0);
  const dueThisWeek = input.bills
    .filter((bill) => Date.parse(bill.dueDate) <= endOfWeek)
    .reduce((sum, bill) => sum + bill.amount, 0);
  const dueThisMonth = input.bills
    .filter((bill) => Date.parse(bill.dueDate) <= monthEnd)
    .reduce((sum, bill) => sum + bill.amount, 0);

  const dailyEssentialSpend = Math.max(
    input.weeklyPrediction.predictedDailyBurn,
    dueToday,
  );

  const safeToSpendToday = Math.max(0, input.walletBalance - dailyEssentialSpend);
  const safeToSpendThisWeek = Math.max(
    0,
    input.walletBalance - dueThisWeek - input.weeklyPrediction.predictedSpendNext7d,
  );

  const daysRemainingInMonth = Math.max(
    1,
    Math.round((monthEnd - input.nowMs) / MS_PER_DAY),
  );
  const expectedVariableMonth = input.weeklyPrediction.predictedDailyBurn * daysRemainingInMonth;
  const safeToSpendThisMonth = Math.max(
    0,
    input.walletBalance - dueThisMonth - expectedVariableMonth,
  );

  let safeToSpendUntilNextIncome: number | null = null;
  if (input.incomeCadence.reliable && input.incomeCadence.nextIncomeDate) {
    const nextIncomeMs = Date.parse(input.incomeCadence.nextIncomeDate);
    const dueUntilIncome = input.bills
      .filter((bill) => Date.parse(bill.dueDate) <= nextIncomeMs)
      .reduce((sum, bill) => sum + bill.amount, 0);
    const daysUntilIncome = Math.max(0, Math.round((nextIncomeMs - input.nowMs) / MS_PER_DAY));
    const variableUntilIncome = input.weeklyPrediction.predictedDailyBurn * daysUntilIncome;
    safeToSpendUntilNextIncome = Math.max(0, input.walletBalance - dueUntilIncome - variableUntilIncome);
  }

  const confidence = clamp(
    input.coverageConfidence * 0.45
      + input.weeklyPrediction.confidence * 0.35
      + input.incomeCadence.confidence * 0.2,
    0.2,
    0.98,
  );

  return {
    safeToSpendToday: round(safeToSpendToday),
    safeToSpendThisWeek: round(safeToSpendThisWeek),
    safeToSpendThisMonth: round(safeToSpendThisMonth),
    safeToSpendUntilNextIncome: safeToSpendUntilNextIncome === null ? null : round(safeToSpendUntilNextIncome),
    nextIncomeDate: input.incomeCadence.nextIncomeDate,
    incomeCadenceReliable: input.incomeCadence.reliable,
    dailyEssentialSpend: round(dailyEssentialSpend),
    confidence: round(confidence),
    explanation: 'Affordability reserves projected bills and baseline variable spend before computing safe amounts.',
    factors: [
      `Due this week: ${round(dueThisWeek)}.`,
      `Predicted weekly spend: ${input.weeklyPrediction.predictedSpendNext7d}.`,
      input.incomeCadence.reliable
        ? `Next income predicted at ${input.incomeCadence.nextIncomeDate}.`
        : 'Income cadence is not reliable enough for pre-payday safe spend.',
    ],
  };
}

function buildMonthlySurvival(input: {
  walletBalance: number;
  projectedIncome30d: number;
  projectedBills30d: number;
  weeklyPrediction: MoneyWeeklyPrediction;
  coverageConfidence: number;
  incomeCadence: IncomeCadenceInfo;
}): MoneyMonthlySurvivalForecast {
  const projectedVariableSpend30d = input.weeklyPrediction.predictedDailyBurn * 30;
  const projectedEndBalance30d =
    input.walletBalance
    + input.projectedIncome30d
    - input.projectedBills30d
    - projectedVariableSpend30d;

  const totalDailyBurn = Math.max(input.weeklyPrediction.predictedDailyBurn, 0);
  const runwayDays = totalDailyBurn > 0
    ? (input.walletBalance + input.projectedIncome30d - input.projectedBills30d) / totalDailyBurn
    : null;

  const status: MoneyMonthlySurvivalForecast['status'] =
    projectedEndBalance30d < 0 || (runwayDays !== null && runwayDays < 14)
      ? 'risk'
      : projectedEndBalance30d < input.walletBalance * 0.2 || (runwayDays !== null && runwayDays < 30)
        ? 'watch'
        : 'safe';

  const confidence = clamp(
    input.coverageConfidence * 0.45
      + input.weeklyPrediction.confidence * 0.35
      + input.incomeCadence.confidence * 0.2,
    0.2,
    0.98,
  );

  return {
    projectedIncome30d: round(input.projectedIncome30d),
    projectedBills30d: round(input.projectedBills30d),
    projectedVariableSpend30d: round(projectedVariableSpend30d),
    projectedEndBalance30d: round(projectedEndBalance30d),
    estimatedRunwayDays: runwayDays === null ? null : Math.max(0, Math.round(runwayDays)),
    status,
    confidence: round(confidence),
    explanation: 'Survival forecast combines projected bills, expected income cadence, and variable spend burn.',
    factors: [
      `Projected end balance (30d): ${round(projectedEndBalance30d)}.`,
      `Projected bills (30d): ${round(input.projectedBills30d)}.`,
      `Projected variable spend (30d): ${round(projectedVariableSpend30d)}.`,
    ],
  };
}

function buildSubscriptionTimeline(input: {
  recurring: MoneyRecurringInput[];
  bills: MoneyBillPrediction[];
  coverageConfidence: number;
}): MoneySubscriptionTimelineItem[] {
  const firstBillByMerchant = new Map<string, MoneyBillPrediction>();
  for (const bill of input.bills) {
    const key = normalizeText(bill.merchant);
    if (!firstBillByMerchant.has(key)) {
      firstBillByMerchant.set(key, bill);
    }
  }

  return input.recurring
    .filter((item) => (item.lifecycleStatus || '').toLowerCase() !== 'ignored')
    .map((item) => {
      const next = firstBillByMerchant.get(normalizeText(item.merchant));
      const confidence = clamp(item.confidence * 0.7 + input.coverageConfidence * 0.3, 0.25, 0.98);
      return {
        id: item.id,
        merchant: item.merchant,
        monthlyCost: round(item.estimatedMonthlyCost),
        lastSeen: item.lastSeen,
        nextExpectedChargeDate: next?.dueDate || null,
        lifecycleStatus: item.lifecycleStatus || 'detected',
        confidence: round(confidence),
        explanation: 'Timeline uses observed recurring cadence and lifecycle state.',
        factors: [
          `Recurrence interval: ${item.recurrenceInterval}.`,
          `Last seen: ${item.lastSeen}.`,
        ],
      };
    })
    .sort((a, b) => {
      const aDate = a.nextExpectedChargeDate ? Date.parse(a.nextExpectedChargeDate) : Number.POSITIVE_INFINITY;
      const bDate = b.nextExpectedChargeDate ? Date.parse(b.nextExpectedChargeDate) : Number.POSITIVE_INFINITY;
      return aDate - bDate;
    });
}

function buildNetWorth(input: {
  walletBalance: number;
  accounts: MoneyConnectedAccountInput[];
  classified: ClassifiedTx[];
  coverageConfidence: number;
  nowMs: number;
}): MoneyNetWorthTracking {
  const knownBalances = input.accounts
    .map((account) => account.balance)
    .filter((balance): balance is number => typeof balance === 'number' && Number.isFinite(balance));

  const assetsFromAccounts = knownBalances.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const liabilitiesFromAccounts = Math.abs(knownBalances.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const assets = input.walletBalance + assetsFromAccounts;
  const liabilities = liabilitiesFromAccounts;
  const trackedNetWorth = assets - liabilities;

  const flowByDate = new Map<string, number>();
  for (const tx of input.classified) {
    if (tx.kind !== 'expense' && tx.kind !== 'income') continue;
    if (tx.occurredAtMs < input.nowMs - 7 * MS_PER_DAY) continue;
    const day = toDateKey(tx.occurredAtMs);
    const net = tx.kind === 'income' ? Math.abs(tx.amount) : -Math.abs(tx.amount);
    flowByDate.set(day, (flowByDate.get(day) ?? 0) + net);
  }

  const trend7d: Array<{ date: string; netWorth: number }> = [];
  let cursorNetWorth = trackedNetWorth;
  for (let i = 0; i < 7; i += 1) {
    const dayMs = input.nowMs - i * MS_PER_DAY;
    const day = toDateKey(dayMs);
    trend7d.push({ date: day, netWorth: round(cursorNetWorth) });
    cursorNetWorth -= flowByDate.get(day) ?? 0;
  }
  trend7d.reverse();

  const delta7d = trend7d.length >= 2
    ? trend7d[trend7d.length - 1].netWorth - trend7d[0].netWorth
    : 0;

  const confidence = clamp(
    input.coverageConfidence * (knownBalances.length > 0 ? 1 : 0.8),
    0.2,
    0.98,
  );

  return {
    trackedNetWorth: round(trackedNetWorth),
    assets: round(assets),
    liabilities: round(liabilities),
    walletBalance: round(input.walletBalance),
    knownAccountCount: knownBalances.length,
    trend7d,
    delta7d: round(delta7d),
    confidence: round(confidence),
    explanation: knownBalances.length > 0
      ? 'Net worth includes wallet balance plus known account balances.'
      : 'Net worth currently uses wallet balance only; external account balances are unavailable.',
    factors: [
      `Known account balances: ${knownBalances.length}.`,
      `7-day net worth delta: ${round(delta7d)}.`,
    ],
  };
}

function buildAlerts(input: {
  classified: ClassifiedTx[];
  nowMs: number;
  limits: MoneySpendingLimits;
  survival: MoneyMonthlySurvivalForecast;
  bills: MoneyBillPrediction[];
  coverage: MoneyCoverage;
}): MoneyAlert[] {
  const todayKey = toDateKey(input.nowMs);
  const weekStartMs = input.nowMs - 7 * MS_PER_DAY;

  const spendToday = input.classified
    .filter((tx) => tx.kind === 'expense' && toDateKey(tx.occurredAtMs) === todayKey)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const spendWeek = input.classified
    .filter((tx) => tx.kind === 'expense' && tx.occurredAtMs >= weekStartMs)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  const alerts: MoneyAlert[] = [];

  if (input.limits.dailyLimit > 0 && spendToday > input.limits.dailyLimit * 1.1) {
    alerts.push({
      id: 'daily_limit',
      severity: 'warning',
      kind: 'daily_limit',
      title: 'Daily spending is above dynamic limit',
      summary: `Spent ${round(spendToday)} today vs dynamic limit ${input.limits.dailyLimit}.`,
      confidence: round(clamp(input.limits.confidence, 0.3, 0.98)),
      explanation: 'Today’s spend exceeded the adaptive daily guardrail.',
      factors: [`Today spend: ${round(spendToday)}.`, `Daily limit: ${input.limits.dailyLimit}.`],
    });
  }

  if (input.limits.weeklyLimit > 0 && spendWeek > input.limits.weeklyLimit * 1.1) {
    alerts.push({
      id: 'weekly_limit',
      severity: 'warning',
      kind: 'weekly_limit',
      title: 'Weekly spending is above dynamic limit',
      summary: `Spent ${round(spendWeek)} this week vs dynamic limit ${input.limits.weeklyLimit}.`,
      confidence: round(clamp(input.limits.confidence, 0.3, 0.98)),
      explanation: 'Weekly spend is tracking above adaptive weekly guardrail.',
      factors: [`Week spend: ${round(spendWeek)}.`, `Weekly limit: ${input.limits.weeklyLimit}.`],
    });
  }

  if (input.survival.status === 'risk') {
    alerts.push({
      id: 'survival_risk',
      severity: 'critical',
      kind: 'survival_risk',
      title: 'Monthly survival risk detected',
      summary: `Projected end balance in 30 days is ${input.survival.projectedEndBalance30d}.`,
      confidence: input.survival.confidence,
      explanation: input.survival.explanation,
      factors: input.survival.factors,
    });
  }

  const spikeBill = input.bills.find((bill) => Date.parse(bill.dueDate) <= input.nowMs + 7 * MS_PER_DAY && bill.amount > input.limits.weeklyLimit * 0.7 && input.limits.weeklyLimit > 0);
  if (spikeBill) {
    alerts.push({
      id: `bill_spike:${spikeBill.id}`,
      severity: 'warning',
      kind: 'bill_spike',
      title: 'Large bill due soon',
      summary: `${spikeBill.merchant} expected at ${spikeBill.amount} on ${spikeBill.dueDate.slice(0, 10)}.`,
      confidence: spikeBill.confidence,
      explanation: 'A near-term bill consumes a large share of weekly limit.',
      factors: [`Merchant: ${spikeBill.merchant}.`, `Amount: ${spikeBill.amount}.`],
    });
  }

  if (input.coverage.staleAccountCount > 0) {
    alerts.push({
      id: 'data_stale',
      severity: 'info',
      kind: 'data_stale',
      title: 'Some data sources are stale',
      summary: `${input.coverage.staleAccountCount} connected account(s) have stale sync data.`,
      confidence: input.coverage.confidence,
      explanation: 'Stale sources reduce forecast reliability until sync is restored.',
      factors: input.coverage.factors,
    });
  }

  return alerts.slice(0, 6);
}

function buildCategoryLearningSummary(input: {
  rules: MoneyCategoryRule[];
  appliedCount: number;
  coverageConfidence: number;
}): MoneyCategoryLearningSummary {
  const activeRules = input.rules.filter((rule) => rule.status === 'active');
  const pendingRules = input.rules.filter((rule) => rule.status !== 'active');
  const confidence = activeRules.length > 0
    ? mean(activeRules.map((rule) => rule.confidence))
    : input.coverageConfidence * 0.7;

  return {
    appliedRules: input.appliedCount,
    pendingRules: pendingRules.length,
    learnedMerchants: activeRules.length,
    activeRules,
    confidence: round(clamp(confidence, 0.2, 0.98)),
    explanation: activeRules.length > 0
      ? 'Learned category rules are active for merchants with repeated user corrections.'
      : 'No high-confidence learned category rules are active yet.',
    factors: [
      `${activeRules.length} active rule(s), ${pendingRules.length} pending.`,
      `${input.appliedCount} transaction(s) used learned categories.`,
    ],
  };
}

function isStudentKeywordMatch(tx: ClassifiedTx, keywords: string[]): boolean {
  return includesAny(tx.merchant, keywords)
    || includesAny(tx.normalizedMerchant, keywords)
    || includesAny(tx.category, keywords)
    || includesAny(tx.effectiveCategory, keywords);
}

interface P2PTrackingComputation {
  sent30d: number;
  received30d: number;
  netOutflow30d: number;
  dedupedMirroredPairs30d: number;
  uniqueTransferCount30d: number;
  unmatched: ClassifiedTx[];
}

function computeP2PTracking(input: {
  classified: ClassifiedTx[];
  nowMs: number;
}): P2PTrackingComputation {
  const windowStart = input.nowMs - 30 * MS_PER_DAY;
  const p2p = input.classified
    .filter((tx) => tx.occurredAtMs >= windowStart && isStudentKeywordMatch(tx, STUDENT_P2P_KEYWORDS))
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs);

  const used = new Set<number>();
  const unmatched: ClassifiedTx[] = [];
  let dedupedMirroredPairs30d = 0;

  for (let i = 0; i < p2p.length; i += 1) {
    if (used.has(i)) continue;
    const base = p2p[i];
    const baseAbs = Math.abs(base.amount);
    const baseSign = Math.sign(base.amount);
    let matched = false;

    for (let j = i + 1; j < p2p.length; j += 1) {
      if (used.has(j)) continue;
      const candidate = p2p[j];
      const sameMagnitude = Math.abs(Math.abs(candidate.amount) - baseAbs) <= 0.01;
      const oppositeDirection = Math.sign(candidate.amount) === -baseSign;
      const closeInTime = Math.abs(candidate.occurredAtMs - base.occurredAtMs) <= 2 * MS_PER_DAY;
      if (!sameMagnitude || !oppositeDirection || !closeInTime) continue;
      used.add(i);
      used.add(j);
      dedupedMirroredPairs30d += 1;
      matched = true;
      break;
    }

    if (!matched) unmatched.push(base);
  }

  const sent30d = unmatched
    .filter((tx) => tx.amount > 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const received30d = unmatched
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const netOutflow30d = sent30d - received30d;

  return {
    sent30d: round(sent30d),
    received30d: round(received30d),
    netOutflow30d: round(netOutflow30d),
    dedupedMirroredPairs30d,
    uniqueTransferCount30d: unmatched.length,
    unmatched,
  };
}

function buildStudentFocus(input: {
  classified: ClassifiedTx[];
  nowMs: number;
  coverage: MoneyCoverage;
  affordability: MoneyAffordability;
  weeklyPrediction: MoneyWeeklyPrediction;
  monthlySurvival: MoneyMonthlySurvivalForecast;
  spendingLimits: MoneySpendingLimits;
  billPredictions: MoneyBillPrediction[];
  connectedAccounts: MoneyConnectedAccountInput[];
  incomeCadence: IncomeCadenceInfo;
}): MoneyStudentFocus {
  const allIncome = input.classified
    .filter((tx) => tx.kind === 'income')
    .map((tx) => Math.abs(tx.amount));
  const medianIncome = median(allIncome);
  const incomeLumpThreshold = Math.max(450, medianIncome * 1.8);

  const refundCandidate = [...input.classified]
    .filter((tx) => {
      if (tx.kind !== 'income' && tx.kind !== 'refund') return false;
      if (tx.amount >= 0) return false;
      if (isStudentKeywordMatch(tx, STUDENT_P2P_KEYWORDS)) return false;
      const amount = Math.abs(tx.amount);
      const byKeyword = isStudentKeywordMatch(tx, STUDENT_REFUND_DEPOSIT_KEYWORDS);
      const byLump = amount >= incomeLumpThreshold;
      return byKeyword || byLump;
    })
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs)[0];

  const semesterDaysPlanned = 120;
  const projectedBillsSemester = input.monthlySurvival.projectedBills30d * (semesterDaysPlanned / 30);
  const refundAmount = refundCandidate ? Math.abs(refundCandidate.amount) : null;
  const refundWeeklyRunwayBudget = refundAmount === null
    ? null
    : Math.max(0, (refundAmount - projectedBillsSemester) / (semesterDaysPlanned / 7));
  const refundEstimatedRunwayDays = refundAmount === null
    ? null
    : Math.max(
      0,
      Math.round(
        refundAmount
        / Math.max(input.affordability.dailyEssentialSpend, input.weeklyPrediction.predictedDailyBurn, 1),
      ),
    );
  const refundConfidence = clamp(
    input.coverage.confidence * 0.55
      + (refundCandidate ? 0.3 : 0.1)
      + (refundCandidate && isStudentKeywordMatch(refundCandidate, STUDENT_REFUND_DEPOSIT_KEYWORDS) ? 0.15 : 0),
    0.2,
    0.98,
  );

  const meal30Start = input.nowMs - 30 * MS_PER_DAY;
  const meal7Start = input.nowMs - 7 * MS_PER_DAY;
  const mealTransactions30d = input.classified.filter(
    (tx) => tx.kind === 'expense' && tx.occurredAtMs >= meal30Start && isStudentKeywordMatch(tx, STUDENT_MEAL_KEYWORDS),
  );
  const mealTransactions7d = mealTransactions30d.filter((tx) => tx.occurredAtMs >= meal7Start);
  const estimatedMealSpend30d = mealTransactions30d.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const estimatedMealSpend7d = mealTransactions7d.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const mealBudgetSource = input.spendingLimits.categoryBudgets.find((budget) => includesAny(budget.category, STUDENT_MEAL_KEYWORDS));
  const estimatedMealWeeklyBudget = mealBudgetSource
    ? mealBudgetSource.recommendedMonthlyBudget / 4.345
    : estimatedMealSpend30d > 0
      ? estimatedMealSpend30d / 4.345
      : null;
  const estimatedMealWeeklyRemaining = estimatedMealWeeklyBudget === null
    ? null
    : Math.max(0, estimatedMealWeeklyBudget - estimatedMealSpend7d);
  const mealManualFallback = mealTransactions30d.length === 0;
  const mealConfidence = clamp(
    input.coverage.confidence * 0.55 + Math.min(mealTransactions30d.length / 10, 1) * 0.45,
    0.2,
    0.97,
  );

  const dormBills = input.billPredictions.filter((bill) => includesAny(bill.merchant, STUDENT_DORM_KEYWORDS));
  const upcomingDorm = dormBills
    .filter((bill) => Date.parse(bill.dueDate) >= input.nowMs)
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate))[0];
  const dormSpend30d = input.classified
    .filter((tx) => tx.kind === 'expense' && tx.occurredAtMs >= meal30Start && isStudentKeywordMatch(tx, STUDENT_DORM_KEYWORDS))
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const dormManualFallback = dormSpend30d <= 0 && !upcomingDorm;
  const dormConfidence = clamp(
    input.coverage.confidence * 0.6 + (upcomingDorm || dormSpend30d > 0 ? 0.28 : 0.1),
    0.2,
    0.97,
  );

  const p2pTracking = computeP2PTracking({
    classified: input.classified,
    nowMs: input.nowMs,
  });

  const rentCharges = input.classified
    .filter((tx) => tx.kind === 'expense' && isStudentKeywordMatch(tx, STUDENT_RENT_KEYWORDS) && Math.abs(tx.amount) >= 250)
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs);
  const latestRent = rentCharges[0];
  const reimbursementsNearRent = latestRent
    ? p2pTracking.unmatched.filter((tx) => tx.amount < 0 && tx.occurredAtMs >= latestRent.occurredAtMs - 5 * MS_PER_DAY && tx.occurredAtMs <= latestRent.occurredAtMs + 7 * MS_PER_DAY)
    : [];
  const reimbursedByRoommates = reimbursementsNearRent.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const inferredRoommateCount = latestRent
    ? clamp(reimbursementsNearRent.length + 1, 2, 6)
    : null;
  const suggestedPerPersonShare = latestRent && inferredRoommateCount
    ? Math.abs(latestRent.amount) / inferredRoommateCount
    : null;
  const stillToCollect = latestRent && suggestedPerPersonShare
    ? Math.max(0, Math.abs(latestRent.amount) - suggestedPerPersonShare - reimbursedByRoommates)
    : null;
  const rentManualFallback = !latestRent;
  const rentConfidence = clamp(
    input.coverage.confidence * 0.6 + (latestRent ? 0.2 : 0.05) + Math.min(reimbursementsNearRent.length * 0.08, 0.2),
    0.2,
    0.97,
  );

  const nightlife90Start = input.nowMs - 90 * MS_PER_DAY;
  const nightlifeTransactions = input.classified.filter(
    (tx) => tx.kind === 'expense' && tx.occurredAtMs >= nightlife90Start && isStudentKeywordMatch(tx, STUDENT_NIGHTLIFE_KEYWORDS),
  );
  const nightlifeByDay = new Map<string, number>();
  for (const tx of nightlifeTransactions) {
    const day = toDateKey(tx.occurredAtMs);
    nightlifeByDay.set(day, (nightlifeByDay.get(day) ?? 0) + Math.abs(tx.amount));
  }
  const typicalNightSpend = nightlifeByDay.size > 0
    ? median([...nightlifeByDay.values()])
    : null;
  const suggestedTonightLimit = Math.max(
    0,
    Math.min(
      input.affordability.safeToSpendToday * 0.6,
      input.affordability.safeToSpendThisWeek * 0.25,
      input.spendingLimits.dailyLimit,
    ),
  );
  const canAffordTypicalNight = typicalNightSpend === null
    ? suggestedTonightLimit > 0
    : suggestedTonightLimit >= typicalNightSpend;
  const nightlifeConfidence = clamp(
    input.coverage.confidence * 0.55 + Math.min(nightlifeTransactions.length / 12, 1) * 0.45,
    0.2,
    0.97,
  );

  const internshipIncomeTransactions = input.classified
    .filter((tx) => tx.kind === 'income' && isStudentKeywordMatch(tx, STUDENT_INTERNSHIP_KEYWORDS))
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  const internshipIncomeLast30d = internshipIncomeTransactions
    .filter((tx) => tx.occurredAtMs >= meal30Start)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const internshipPaychecks = internshipIncomeTransactions.map((tx) => Math.abs(tx.amount));
  const averagePaycheckAmount = internshipPaychecks.length > 0 ? mean(internshipPaychecks) : null;
  const internshipIntervals: number[] = [];
  for (let i = 1; i < internshipIncomeTransactions.length; i += 1) {
    internshipIntervals.push(
      (internshipIncomeTransactions[i].occurredAtMs - internshipIncomeTransactions[i - 1].occurredAtMs) / MS_PER_DAY,
    );
  }
  const internshipMeanInterval = internshipIntervals.length > 0 ? mean(internshipIntervals) : null;
  const internshipReliable = internshipMeanInterval !== null
    && internshipIntervals.length >= 1
    && internshipMeanInterval >= 7
    && internshipMeanInterval <= 35
    && (stdDev(internshipIntervals) / internshipMeanInterval) <= 0.35;
  const nextExpectedPaycheckDate = internshipReliable && internshipMeanInterval !== null && internshipIncomeTransactions.length > 0
    ? new Date(
      internshipIncomeTransactions[internshipIncomeTransactions.length - 1].occurredAtMs
      + internshipMeanInterval * MS_PER_DAY,
    ).toISOString()
    : input.incomeCadence.reliable
      ? input.incomeCadence.nextIncomeDate
      : null;
  const projectedInternshipIncome30d = internshipReliable && averagePaycheckAmount && internshipMeanInterval
    ? Math.floor(30 / internshipMeanInterval) * averagePaycheckAmount
    : input.incomeCadence.reliable
      ? input.incomeCadence.projectedIncome30d
      : internshipIncomeLast30d;
  const internshipManualFallback = internshipIncomeTransactions.length === 0;
  const internshipConfidence = clamp(
    input.coverage.confidence * 0.5 + (internshipReliable ? 0.35 : 0.12) + Math.min(internshipIncomeTransactions.length / 8, 0.15),
    0.2,
    0.98,
  );

  const loanBalances = input.connectedAccounts
    .filter((account) => includesAny(account.type || '', ['loan']) || (typeof account.balance === 'number' && account.balance < 0))
    .map((account) => Math.abs(Math.min(0, account.balance ?? 0)));
  const trackedLoanBalance = loanBalances.reduce((sum, value) => sum + value, 0);
  const loanBills = input.billPredictions.filter((bill) => includesAny(bill.merchant, STUDENT_LOAN_KEYWORDS));
  const nextLoanBill = loanBills
    .filter((bill) => Date.parse(bill.dueDate) >= input.nowMs)
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate))[0];
  const loanBills30d = loanBills
    .filter((bill) => Date.parse(bill.dueDate) <= input.nowMs + 30 * MS_PER_DAY)
    .reduce((sum, bill) => sum + bill.amount, 0);
  const loanStatus: MoneyStudentFocus['loanMonitoring']['status'] =
    !nextLoanBill && trackedLoanBalance <= 0
      ? 'manual'
      : nextLoanBill && input.affordability.safeToSpendThisWeek < nextLoanBill.amount
        ? 'risk'
        : nextLoanBill && Date.parse(nextLoanBill.dueDate) <= input.nowMs + 10 * MS_PER_DAY
          ? 'watch'
          : 'clear';
  const loanConfidence = clamp(
    input.coverage.confidence * 0.58 + (nextLoanBill || trackedLoanBalance > 0 ? 0.3 : 0.12),
    0.2,
    0.97,
  );

  const refundBudgeting = {
    latestRefundLikeDepositAmount: refundAmount === null ? null : round(refundAmount),
    latestRefundLikeDepositDate: refundCandidate ? refundCandidate.occurredAt : null,
    semesterDaysPlanned,
    weeklyRunwayBudget: refundWeeklyRunwayBudget === null ? null : round(refundWeeklyRunwayBudget),
    estimatedRunwayDays: refundEstimatedRunwayDays,
    manualTrackingRecommended: !refundCandidate,
    confidence: round(refundConfidence),
    explanation: refundCandidate
      ? 'Calico found a refund-like lump-sum deposit and spread it into a conservative semester runway plan.'
      : 'No refund-like lump-sum deposit was confidently detected, so runway planning stays manual-first.',
    factors: [
      refundCandidate
        ? `Latest refund-like deposit: ${round(Math.abs(refundCandidate.amount))} on ${refundCandidate.occurredAt.slice(0, 10)}.`
        : `No refund-like deposits above ${round(incomeLumpThreshold)} in recent history.`,
      `Semester horizon: ${semesterDaysPlanned} day(s).`,
    ],
  };

  const mealPlan = {
    estimatedSpend7d: round(estimatedMealSpend7d),
    estimatedSpend30d: round(estimatedMealSpend30d),
    estimatedWeeklyBudget: estimatedMealWeeklyBudget === null ? null : round(estimatedMealWeeklyBudget),
    estimatedWeeklyRemaining: estimatedMealWeeklyRemaining === null ? null : round(estimatedMealWeeklyRemaining),
    manualTrackingRecommended: mealManualFallback,
    confidence: round(mealConfidence),
    explanation: mealManualFallback
      ? 'Meal-plan tracking is manual-first until more meal-related transactions are available.'
      : 'Meal tracking estimates your weekly meal runway from observed dining and grocery patterns.',
    factors: [
      `Meal spend 7d: ${round(estimatedMealSpend7d)}.`,
      `Meal spend 30d: ${round(estimatedMealSpend30d)}.`,
    ],
  };

  const dormExpenses = {
    estimatedDormSpend30d: round(dormSpend30d),
    upcomingDormBillAmount: upcomingDorm ? round(upcomingDorm.amount) : null,
    upcomingDormBillDate: upcomingDorm?.dueDate || null,
    manualTrackingRecommended: dormManualFallback,
    confidence: round(dormConfidence),
    explanation: dormManualFallback
      ? 'Dorm and housing tracking is manual-first until rent or housing charges are clearly detected.'
      : 'Dorm expenses combine observed housing transactions and upcoming housing-related bill predictions.',
    factors: [
      `Dorm/housing spend 30d: ${round(dormSpend30d)}.`,
      upcomingDorm
        ? `Upcoming dorm bill: ${round(upcomingDorm.amount)} on ${upcomingDorm.dueDate.slice(0, 10)}.`
        : 'No upcoming dorm bill detected.',
    ],
  };

  const rentSplit = {
    latestRentAmount: latestRent ? round(Math.abs(latestRent.amount)) : null,
    latestRentDate: latestRent?.occurredAt || null,
    inferredRoommateCount: inferredRoommateCount === null ? null : Math.round(inferredRoommateCount),
    suggestedPerPersonShare: suggestedPerPersonShare === null ? null : round(suggestedPerPersonShare),
    reimbursedByRoommates: round(reimbursedByRoommates),
    stillToCollect: stillToCollect === null ? null : round(stillToCollect),
    manualTrackingRecommended: rentManualFallback,
    confidence: round(rentConfidence),
    explanation: rentManualFallback
      ? 'No clear rent payment is detected yet, so split-rent planning stays manual-first.'
      : 'Split-rent intelligence uses recent rent charges and roommate reimbursement signals from peer-to-peer transfers.',
    factors: [
      latestRent
        ? `Latest rent payment: ${round(Math.abs(latestRent.amount))} on ${latestRent.occurredAt.slice(0, 10)}.`
        : 'No rent payment over threshold detected.',
      `Roommate reimbursements near rent date: ${round(reimbursedByRoommates)}.`,
    ],
  };

  const p2pSection = {
    sent30d: p2pTracking.sent30d,
    received30d: p2pTracking.received30d,
    netOutflow30d: p2pTracking.netOutflow30d,
    dedupedMirroredPairs30d: p2pTracking.dedupedMirroredPairs30d,
    uniqueTransferCount30d: p2pTracking.uniqueTransferCount30d,
    confidence: round(clamp(input.coverage.confidence * 0.65 + Math.min(p2pTracking.uniqueTransferCount30d / 12, 1) * 0.35, 0.2, 0.97)),
    explanation: p2pTracking.dedupedMirroredPairs30d > 0
      ? 'Mirrored peer-to-peer entries were deduped to avoid double-counting send and receive legs.'
      : 'Peer-to-peer totals are tracked from Venmo/CashApp/Zelle-style transfer patterns.',
    factors: [
      `Unique P2P transfers (30d): ${p2pTracking.uniqueTransferCount30d}.`,
      `Mirrored P2P pairs deduped (30d): ${p2pTracking.dedupedMirroredPairs30d}.`,
    ],
  };

  const nightlife = {
    suggestedTonightLimit: round(suggestedTonightLimit),
    typicalNightSpend: typicalNightSpend === null ? null : round(typicalNightSpend),
    canAffordTypicalNight,
    confidence: round(nightlifeConfidence),
    explanation: 'Tonight limit is conservative for paycheck-to-paycheck safety and reserves essentials first.',
    factors: [
      `Safe-to-spend today: ${round(input.affordability.safeToSpendToday)}.`,
      `Suggested tonight limit: ${round(suggestedTonightLimit)}.`,
      typicalNightSpend === null
        ? 'No nightlife history yet; limit is based on safety guardrails only.'
        : `Typical night spend: ${round(typicalNightSpend)}.`,
    ],
  };

  const internshipIncome = {
    internshipIncomeLast30d: round(internshipIncomeLast30d),
    averagePaycheckAmount: averagePaycheckAmount === null ? null : round(averagePaycheckAmount),
    nextExpectedPaycheckDate,
    projectedIncome30d: round(projectedInternshipIncome30d),
    cadenceReliable: internshipReliable || input.incomeCadence.reliable,
    manualTrackingRecommended: internshipManualFallback,
    confidence: round(internshipConfidence),
    explanation: internshipManualFallback
      ? 'Internship income tracking is manual-first until paycheck patterns are detectable.'
      : 'Paycheck forecast uses internship-related deposits and cadence reliability checks.',
    factors: [
      `Internship income (30d): ${round(internshipIncomeLast30d)}.`,
      nextExpectedPaycheckDate
        ? `Next expected paycheck: ${nextExpectedPaycheckDate.slice(0, 10)}.`
        : 'No reliable next paycheck date yet.',
    ],
  };

  const loanMonitoring = {
    trackedLoanBalance: round(trackedLoanBalance),
    loanBills30d: round(loanBills30d),
    nextLoanPaymentAmount: nextLoanBill ? round(nextLoanBill.amount) : null,
    nextLoanPaymentDate: nextLoanBill?.dueDate || null,
    status: loanStatus,
    confidence: round(loanConfidence),
    explanation: loanStatus === 'manual'
      ? 'Loan watch is manual-first until student loan balances or servicer bills are visible.'
      : 'Loan watch combines known balances with upcoming loan-related bill predictions.',
    factors: [
      `Tracked loan balance: ${round(trackedLoanBalance)}.`,
      nextLoanBill
        ? `Next loan payment: ${round(nextLoanBill.amount)} on ${nextLoanBill.dueDate.slice(0, 10)}.`
        : 'No upcoming loan payment found in current horizon.',
    ],
  };

  const cards: MoneyStudentCard[] = [
    {
      id: 'can_i_afford_tonight',
      title: 'Can I afford tonight?',
      summary: nightlife.typicalNightSpend === null
        ? `A safe cap for tonight is ${round(nightlife.suggestedTonightLimit)}. Add tags to refine this with your usual nights.`
        : nightlife.canAffordTypicalNight
          ? `You can likely afford your usual night (${round(nightlife.typicalNightSpend)}) with a safe cap of ${round(nightlife.suggestedTonightLimit)}.`
          : `Keep tonight near ${round(nightlife.suggestedTonightLimit)} to stay safe before the next paycheck.`,
      status: nightlife.canAffordTypicalNight ? 'good' : nightlife.suggestedTonightLimit > 0 ? 'watch' : 'risk',
      amount: nightlife.suggestedTonightLimit,
      amountLabel: 'Suggested tonight cap',
      confidence: nightlife.confidence,
      explanation: nightlife.explanation,
      factors: nightlife.factors,
    },
    {
      id: 'refund_survival',
      title: 'Refund survival',
      summary: refundBudgeting.latestRefundLikeDepositAmount === null
        ? 'No refund deposit detected yet. Add it manually to get a semester runway plan.'
        : `Latest refund deposit ${round(refundBudgeting.latestRefundLikeDepositAmount)} can support about ${refundBudgeting.estimatedRunwayDays ?? 0} day(s).`,
      status: refundBudgeting.latestRefundLikeDepositAmount === null
        ? 'manual'
        : (refundBudgeting.estimatedRunwayDays ?? 0) >= 90
          ? 'good'
          : (refundBudgeting.estimatedRunwayDays ?? 0) >= 45
            ? 'watch'
            : 'risk',
      amount: refundBudgeting.weeklyRunwayBudget,
      amountLabel: 'Weekly runway budget',
      confidence: refundBudgeting.confidence,
      explanation: refundBudgeting.explanation,
      factors: refundBudgeting.factors,
    },
    {
      id: 'meal_balance',
      title: 'Meal balance',
      summary: mealPlan.estimatedWeeklyRemaining === null
        ? 'Meal plan balance is manual for now. Add your current meal balance to track weekly runway.'
        : `${round(mealPlan.estimatedWeeklyRemaining)} estimated for meals this week at your current pace.`,
      status: mealPlan.estimatedWeeklyRemaining === null
        ? 'manual'
        : mealPlan.estimatedWeeklyRemaining > 60
          ? 'good'
          : mealPlan.estimatedWeeklyRemaining > 20
            ? 'watch'
            : 'risk',
      amount: mealPlan.estimatedWeeklyRemaining,
      amountLabel: 'Estimated weekly meal balance',
      confidence: mealPlan.confidence,
      explanation: mealPlan.explanation,
      factors: mealPlan.factors,
    },
    {
      id: 'rent_split',
      title: 'Rent split',
      summary: rentSplit.latestRentAmount === null
        ? 'No rent charge found yet. Add rent manually to track split status.'
        : rentSplit.stillToCollect && rentSplit.stillToCollect > 0
          ? `Rent split suggests ${round(rentSplit.stillToCollect)} still to collect from roommates.`
          : 'Rent split looks on track based on recent reimbursements.',
      status: rentSplit.latestRentAmount === null
        ? 'manual'
        : rentSplit.stillToCollect && rentSplit.stillToCollect > 0
          ? 'watch'
          : 'good',
      amount: rentSplit.suggestedPerPersonShare,
      amountLabel: 'Suggested per-person share',
      confidence: rentSplit.confidence,
      explanation: rentSplit.explanation,
      factors: rentSplit.factors,
    },
    {
      id: 'paycheck_forecast',
      title: 'Paycheck forecast',
      summary: internshipIncome.nextExpectedPaycheckDate
        ? `Next paycheck is expected around ${internshipIncome.nextExpectedPaycheckDate.slice(0, 10)}.`
        : 'Next paycheck date is not reliable yet. Keep manual paycheck tracking on.',
      status: internshipIncome.cadenceReliable ? 'good' : internshipIncome.projectedIncome30d > 0 ? 'watch' : 'manual',
      amount: internshipIncome.averagePaycheckAmount,
      amountLabel: 'Expected paycheck amount',
      confidence: internshipIncome.confidence,
      explanation: internshipIncome.explanation,
      factors: internshipIncome.factors,
    },
    {
      id: 'loan_watch',
      title: 'Loan watch',
      summary: loanMonitoring.nextLoanPaymentDate
        ? `Next student-loan payment ${round(loanMonitoring.nextLoanPaymentAmount || 0)} on ${loanMonitoring.nextLoanPaymentDate.slice(0, 10)}.`
        : 'No student-loan due date found yet. Add your servicer details manually to keep watch active.',
      status: loanMonitoring.status === 'clear'
        ? 'good'
        : loanMonitoring.status === 'watch'
          ? 'watch'
          : loanMonitoring.status === 'risk'
            ? 'risk'
            : 'manual',
      amount: loanMonitoring.nextLoanPaymentAmount,
      amountLabel: 'Next loan payment',
      confidence: loanMonitoring.confidence,
      explanation: loanMonitoring.explanation,
      factors: loanMonitoring.factors,
    },
  ];

  const insights: MoneyStudentInsight[] = [];
  if (refundBudgeting.latestRefundLikeDepositAmount !== null) {
    insights.push({
      id: 'student_refund_runway',
      kind: 'refund_runway',
      severity: (refundBudgeting.estimatedRunwayDays ?? 0) < 45 ? 'warning' : 'info',
      title: 'Refund runway plan updated',
      summary: `Using your latest refund deposit, weekly runway target is ${round(refundBudgeting.weeklyRunwayBudget || 0)}.`,
      confidence: refundBudgeting.confidence,
      explanation: refundBudgeting.explanation,
      factors: refundBudgeting.factors,
    });
  }
  if (p2pSection.dedupedMirroredPairs30d > 0) {
    insights.push({
      id: 'student_p2p_dedup',
      kind: 'p2p_dedup',
      severity: 'info',
      title: 'P2P double-count protection applied',
      summary: `${p2pSection.dedupedMirroredPairs30d} mirrored Venmo/CashApp pair(s) were deduped.`,
      confidence: p2pSection.confidence,
      explanation: p2pSection.explanation,
      factors: p2pSection.factors,
    });
  }
  if (!nightlife.canAffordTypicalNight) {
    insights.push({
      id: 'student_nightlife_affordability',
      kind: 'nightlife',
      severity: nightlife.suggestedTonightLimit <= 0 ? 'critical' : 'warning',
      title: 'Tonight spending cap tightened',
      summary: `Suggested tonight cap is ${round(nightlife.suggestedTonightLimit)} to protect essentials.`,
      confidence: nightlife.confidence,
      explanation: nightlife.explanation,
      factors: nightlife.factors,
    });
  }
  if (rentSplit.stillToCollect && rentSplit.stillToCollect > 0) {
    insights.push({
      id: 'student_rent_split',
      kind: 'rent_split',
      severity: 'warning',
      title: 'Roommate reimbursement still pending',
      summary: `${round(rentSplit.stillToCollect)} may still be outstanding for the latest rent payment.`,
      confidence: rentSplit.confidence,
      explanation: rentSplit.explanation,
      factors: rentSplit.factors,
    });
  }
  if (loanMonitoring.status === 'risk' || loanMonitoring.status === 'watch') {
    insights.push({
      id: 'student_loan_watch',
      kind: 'loan_watch',
      severity: loanMonitoring.status === 'risk' ? 'critical' : 'warning',
      title: 'Student loan payment watch',
      summary: loanMonitoring.nextLoanPaymentDate
        ? `Loan payment ${round(loanMonitoring.nextLoanPaymentAmount || 0)} due ${loanMonitoring.nextLoanPaymentDate.slice(0, 10)}.`
        : 'Loan watch needs updated payment details.',
      confidence: loanMonitoring.confidence,
      explanation: loanMonitoring.explanation,
      factors: loanMonitoring.factors,
    });
  }

  const studentConfidence = clamp(
    input.coverage.confidence * 0.45
      + mean([
        refundBudgeting.confidence,
        mealPlan.confidence,
        dormExpenses.confidence,
        rentSplit.confidence,
        p2pSection.confidence,
        nightlife.confidence,
        internshipIncome.confidence,
        loanMonitoring.confidence,
      ]) * 0.55,
    0.2,
    0.98,
  );

  return {
    cards,
    refundBudgeting,
    mealPlan,
    dormExpenses,
    rentSplit,
    p2pTracking: p2pSection,
    nightlife,
    internshipIncome,
    loanMonitoring,
    insights: insights.slice(0, 8),
    confidence: round(studentConfidence),
    explanation: 'Student-focused intelligence is deterministic, paycheck-protective, and manual-first when data is incomplete.',
    factors: [
      `Coverage confidence: ${input.coverage.confidence}.`,
      `Student cards generated: ${cards.length}.`,
      `Manual-first cards: ${cards.filter((card) => card.status === 'manual').length}.`,
    ],
  };
}

export function computeMoneyIntelligence(
  input: MoneyIntelligenceInput,
): MoneyIntelligenceResult {
  const nowMs = safeParseDate(input.nowIso || new Date().toISOString());
  const walletBalance = Number.isFinite(input.walletBalance) ? input.walletBalance : 0;

  const { classified, learningAppliedCount } = classifyTransactions({
    transactions: input.transactions,
    categoryRules: input.categoryRules,
  });

  const coverage = buildCoverage({
    connectedAccounts: input.connectedAccounts,
    settledTransactions: classified,
    nowMs,
  });

  const statement = buildStatementAggregation({
    classified,
    currency: input.currency || 'USD',
    coverageConfidence: coverage.confidence,
  });

  const weeklyPrediction = buildWeeklyPrediction({
    classified,
    nowMs,
    coverageConfidence: coverage.confidence,
  });
  const incomeCadence = buildIncomeCadence({ classified, nowMs });
  const { bills, projectedBills30d } = buildBillPredictions({
    recurring: input.recurring,
    nowMs,
    coverageConfidence: coverage.confidence,
  });

  const spendingLimits = buildSpendingLimits({
    classified,
    walletBalance,
    projectedIncome30d: incomeCadence.projectedIncome30d,
    projectedBills30d,
    weeklyPrediction,
    coverageConfidence: coverage.confidence,
    nowMs,
  });

  const affordability = buildAffordability({
    walletBalance,
    bills,
    spendingLimits,
    weeklyPrediction,
    incomeCadence,
    nowMs,
    coverageConfidence: coverage.confidence,
  });

  const monthlySurvivalForecast = buildMonthlySurvival({
    walletBalance,
    projectedIncome30d: incomeCadence.projectedIncome30d,
    projectedBills30d,
    weeklyPrediction,
    coverageConfidence: coverage.confidence,
    incomeCadence,
  });

  const subscriptionTimeline = buildSubscriptionTimeline({
    recurring: input.recurring,
    bills,
    coverageConfidence: coverage.confidence,
  });

  const netWorth = buildNetWorth({
    walletBalance,
    accounts: input.connectedAccounts,
    classified,
    coverageConfidence: coverage.confidence,
    nowMs,
  });

  const alerts = buildAlerts({
    classified,
    nowMs,
    limits: spendingLimits,
    survival: monthlySurvivalForecast,
    bills,
    coverage,
  });

  const categoryLearning = buildCategoryLearningSummary({
    rules: input.categoryRules,
    appliedCount: learningAppliedCount,
    coverageConfidence: coverage.confidence,
  });

  const studentFocus = buildStudentFocus({
    classified,
    nowMs,
    coverage,
    affordability,
    weeklyPrediction,
    monthlySurvival: monthlySurvivalForecast,
    spendingLimits,
    billPredictions: bills,
    connectedAccounts: input.connectedAccounts,
    incomeCadence,
  });

  const advancedIntelligence = buildAdvancedIntelligence({
    nowIso: new Date(nowMs).toISOString(),
    currency: input.currency || 'USD',
    walletBalance,
    coverage,
    statement,
    affordability,
    weeklyPrediction,
    monthlySurvivalForecast,
    spendingLimits,
    connectedAccounts: input.connectedAccounts,
    billPredictions: bills,
  });

  return {
    generatedAt: new Date(nowMs).toISOString(),
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    statement,
    coverage,
    netWorth,
    spendingLimits,
    affordability,
    weeklyPrediction,
    monthlySurvivalForecast,
    billPredictions: bills,
    subscriptionTimeline,
    alerts,
    categoryLearning,
    studentFocus,
    advancedIntelligence,
  };
}
