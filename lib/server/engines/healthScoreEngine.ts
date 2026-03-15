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
import {
  saveHealthSnapshot,
  getHealthSnapshotAt,
} from '@/lib/server/engines/snapshotStore';
import { recordEngineMetric } from '@/lib/server/engines/engineMetrics';
import { getWallet } from '@/lib/server/ledger';
import type { StatementTransaction } from '@/transactions/transactionRepository';
import type { DetectedSubscription } from '@/subscription_intelligence/subscriptionService';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ComponentScore extends Explainable {
  score: number;
  value: number;
  label: string;
}

export interface FinancialHealthScore extends Explainable {
  rawOverallScore: number;
  adjustedOverallScore: number;
  components: {
    savingsRate: ComponentScore;
    spendingStability: ComponentScore;
    subscriptionBurden: ComponentScore;
    cashCushion: ComponentScore;
    billConsistency: ComponentScore;
  };
  trend: 'improving' | 'stable' | 'declining';
  topRecommendation: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const WEIGHTS = {
  savingsRate: 0.25,
  spendingStability: 0.2,
  subscriptionBurden: 0.2,
  cashCushion: 0.2,
  billConsistency: 0.15,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function weekNumber(dateStr: string, baseMs: number): number {
  const ms = Date.parse(dateStr);
  return Math.floor((ms - baseMs) / (7 * MS_PER_DAY));
}

/* ------------------------------------------------------------------ */
/*  Component scorers                                                  */
/* ------------------------------------------------------------------ */

function scoreSavingsRate(
  transactions: StatementTransaction[],
): ComponentScore {
  const totalIncome = transactions
    .filter((tx) => tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalExpenses = transactions
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  if (totalIncome === 0) {
    return {
      score: 0,
      value: 0,
      label: 'Savings Rate',
      explanation: 'No income detected in the analysis period.',
      contributingFactors: [
        { factor: 'Total income', weight: 1, value: '$0.00' },
      ],
    };
  }

  const rate = (totalIncome - totalExpenses) / totalIncome;
  // 100 if rate >= 0.20, linear to 0 at rate <= 0
  const score = rate >= 0.2
    ? 100
    : rate <= 0
      ? 0
      : (rate / 0.2) * 100;

  return {
    score: Math.round(score),
    value: Math.round(rate * 1000) / 10,
    label: 'Savings Rate',
    explanation:
      rate >= 0.2
        ? `Excellent savings rate of ${(rate * 100).toFixed(1)}%.`
        : rate > 0
          ? `Savings rate is ${(rate * 100).toFixed(1)}%, below the 20% target.`
          : `Spending exceeds income by $${Math.abs(totalIncome - totalExpenses).toFixed(2)}.`,
    contributingFactors: [
      { factor: 'Total income', weight: 0.5, value: `$${totalIncome.toFixed(2)}` },
      { factor: 'Total expenses', weight: 0.5, value: `$${totalExpenses.toFixed(2)}` },
    ],
  };
}

function scoreSpendingStability(
  transactions: StatementTransaction[],
): ComponentScore {
  const expenses = transactions.filter((tx) => tx.amount < 0);

  if (expenses.length < 4) {
    return {
      score: 50,
      value: 0,
      label: 'Spending Stability',
      explanation: 'Not enough expense data for stability analysis.',
      contributingFactors: [
        { factor: 'Expense transactions', weight: 1, value: `${expenses.length}` },
      ],
    };
  }

  // Group expenses by week (last 12 weeks = ~84 days)
  const sortedDates = expenses.map((tx) => Date.parse(tx.occurred_at)).sort((a, b) => a - b);
  const baseMs = sortedDates[0];

  const weeklyTotals = new Map<number, number>();
  for (const tx of expenses) {
    const wk = weekNumber(tx.occurred_at, baseMs);
    weeklyTotals.set(wk, (weeklyTotals.get(wk) ?? 0) + Math.abs(tx.amount));
  }

  const weekValues = Array.from(weeklyTotals.values());
  if (weekValues.length < 2) {
    return {
      score: 50,
      value: 0,
      label: 'Spending Stability',
      explanation: 'Insufficient weekly data for stability scoring.',
      contributingFactors: [
        { factor: 'Weeks with data', weight: 1, value: `${weekValues.length}` },
      ],
    };
  }

  const mean = weekValues.reduce((a, b) => a + b, 0) / weekValues.length;
  const variance =
    weekValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / weekValues.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0;

  // Lower CV = higher score. CV of 0 = 100, CV >= 1 = 0
  const score = clamp((1 - cv) * 100, 0, 100);

  return {
    score: Math.round(score),
    value: Math.round(cv * 100) / 100,
    label: 'Spending Stability',
    explanation:
      cv < 0.2
        ? 'Spending is very consistent week over week.'
        : cv < 0.5
          ? 'Spending shows moderate variation week to week.'
          : 'Spending varies significantly between weeks.',
    contributingFactors: [
      { factor: 'Weekly mean', weight: 0.5, value: `$${mean.toFixed(2)}` },
      { factor: 'Coefficient of variation', weight: 0.5, value: cv.toFixed(3) },
    ],
  };
}

function scoreSubscriptionBurden(
  subscriptions: DetectedSubscription[],
  monthlyIncome: number,
): ComponentScore {
  const activeSubscriptions = subscriptions.filter(
    (s) => s.status !== 'inactive' && s.status !== 'ignored' && s.confidence >= 0.5,
  );
  const totalRecurring = activeSubscriptions.reduce(
    (sum, s) => sum + s.estimated_monthly_cost,
    0,
  );

  if (monthlyIncome <= 0) {
    return {
      score: totalRecurring === 0 ? 100 : 0,
      value: totalRecurring,
      label: 'Subscription Burden',
      explanation:
        totalRecurring === 0
          ? 'No recurring subscriptions detected.'
          : 'Cannot calculate burden ratio without income data.',
      contributingFactors: [
        { factor: 'Monthly recurring', weight: 0.5, value: `$${totalRecurring.toFixed(2)}` },
        { factor: 'Monthly income', weight: 0.5, value: '$0.00' },
      ],
    };
  }

  const ratio = totalRecurring / monthlyIncome;
  // 100 if ratio < 10%, 0 if ratio >= 50%
  const score = ratio <= 0.1
    ? 100
    : ratio >= 0.5
      ? 0
      : ((0.5 - ratio) / 0.4) * 100;

  return {
    score: Math.round(score),
    value: Math.round(ratio * 1000) / 10,
    label: 'Subscription Burden',
    explanation:
      ratio < 0.1
        ? `Subscriptions consume only ${(ratio * 100).toFixed(1)}% of income.`
        : ratio < 0.3
          ? `Subscriptions consume ${(ratio * 100).toFixed(1)}% of income.`
          : `Subscriptions consume a high ${(ratio * 100).toFixed(1)}% of income.`,
    contributingFactors: [
      { factor: 'Monthly recurring', weight: 0.5, value: `$${totalRecurring.toFixed(2)}` },
      { factor: 'Monthly income', weight: 0.5, value: `$${monthlyIncome.toFixed(2)}` },
    ],
  };
}

function scoreCashCushion(
  balance: number,
  monthlyExpenses: number,
): ComponentScore {
  if (monthlyExpenses <= 0) {
    return {
      score: balance > 0 ? 100 : 0,
      value: balance > 0 ? 99 : 0,
      label: 'Cash Cushion',
      explanation:
        balance > 0
          ? 'Positive balance with no detected expenses.'
          : 'No balance or expenses detected.',
      contributingFactors: [
        { factor: 'Balance', weight: 0.5, value: `$${balance.toFixed(2)}` },
        { factor: 'Monthly expenses', weight: 0.5, value: '$0.00' },
      ],
    };
  }

  const months = balance / monthlyExpenses;
  // 100 if >= 3 months, 0 if < 0.5 months
  const score = months >= 3
    ? 100
    : months < 0.5
      ? 0
      : ((months - 0.5) / 2.5) * 100;

  return {
    score: Math.round(score),
    value: Math.round(months * 10) / 10,
    label: 'Cash Cushion',
    explanation:
      months >= 3
        ? `You have ${months.toFixed(1)} months of expenses covered.`
        : months >= 1
          ? `You have ${months.toFixed(1)} months of expenses covered; aim for 3+.`
          : `Cash cushion covers only ${months.toFixed(1)} months of expenses.`,
    contributingFactors: [
      { factor: 'Current balance', weight: 0.5, value: `$${balance.toFixed(2)}` },
      { factor: 'Monthly expenses', weight: 0.5, value: `$${monthlyExpenses.toFixed(2)}` },
    ],
  };
}

function scoreBillConsistency(
  transactions: StatementTransaction[],
  subscriptions: DetectedSubscription[],
): ComponentScore {
  const activeSubs = subscriptions.filter(
    (s) => s.status !== 'inactive' && s.status !== 'ignored' && s.confidence >= 0.5,
  );

  if (activeSubs.length === 0) {
    return {
      score: 100,
      value: 100,
      label: 'Bill Consistency',
      explanation: 'No recurring bills to track.',
      contributingFactors: [
        { factor: 'Tracked bills', weight: 1, value: '0' },
      ],
    };
  }

  // For each subscription, check if a matching payment exists within
  // expected interval + 5 day grace period
  let paidOnTime = 0;

  for (const sub of activeSubs) {
    const merchantLower = sub.merchant.trim().toLowerCase();
    const lastSeenMs = Date.parse(sub.last_seen);

    // Determine expected interval in days
    let intervalDays = 30;
    if (sub.recurrence_interval === 'weekly') intervalDays = 7;
    else if (sub.recurrence_interval === 'biweekly') intervalDays = 14;
    else if (sub.recurrence_interval === 'annual' || sub.recurrence_interval === 'yearly') intervalDays = 365;
    else if (sub.recurrence_interval === 'quarterly') intervalDays = 90;

    const graceDays = 5;
    const windowMs = (intervalDays + graceDays) * MS_PER_DAY;

    // Look for a payment to this merchant within the expected window
    // after last_seen
    const found = transactions.some((tx) => {
      if (tx.amount >= 0) return false;
      const txMerchant = (tx.normalized_merchant || tx.merchant_name)
        .trim()
        .toLowerCase();
      if (txMerchant !== merchantLower) return false;

      const txMs = Date.parse(tx.occurred_at);
      const timeSinceLast = txMs - lastSeenMs;
      // Payment should be near the expected interval
      return timeSinceLast >= 0 && timeSinceLast <= windowMs;
    });

    if (found) paidOnTime += 1;
  }

  const ratio = paidOnTime / activeSubs.length;
  const score = Math.round(ratio * 100);

  return {
    score,
    value: Math.round(ratio * 100),
    label: 'Bill Consistency',
    explanation:
      ratio >= 0.9
        ? `${paidOnTime} of ${activeSubs.length} bills paid on time.`
        : ratio >= 0.6
          ? `${paidOnTime} of ${activeSubs.length} bills paid on time; some were late or missed.`
          : `Only ${paidOnTime} of ${activeSubs.length} bills were paid on time.`,
    contributingFactors: [
      { factor: 'Bills paid on time', weight: 0.5, value: `${paidOnTime}` },
      { factor: 'Total tracked bills', weight: 0.5, value: `${activeSubs.length}` },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Trend detection                                                    */
/* ------------------------------------------------------------------ */

async function detectTrend(
  userId: string,
  currentRaw: number,
): Promise<FinancialHealthScore['trend']> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().slice(0, 10);

  const previous = await getHealthSnapshotAt(userId, dateStr);

  if (!previous || typeof previous.overallScore !== 'number') {
    return 'stable';
  }

  const delta = currentRaw - previous.overallScore;
  if (delta > 3) return 'improving';
  if (delta < -3) return 'declining';
  return 'stable';
}

/* ------------------------------------------------------------------ */
/*  Recommendation                                                     */
/* ------------------------------------------------------------------ */

function generateTopRecommendation(
  components: FinancialHealthScore['components'],
): string {
  const ranked = [
    { key: 'savingsRate', score: components.savingsRate.score },
    { key: 'spendingStability', score: components.spendingStability.score },
    { key: 'subscriptionBurden', score: components.subscriptionBurden.score },
    { key: 'cashCushion', score: components.cashCushion.score },
    { key: 'billConsistency', score: components.billConsistency.score },
  ].sort((a, b) => a.score - b.score);

  const lowest = ranked[0];

  switch (lowest.key) {
    case 'savingsRate':
      return 'Focus on increasing your savings rate. Try to save at least 20% of income by reducing discretionary spending.';
    case 'spendingStability':
      return 'Your spending varies significantly. Consider setting weekly budgets to create more predictable cash flow.';
    case 'subscriptionBurden':
      return 'Subscriptions consume a large share of income. Review and cancel unused subscriptions to free up cash flow.';
    case 'cashCushion':
      return 'Build up your cash reserve. Aim for at least 3 months of expenses in savings for financial security.';
    case 'billConsistency':
      return 'Some bills are being paid late. Set up automatic payments or reminders to improve payment consistency.';
    default:
      return 'Continue monitoring your financial health and look for areas to optimize.';
  }
}

/* ------------------------------------------------------------------ */
/*  Main export                                                        */
/* ------------------------------------------------------------------ */

export async function computeHealthScore(
  userId: string,
): Promise<EngineResult<FinancialHealthScore>> {
  const startMs = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Gather data
  const { transactions } = await listAnalyzableTransactions({
    userId,
    lookbackDays: 90,
  });

  const completeness = await computeAccountCompleteness(userId);
  const wallet = await getWallet(userId);
  const subscriptions = await detectAndPersistRecurringSubscriptions(userId);

  // Compute monthly aggregates (use 3-month window, divide by 3)
  const totalIncome = transactions
    .filter((tx) => tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpenses = transactions
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  const monthlyIncome = totalIncome / 3;
  const monthlyExpenses = totalExpenses / 3;

  // Score each component
  const savingsRate = scoreSavingsRate(transactions);
  const spendingStability = scoreSpendingStability(transactions);
  const subscriptionBurden = scoreSubscriptionBurden(subscriptions, monthlyIncome);
  const cashCushion = scoreCashCushion(wallet.balance, monthlyExpenses);
  const billConsistency = scoreBillConsistency(transactions, subscriptions);

  const components: FinancialHealthScore['components'] = {
    savingsRate,
    spendingStability,
    subscriptionBurden,
    cashCushion,
    billConsistency,
  };

  // Weighted average (raw)
  const rawOverallScore = Math.round(
    savingsRate.score * WEIGHTS.savingsRate +
      spendingStability.score * WEIGHTS.spendingStability +
      subscriptionBurden.score * WEIGHTS.subscriptionBurden +
      cashCushion.score * WEIGHTS.cashCushion +
      billConsistency.score * WEIGHTS.billConsistency,
  );

  // Adjusted by account completeness
  const adjustedOverallScore = Math.round(
    rawOverallScore * completeness.completenessScore,
  );

  // Trend
  const trend = await detectTrend(userId, rawOverallScore);

  // Top recommendation
  const topRecommendation = generateTopRecommendation(components);

  const data: FinancialHealthScore = {
    rawOverallScore,
    adjustedOverallScore,
    components,
    trend,
    topRecommendation,
    explanation: buildHealthExplanation(rawOverallScore, adjustedOverallScore, trend),
    contributingFactors: [
      { factor: 'Savings rate', weight: WEIGHTS.savingsRate, value: `${savingsRate.score}/100` },
      { factor: 'Spending stability', weight: WEIGHTS.spendingStability, value: `${spendingStability.score}/100` },
      { factor: 'Subscription burden', weight: WEIGHTS.subscriptionBurden, value: `${subscriptionBurden.score}/100` },
      { factor: 'Cash cushion', weight: WEIGHTS.cashCushion, value: `${cashCushion.score}/100` },
      { factor: 'Bill consistency', weight: WEIGHTS.billConsistency, value: `${billConsistency.score}/100` },
    ],
  };

  // Envelope
  const reasons: string[] = [
    `Scored from ${transactions.length} transactions over 90 days.`,
    `${subscriptions.length} subscription(s) analyzed.`,
  ];
  const insufficientDataReasons: string[] = [];

  if (transactions.length < 10) {
    insufficientDataReasons.push(
      `Only ${transactions.length} transactions available for scoring.`,
    );
  }
  if (completeness.connectedAccountCount === 0) {
    insufficientDataReasons.push('No connected accounts found.');
  }

  const txConfidence = Math.min(transactions.length / 50, 1);
  const confidence =
    Math.round(txConfidence * 0.6 + completeness.completenessScore * 0.4 * 100) / 100;

  const status: EngineResult<FinancialHealthScore>['status'] =
    insufficientDataReasons.length > 0
      ? transactions.length === 0
        ? 'insufficient_data'
        : 'partial'
      : 'success';

  const result: EngineResult<FinancialHealthScore> = {
    status,
    confidence,
    coverageConfidence: completeness.completenessScore,
    reasons,
    insufficientDataReasons,
    sourceTransactionIds: transactions.map((tx) => tx.id),
    dedupKey: buildDedupKey({
      userId,
      engine: 'health',
      entity: 'score',
      window: today,
    }),
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    data,
  };

  // Persist snapshot and record metric
  await saveHealthSnapshot(userId, {
    overallScore: rawOverallScore,
    spendingScore: spendingStability.score,
    savingsScore: savingsRate.score,
    coverageConfidence: completeness.completenessScore,
    contributingFactors: data.contributingFactors,
    sourceTransactionIds: transactions.map((tx) => tx.id),
    dedupKey: result.dedupKey,
  });

  recordEngineMetric({
    engine: 'health',
    event: 'score',
    userId,
    latencyMs: Date.now() - startMs,
    count: transactions.length,
    confidence,
  });

  return result;
}

/* ------------------------------------------------------------------ */
/*  Explanation builder                                                */
/* ------------------------------------------------------------------ */

function buildHealthExplanation(
  raw: number,
  adjusted: number,
  trend: FinancialHealthScore['trend'],
): string {
  const rating =
    raw >= 80
      ? 'excellent'
      : raw >= 60
        ? 'good'
        : raw >= 40
          ? 'fair'
          : 'needs attention';

  const trendText =
    trend === 'improving'
      ? 'and trending upward'
      : trend === 'declining'
        ? 'but trending downward'
        : 'and holding steady';

  return (
    `Your financial health score is ${raw}/100 (${rating}), ${trendText}. ` +
    `Adjusted for account coverage: ${adjusted}/100.`
  );
}
