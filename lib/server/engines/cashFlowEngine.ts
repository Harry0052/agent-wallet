import 'server-only';

import { listAnalyzableTransactions } from '@/lib/server/engines/transactionGuard';
import {
  computeAccountCompleteness,
  buildDedupKey,
  ENGINE_VERSION,
  RULES_VERSION,
  type EngineResult,
  type Explainable,
} from '@/lib/server/engines/contracts';
import { detectAndPersistRecurringSubscriptions } from '@/subscription_intelligence/subscriptionService';
import { saveCashFlowSnapshot } from '@/lib/server/engines/snapshotStore';
import { recordEngineMetric } from '@/lib/server/engines/engineMetrics';
import { getWallet } from '@/lib/server/ledger';
import type { StatementTransaction } from '@/transactions/transactionRepository';
import type { DetectedSubscription } from '@/subscription_intelligence/subscriptionService';

export interface CashFlowPrediction extends Explainable {
  currentBalance: number;
  balanceSource: 'available' | 'current' | 'last_synced_aggregate';
  balanceAsOf: string;
  predictedBalance30d: number;
  daysUntilNegative: number | null;
  safeToSpendToday: number;
  safeToSpendThisWeek: number;
  safeToSpendUntilNextIncome: number | null;
  projectedIncome30d: number;
  projectedExpenses30d: number;
  recurringObligations30d: number;
  dayByDay: Array<{
    date: string;
    predictedBalance: number;
    income: number;
    expenses: number;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PROJECTION_DAYS = 90;

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function dayOfMonth(dateStr: string): number {
  return new Date(dateStr).getUTCDate();
}

/**
 * Build a histogram of average daily income and expenses keyed by
 * day-of-month (1..31). Each bucket holds the mean across all months
 * observed.
 */
function buildDayOfMonthHistogram(transactions: StatementTransaction[]): {
  incomeByDay: Map<number, number>;
  expenseByDay: Map<number, number>;
} {
  const incomeSums = new Map<number, number[]>();
  const expenseSums = new Map<number, number[]>();

  for (const tx of transactions) {
    const dom = dayOfMonth(tx.occurred_at);
    const amount = tx.amount;

    if (amount > 0) {
      // Income / credit
      const bucket = incomeSums.get(dom) ?? [];
      bucket.push(amount);
      incomeSums.set(dom, bucket);
    } else if (amount < 0) {
      // Expense / debit — store as positive magnitude
      const bucket = expenseSums.get(dom) ?? [];
      bucket.push(Math.abs(amount));
      expenseSums.set(dom, bucket);
    }
  }

  const lookbackMonths = 3;
  const incomeByDay = new Map<number, number>();
  const expenseByDay = new Map<number, number>();

  for (const [dom, values] of incomeSums) {
    incomeByDay.set(dom, values.reduce((a, b) => a + b, 0) / lookbackMonths);
  }
  for (const [dom, values] of expenseSums) {
    expenseByDay.set(dom, values.reduce((a, b) => a + b, 0) / lookbackMonths);
  }

  return { incomeByDay, expenseByDay };
}

/**
 * Convert recurring subscriptions into a map of day-of-month obligations.
 */
function recurringObligationsByDay(
  subscriptions: DetectedSubscription[],
): Map<number, number> {
  const byDay = new Map<number, number>();

  for (const sub of subscriptions) {
    if (sub.status === 'inactive' || sub.status === 'ignored') continue;
    if (sub.confidence < 0.5) continue;

    const lastSeenDate = new Date(sub.last_seen);
    const dom = lastSeenDate.getUTCDate();

    const monthlyCost = sub.estimated_monthly_cost;
    let effectiveMonthlyCost = monthlyCost;

    if (sub.recurrence_interval === 'weekly') {
      effectiveMonthlyCost = monthlyCost; // already monthly estimate
    } else if (sub.recurrence_interval === 'annual' || sub.recurrence_interval === 'yearly') {
      effectiveMonthlyCost = monthlyCost;
    }

    byDay.set(dom, (byDay.get(dom) ?? 0) + effectiveMonthlyCost);
  }

  return byDay;
}

/**
 * Detect income interval and next income date from transaction history.
 * Returns null when data is insufficient or unreliable.
 */
function detectNextIncomeDate(
  transactions: StatementTransaction[],
  today: Date,
): Date | null {
  const incomes = transactions
    .filter((tx) => tx.amount > 0)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));

  if (incomes.length < 2) return null;

  // Group income by approximate recurrence (paycheck-like: similar amounts)
  const amounts = incomes.map((tx) => tx.amount);
  const meanAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;

  // Filter to "paycheck-like" incomes (within 50% of mean)
  const paycheckLike = incomes.filter(
    (tx) => Math.abs(tx.amount - meanAmount) / meanAmount < 0.5,
  );

  if (paycheckLike.length < 2) return null;

  // Compute intervals between consecutive paycheck-like incomes
  const intervals: number[] = [];
  for (let i = 1; i < paycheckLike.length; i++) {
    const prev = Date.parse(paycheckLike[i - 1].occurred_at);
    const curr = Date.parse(paycheckLike[i].occurred_at);
    intervals.push((curr - prev) / MS_PER_DAY);
  }

  if (intervals.length === 0) return null;

  const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance =
    intervals.reduce((sum, v) => sum + (v - meanInterval) ** 2, 0) /
    intervals.length;
  const stddev = Math.sqrt(variance);

  // Confidence gate: stddev must be <= 30% of mean
  if (stddev / meanInterval > 0.3) return null;

  // Project from last income date
  const lastIncomeDate = Date.parse(
    paycheckLike[paycheckLike.length - 1].occurred_at,
  );
  let nextDate = lastIncomeDate;
  const todayMs = today.getTime();

  while (nextDate <= todayMs) {
    nextDate += meanInterval * MS_PER_DAY;
  }

  return new Date(nextDate);
}

interface IncomeIntervalInfo {
  nextIncomeDate: Date | null;
  intervalConfidence: number;
  incomeCount: number;
}

function analyzeIncomeInterval(
  transactions: StatementTransaction[],
  today: Date,
): IncomeIntervalInfo {
  const incomes = transactions
    .filter((tx) => tx.amount > 0)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));

  if (incomes.length < 2) {
    return { nextIncomeDate: null, intervalConfidence: 0, incomeCount: incomes.length };
  }

  const intervals: number[] = [];
  for (let i = 1; i < incomes.length; i++) {
    const prev = Date.parse(incomes[i - 1].occurred_at);
    const curr = Date.parse(incomes[i].occurred_at);
    intervals.push((curr - prev) / MS_PER_DAY);
  }

  const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance =
    intervals.reduce((sum, v) => sum + (v - meanInterval) ** 2, 0) /
    intervals.length;
  const stddev = Math.sqrt(variance);
  const cv = meanInterval > 0 ? stddev / meanInterval : 1;
  const confidence = Math.max(0, 1 - cv);

  const nextDate = detectNextIncomeDate(transactions, today);

  return {
    nextIncomeDate: nextDate,
    intervalConfidence: confidence,
    incomeCount: incomes.length,
  };
}

function sumObligationsBetween(
  recurringByDay: Map<number, number>,
  _histogramExpenseByDay: Map<number, number>,
  startDate: Date,
  endDate: Date,
): number {
  let total = 0;
  const d = new Date(startDate);

  while (d <= endDate) {
    const dom = d.getUTCDate();
    const recurring = recurringByDay.get(dom) ?? 0;
    total += recurring;
    d.setDate(d.getDate() + 1);
  }

  return total;
}

/* ------------------------------------------------------------------ */
/*  Main export                                                        */
/* ------------------------------------------------------------------ */

export async function predictCashFlow(
  userId: string,
): Promise<EngineResult<CashFlowPrediction>> {
  const startMs = Date.now();
  const today = new Date();
  const todayKey = toDateKey(today);

  // Step 1: Gather transaction history (90 days)
  const { transactions } = await listAnalyzableTransactions({
    userId,
    lookbackDays: 90,
  });

  // Step 2: Account completeness
  const completeness = await computeAccountCompleteness(userId);

  // Step 3: Wallet balance
  const wallet = await getWallet(userId);
  const currentBalance = wallet.balance;
  const balanceSource: CashFlowPrediction['balanceSource'] = 'current';

  // Step 4: Build day-of-month histogram from historical transactions
  const { incomeByDay, expenseByDay } = buildDayOfMonthHistogram(transactions);

  // Step 5: Load recurring subscriptions
  const subscriptions = await detectAndPersistRecurringSubscriptions(userId);
  const recurringByDay = recurringObligationsByDay(subscriptions);

  // Compute total monthly recurring obligations
  let recurringObligations30d = 0;
  for (const cost of recurringByDay.values()) {
    recurringObligations30d += cost;
  }

  // Step 6: Forward-project day-by-day for 90 days
  const dayByDay: CashFlowPrediction['dayByDay'] = [];
  let runningBalance = currentBalance;
  let daysUntilNegative: number | null = null;
  let projectedIncome30d = 0;
  let projectedExpenses30d = 0;

  for (let dayOffset = 1; dayOffset <= PROJECTION_DAYS; dayOffset++) {
    const futureDate = addDays(today, dayOffset);
    const dom = futureDate.getUTCDate();
    const dateKey = toDateKey(futureDate);

    // Predicted income for this day based on historical average
    const predictedIncome = incomeByDay.get(dom) ?? 0;

    // Predicted expense: historical average + known recurring
    const historicalExpense = expenseByDay.get(dom) ?? 0;
    const recurringExpense = recurringByDay.get(dom) ?? 0;

    // Avoid double-counting: if recurring already reflected in historical,
    // take the larger of the two rather than summing
    const predictedExpense = Math.max(historicalExpense, recurringExpense);

    runningBalance += predictedIncome - predictedExpense;

    if (dayOffset <= 30) {
      projectedIncome30d += predictedIncome;
      projectedExpenses30d += predictedExpense;
    }

    if (daysUntilNegative === null && runningBalance < 0) {
      daysUntilNegative = dayOffset;
    }

    dayByDay.push({
      date: dateKey,
      predictedBalance: Math.round(runningBalance * 100) / 100,
      income: Math.round(predictedIncome * 100) / 100,
      expenses: Math.round(predictedExpense * 100) / 100,
    });
  }

  const predictedBalance30d =
    dayByDay.length >= 30
      ? dayByDay[29].predictedBalance
      : runningBalance;

  // Step 7: Safe-to-spend calculations
  const todayDom = today.getUTCDate();
  const obligationsToday = recurringByDay.get(todayDom) ?? 0;
  const safeToSpendToday = Math.max(0, currentBalance - obligationsToday);

  // Obligations next 7 days
  let obligationsNext7d = 0;
  for (let d = 0; d < 7; d++) {
    const futureDate = addDays(today, d);
    const dom = futureDate.getUTCDate();
    obligationsNext7d += recurringByDay.get(dom) ?? 0;
    obligationsNext7d += expenseByDay.get(dom) ?? 0;
  }
  const safeToSpendThisWeek = Math.max(0, currentBalance - obligationsNext7d);

  // Safe to spend until next income
  const incomeInfo = analyzeIncomeInterval(transactions, today);
  let safeToSpendUntilNextIncome: number | null = null;

  if (
    incomeInfo.incomeCount >= 2 &&
    incomeInfo.intervalConfidence >= 0.7 &&
    incomeInfo.nextIncomeDate !== null
  ) {
    const obligationsUntilIncome = sumObligationsBetween(
      recurringByDay,
      expenseByDay,
      today,
      incomeInfo.nextIncomeDate,
    );
    safeToSpendUntilNextIncome = Math.max(
      0,
      currentBalance - obligationsUntilIncome,
    );
  }

  // Step 8: Confidence scoring
  const txConfidence = Math.min(transactions.length / 50, 1);
  const overallConfidence =
    Math.round(txConfidence * 0.6 + completeness.completenessScore * 0.4 * 100) / 100;

  const reasons: string[] = [];
  const insufficientDataReasons: string[] = [];

  if (transactions.length < 10) {
    insufficientDataReasons.push(
      `Only ${transactions.length} transactions found in the last 90 days.`,
    );
  }
  if (completeness.connectedAccountCount === 0) {
    insufficientDataReasons.push('No connected accounts found.');
  }
  if (completeness.staleAccountCount > 0) {
    reasons.push(
      `${completeness.staleAccountCount} account(s) have stale sync data.`,
    );
  }

  reasons.push(
    `Projected from ${transactions.length} transactions over 90 days.`,
  );
  reasons.push(
    `${subscriptions.length} recurring subscription(s) factored into projections.`,
  );

  const sourceTransactionIds = transactions.map((tx) => tx.id);

  const contributingFactors = [
    {
      factor: 'Transaction history depth',
      weight: 0.3,
      value: `${transactions.length} transactions`,
    },
    {
      factor: 'Account completeness',
      weight: 0.2,
      value: `${(completeness.completenessScore * 100).toFixed(0)}%`,
    },
    {
      factor: 'Recurring subscriptions',
      weight: 0.2,
      value: `${subscriptions.length} detected`,
    },
    {
      factor: 'Income predictability',
      weight: 0.15,
      value: `${(incomeInfo.intervalConfidence * 100).toFixed(0)}% confidence`,
    },
    {
      factor: 'Current balance',
      weight: 0.15,
      value: `$${currentBalance.toFixed(2)}`,
    },
  ];

  const data: CashFlowPrediction = {
    currentBalance: Math.round(currentBalance * 100) / 100,
    balanceSource,
    balanceAsOf: todayKey,
    predictedBalance30d: Math.round(predictedBalance30d * 100) / 100,
    daysUntilNegative,
    safeToSpendToday: Math.round(safeToSpendToday * 100) / 100,
    safeToSpendThisWeek: Math.round(safeToSpendThisWeek * 100) / 100,
    safeToSpendUntilNextIncome:
      safeToSpendUntilNextIncome !== null
        ? Math.round(safeToSpendUntilNextIncome * 100) / 100
        : null,
    projectedIncome30d: Math.round(projectedIncome30d * 100) / 100,
    projectedExpenses30d: Math.round(projectedExpenses30d * 100) / 100,
    recurringObligations30d: Math.round(recurringObligations30d * 100) / 100,
    dayByDay,
    explanation: buildCashFlowExplanation({
      currentBalance,
      predictedBalance30d,
      daysUntilNegative,
      projectedIncome30d,
      projectedExpenses30d,
    }),
    contributingFactors,
  };

  const status: EngineResult<CashFlowPrediction>['status'] =
    insufficientDataReasons.length > 0
      ? transactions.length === 0
        ? 'insufficient_data'
        : 'partial'
      : 'success';

  const result: EngineResult<CashFlowPrediction> = {
    status,
    confidence: overallConfidence,
    coverageConfidence: completeness.completenessScore,
    reasons,
    insufficientDataReasons,
    sourceTransactionIds,
    dedupKey: buildDedupKey({
      userId,
      engine: 'cashflow',
      entity: 'prediction',
      window: todayKey,
    }),
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    data,
  };

  // Step 9: Persist snapshot and record metric
  await saveCashFlowSnapshot(userId, {
    prediction: data as unknown as Record<string, unknown>,
    coverageConfidence: completeness.completenessScore,
    sourceTransactionIds,
    dedupKey: result.dedupKey,
  });

  recordEngineMetric({
    engine: 'cashflow',
    event: 'predict',
    userId,
    latencyMs: Date.now() - startMs,
    count: transactions.length,
    confidence: overallConfidence,
  });

  return result;
}

/* ------------------------------------------------------------------ */
/*  Explanation builder                                                */
/* ------------------------------------------------------------------ */

function buildCashFlowExplanation(input: {
  currentBalance: number;
  predictedBalance30d: number;
  daysUntilNegative: number | null;
  projectedIncome30d: number;
  projectedExpenses30d: number;
}): string {
  const parts: string[] = [];

  const balanceDelta = input.predictedBalance30d - input.currentBalance;
  const direction = balanceDelta >= 0 ? 'increase' : 'decrease';
  const absChange = Math.abs(balanceDelta);

  parts.push(
    `Your balance is projected to ${direction} by $${absChange.toFixed(2)} ` +
      `over the next 30 days, from $${input.currentBalance.toFixed(2)} ` +
      `to $${input.predictedBalance30d.toFixed(2)}.`,
  );

  if (input.daysUntilNegative !== null) {
    parts.push(
      `Warning: your balance may go negative in ${input.daysUntilNegative} day(s) ` +
        `based on current spending patterns.`,
    );
  }

  parts.push(
    `Projected income: $${input.projectedIncome30d.toFixed(2)}. ` +
      `Projected expenses: $${input.projectedExpenses30d.toFixed(2)}.`,
  );

  return parts.join(' ');
}
