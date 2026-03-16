import type {
  MoneyAdvancedIntelligence,
  MoneyAffordability,
  MoneyBillPrediction,
  MoneyConnectedAccountInput,
  MoneyCoverage,
  MoneyCreditUtilizationOptimizer,
  MoneyDebtPayoffSimulator,
  MoneyFinancialRiskScoring,
  MoneyFinancialStressDetection,
  MoneyIncomeStabilityAnalysis,
  MoneyInvestmentPortfolioAnalysis,
  MoneyLifeGoalPlanning,
  MoneyMonthlySurvivalForecast,
  MoneyRetirementProjection,
  MoneyScenarioAssumptions,
  MoneyScenarioSimulation,
  MoneySpendingHabitAnalysis,
  MoneySpendingLimits,
  MoneyStatementAggregation,
  MoneyWeeklyPrediction,
} from "./types";

export interface MoneyAdvancedComputationInput {
  nowIso: string;
  currency: string;
  walletBalance: number;
  coverage: MoneyCoverage;
  statement: MoneyStatementAggregation;
  affordability: MoneyAffordability;
  weeklyPrediction: MoneyWeeklyPrediction;
  monthlySurvivalForecast: MoneyMonthlySurvivalForecast;
  spendingLimits: MoneySpendingLimits;
  connectedAccounts: MoneyConnectedAccountInput[];
  billPredictions: MoneyBillPrediction[];
}

interface DebtSnapshot {
  id: string;
  name: string;
  balance: number;
  aprEstimate: number;
  minPayment: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(value: string, keywords: string[]): boolean {
  const normalized = normalize(value);
  return keywords.some((keyword) => normalized.includes(keyword));
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

function scenarioStressLevel(input: {
  projectedEndBalance30d: number;
  projectedEndBalance90d: number;
  projectedBills30d: number;
  safeToSpendToday: number;
}): MoneyScenarioSimulation["stressLevel"] {
  if (input.projectedEndBalance30d < 0 || input.safeToSpendToday < 15) return "critical";
  if (input.projectedEndBalance30d < input.projectedBills30d * 0.2 || input.projectedEndBalance90d < 0) return "high";
  if (input.projectedEndBalance30d < input.projectedBills30d * 0.65) return "watch";
  return "low";
}

function buildDebtSnapshots(input: {
  connectedAccounts: MoneyConnectedAccountInput[];
  billPredictions: MoneyBillPrediction[];
}): DebtSnapshot[] {
  const debts: DebtSnapshot[] = [];

  for (const account of input.connectedAccounts) {
    const accountType = normalize(account.type || "");
    const rawBalance = typeof account.balance === "number" ? account.balance : 0;
    const balance = Math.abs(Math.min(0, rawBalance));
    const likelyDebt = accountType.includes("loan") || accountType.includes("credit") || rawBalance < -1;
    if (!likelyDebt || balance <= 1) continue;

    const aprEstimate = accountType.includes("student")
      ? 0.065
      : accountType.includes("credit")
        ? 0.24
        : 0.11;
    const minPayment = accountType.includes("credit")
      ? Math.max(35, balance * 0.03)
      : Math.max(25, balance * 0.02);

    debts.push({
      id: account.id,
      name: account.type || account.id,
      balance: round(balance),
      aprEstimate: round(aprEstimate),
      minPayment: round(minPayment),
    });
  }

  if (debts.length > 0) {
    return debts.sort((a, b) => b.balance - a.balance);
  }

  const debtLikeBills = input.billPredictions
    .filter((bill) => includesAny(bill.merchant, ["loan", "student loan", "card", "credit"]))
    .slice(0, 3);

  for (const bill of debtLikeBills) {
    debts.push({
      id: `inferred:${bill.id}`,
      name: bill.merchant,
      balance: round(Math.max(250, bill.amount * 16)),
      aprEstimate: includesAny(bill.merchant, ["student"]) ? 0.065 : 0.14,
      minPayment: round(Math.max(25, bill.amount * 0.9)),
    });
  }

  return debts;
}

function simulateDebtStrategy(input: {
  debts: DebtSnapshot[];
  monthlyPaymentBudget: number;
  strategy: "avalanche" | "snowball";
  nowIso: string;
  coverage: MoneyCoverage;
}): MoneyDebtPayoffSimulator["avalanche"] {
  if (input.debts.length === 0 || input.monthlyPaymentBudget <= 0) {
    return {
      strategy: input.strategy,
      monthsToDebtFree: null,
      payoffDate: null,
      totalInterest: 0,
      monthlyPaymentBudget: round(Math.max(0, input.monthlyPaymentBudget)),
      firstPriorityDebtId: null,
      confidence: round(clamp(input.coverage.confidence * 0.65, 0.2, 0.95)),
      explanation: "No debt balances or payment budget are available to simulate a payoff strategy.",
      factors: ["Debt simulation stayed in manual mode due to missing debt balance inputs."],
    };
  }

  const working = input.debts.map((debt) => ({
    ...debt,
    balance: debt.balance,
  }));

  const firstPriority = [...working]
    .sort((a, b) => {
      if (input.strategy === "avalanche") {
        if (b.aprEstimate !== a.aprEstimate) return b.aprEstimate - a.aprEstimate;
        return b.balance - a.balance;
      }
      if (a.balance !== b.balance) return a.balance - b.balance;
      return b.aprEstimate - a.aprEstimate;
    })[0];

  let month = 0;
  let totalInterest = 0;
  let solved = false;

  while (month < 360) {
    month += 1;
    for (const debt of working) {
      if (debt.balance <= 0.01) continue;
      const monthlyInterest = debt.balance * (debt.aprEstimate / 12);
      debt.balance += monthlyInterest;
      totalInterest += monthlyInterest;
    }

    let payment = input.monthlyPaymentBudget;
    const activeDebts = working.filter((debt) => debt.balance > 0.01);
    if (activeDebts.length === 0) {
      solved = true;
      break;
    }

    const totalMin = activeDebts.reduce((sum, debt) => sum + debt.minPayment, 0);
    if (payment <= totalMin) {
      for (const debt of activeDebts) {
        const share = totalMin > 0 ? payment * (debt.minPayment / totalMin) : 0;
        const applied = Math.min(debt.balance, share);
        debt.balance -= applied;
      }
      continue;
    }

    for (const debt of activeDebts) {
      const applied = Math.min(debt.balance, debt.minPayment, payment);
      debt.balance -= applied;
      payment -= applied;
      if (payment <= 0) break;
    }
    if (payment <= 0) continue;

    while (payment > 0.01) {
      const remaining = working.filter((debt) => debt.balance > 0.01);
      if (remaining.length === 0) {
        solved = true;
        break;
      }
      const target = [...remaining].sort((a, b) => {
        if (input.strategy === "avalanche") {
          if (b.aprEstimate !== a.aprEstimate) return b.aprEstimate - a.aprEstimate;
          return b.balance - a.balance;
        }
        if (a.balance !== b.balance) return a.balance - b.balance;
        return b.aprEstimate - a.aprEstimate;
      })[0];
      const applied = Math.min(target.balance, payment);
      target.balance -= applied;
      payment -= applied;
    }

    if (working.every((debt) => debt.balance <= 0.01)) {
      solved = true;
      break;
    }
  }

  const payoffDate = solved
    ? new Date(parseDate(input.nowIso) + month * 30 * MS_PER_DAY).toISOString()
    : null;
  const confidence = clamp(
    0.3 + input.coverage.confidence * 0.45 + Math.min(input.debts.length / 4, 1) * 0.25,
    0.2,
    0.98,
  );

  return {
    strategy: input.strategy,
    monthsToDebtFree: solved ? month : null,
    payoffDate,
    totalInterest: round(totalInterest),
    monthlyPaymentBudget: round(input.monthlyPaymentBudget),
    firstPriorityDebtId: firstPriority?.id || null,
    confidence: round(confidence),
    explanation: `Deterministic ${input.strategy} payoff simulation applies monthly interest, minimum payments, and targeted extra payments.`,
    factors: [
      `${input.debts.length} debt balance(s) included.`,
      `Monthly payment budget: ${round(input.monthlyPaymentBudget)}.`,
      solved ? `Debt-free in ${month} month(s).` : "Simulation horizon reached before full payoff.",
    ],
  };
}

function buildIncomeStabilityAnalysis(input: MoneyAdvancedComputationInput): MoneyIncomeStabilityAnalysis {
  const incomes = input.statement.classifiedTransactions
    .filter((tx) => tx.kind === "income")
    .map((tx) => ({
      amount: Math.abs(tx.amount),
      at: parseDate(tx.occurredAt),
    }))
    .sort((a, b) => a.at - b.at);

  const lookback90 = parseDate(input.nowIso) - 90 * MS_PER_DAY;
  const recent = incomes.filter((income) => income.at >= lookback90);
  const amounts = recent.map((income) => income.amount);
  const avgAmount = mean(amounts);
  const amountVolatility = avgAmount > 0 ? stdDev(amounts) / avgAmount : 0;

  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i += 1) {
    intervals.push((recent[i].at - recent[i - 1].at) / MS_PER_DAY);
  }
  const avgInterval = intervals.length > 0 ? mean(intervals) : null;
  const intervalVolatility = avgInterval && avgInterval > 0 ? stdDev(intervals) / avgInterval : null;
  const reliable = Boolean(
    recent.length >= 3
      && avgInterval !== null
      && avgInterval >= 7
      && avgInterval <= 45
      && intervalVolatility !== null
      && intervalVolatility <= 0.35,
  );

  const nextExpectedIncomeDate = reliable && avgInterval !== null
    ? new Date(recent[recent.length - 1].at + avgInterval * MS_PER_DAY).toISOString()
    : null;

  const confidence = clamp(
    0.2 + input.coverage.confidence * 0.45 + Math.min(recent.length / 8, 1) * 0.35 + (reliable ? 0.08 : 0),
    0.2,
    0.98,
  );

  return {
    reliable,
    incomeCount90d: recent.length,
    averageIncomeAmount: round(avgAmount),
    incomeAmountVolatilityPct: round(amountVolatility * 100),
    averageIncomeIntervalDays: avgInterval === null ? null : round(avgInterval),
    intervalVolatilityPct: intervalVolatility === null ? null : round(intervalVolatility * 100),
    nextExpectedIncomeDate,
    confidence: round(confidence),
    explanation: "Income stability is based on observed deposit cadence regularity and paycheck amount volatility over recent history.",
    factors: [
      `${recent.length} income signal(s) in the last 90 days.`,
      avgInterval === null
        ? "Not enough intervals to infer a reliable cadence."
        : `Average interval: ${round(avgInterval)} day(s).`,
      `Amount volatility: ${round(amountVolatility * 100)}%.`,
    ],
  };
}

function buildSpendingHabitAnalysis(input: MoneyAdvancedComputationInput): MoneySpendingHabitAnalysis {
  const nowMs = parseDate(input.nowIso);
  const lookback90 = nowMs - 90 * MS_PER_DAY;
  const expenses = input.statement.classifiedTransactions
    .filter((tx) => tx.kind === "expense")
    .filter((tx) => parseDate(tx.occurredAt) >= lookback90);

  const totalSpend = expenses.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const byCategory = new Map<string, number>();
  let weekendSpend = 0;
  let discretionarySpend = 0;

  for (const tx of expenses) {
    const key = normalize(tx.effectiveCategory || tx.category || "uncategorized");
    byCategory.set(key, (byCategory.get(key) ?? 0) + Math.abs(tx.amount));

    const day = new Date(parseDate(tx.occurredAt)).getUTCDay();
    if (day === 0 || day === 6) weekendSpend += Math.abs(tx.amount);
    if (includesAny(`${tx.effectiveCategory} ${tx.category} ${tx.merchant}`, ["dining", "entertainment", "shopping", "travel", "nightlife", "bar", "club", "coffee"])) {
      discretionarySpend += Math.abs(tx.amount);
    }
  }

  const ordered = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const topCategory = ordered[0]?.[0] || null;
  const topCategoryConcentrationPct = totalSpend > 0 ? (ordered[0]?.[1] || 0) / totalSpend : 0;
  const weekendSpendPct = totalSpend > 0 ? weekendSpend / totalSpend : 0;
  const discretionarySpendPct = totalSpend > 0 ? discretionarySpend / totalSpend : 0;

  const recent30Start = nowMs - 30 * MS_PER_DAY;
  const prior30Start = nowMs - 60 * MS_PER_DAY;
  const recent30 = expenses
    .filter((tx) => parseDate(tx.occurredAt) >= recent30Start)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const prior30 = expenses
    .filter((tx) => {
      const at = parseDate(tx.occurredAt);
      return at >= prior30Start && at < recent30Start;
    })
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const spendTrend30dPct = prior30 > 0 ? ((recent30 - prior30) / prior30) * 100 : 0;

  const habitRiskLevel: MoneySpendingHabitAnalysis["habitRiskLevel"] =
    topCategoryConcentrationPct > 0.42 || discretionarySpendPct > 0.55 || spendTrend30dPct > 25
      ? "risky"
      : topCategoryConcentrationPct > 0.32 || discretionarySpendPct > 0.45 || spendTrend30dPct > 12
        ? "watch"
        : "steady";

  const confidence = clamp(
    0.2 + input.coverage.confidence * 0.45 + Math.min(expenses.length / 90, 1) * 0.35,
    0.2,
    0.98,
  );

  return {
    averageDailySpend90d: round(totalSpend / 90),
    topCategory,
    topCategoryConcentrationPct: round(topCategoryConcentrationPct * 100),
    discretionarySpendPct: round(discretionarySpendPct * 100),
    weekendSpendPct: round(weekendSpendPct * 100),
    spendTrend30dPct: round(spendTrend30dPct),
    habitRiskLevel,
    confidence: round(confidence),
    explanation: "Spending habit analysis uses category concentration, discretionary mix, weekend bias, and 30-day trend acceleration.",
    factors: [
      topCategory ? `Top category: ${topCategory} (${round(topCategoryConcentrationPct * 100)}%).` : "No dominant category found yet.",
      `Discretionary spend share: ${round(discretionarySpendPct * 100)}%.`,
      `30-day trend vs previous 30 days: ${round(spendTrend30dPct)}%.`,
    ],
  };
}

function buildCreditUtilizationOptimizer(input: {
  connectedAccounts: MoneyConnectedAccountInput[];
  affordability: MoneyAffordability;
  coverage: MoneyCoverage;
}): MoneyCreditUtilizationOptimizer {
  const creditAccounts = input.connectedAccounts
    .filter((account) => includesAny(account.type || "", ["credit", "card"]))
    .map((account) => {
      const currentBalance = Math.abs(Math.min(0, account.balance ?? 0));
      const estimatedLimit = Math.max(500, currentBalance * 2.3, 1200);
      const utilizationRatio = estimatedLimit > 0 ? currentBalance / estimatedLimit : 0;
      const paymentToSafe = Math.max(0, currentBalance - estimatedLimit * 0.3);
      return {
        accountId: account.id,
        accountName: account.type || account.id,
        currentBalance: round(currentBalance),
        estimatedLimit: round(estimatedLimit),
        utilizationRatio: round(utilizationRatio),
        paymentToReachSafeUtilization: round(paymentToSafe),
      };
    })
    .filter((account) => account.currentBalance > 0);

  if (creditAccounts.length === 0) {
    return {
      utilizationRatio: null,
      safeUtilizationTargetRatio: 0.3,
      idealUtilizationTargetRatio: 0.1,
      recommendedPaymentThisMonth: 0,
      paymentToReachSafeUtilization: 0,
      paymentToReachIdealUtilization: 0,
      accountTargets: [],
      status: "manual",
      confidence: round(clamp(input.coverage.confidence * 0.55, 0.2, 0.9)),
      explanation: "No credit-line balance data was found, so utilization optimization stays manual-first.",
      factors: ["Connect credit accounts (or add balances manually) to receive deterministic utilization targets."],
    };
  }

  const totalBalance = creditAccounts.reduce((sum, account) => sum + account.currentBalance, 0);
  const totalLimit = creditAccounts.reduce((sum, account) => sum + account.estimatedLimit, 0);
  const utilizationRatio = totalLimit > 0 ? totalBalance / totalLimit : 0;
  const paymentToSafeUtilization = Math.max(0, totalBalance - totalLimit * 0.3);
  const paymentToIdealUtilization = Math.max(0, totalBalance - totalLimit * 0.1);
  const recommendedPaymentThisMonth = Math.min(
    paymentToSafeUtilization,
    Math.max(0, input.affordability.safeToSpendThisMonth * 0.45),
  );

  const status: MoneyCreditUtilizationOptimizer["status"] =
    utilizationRatio > 0.7
      ? "high"
      : utilizationRatio > 0.4
        ? "watch"
        : "safe";

  const inferredPenalty = 0.08;
  const confidence = clamp(
    0.3 + input.coverage.confidence * 0.45 + Math.min(creditAccounts.length / 4, 1) * 0.25 - inferredPenalty,
    0.2,
    0.95,
  );

  return {
    utilizationRatio: round(utilizationRatio),
    safeUtilizationTargetRatio: 0.3,
    idealUtilizationTargetRatio: 0.1,
    recommendedPaymentThisMonth: round(recommendedPaymentThisMonth),
    paymentToReachSafeUtilization: round(paymentToSafeUtilization),
    paymentToReachIdealUtilization: round(paymentToIdealUtilization),
    accountTargets: creditAccounts,
    status,
    confidence: round(confidence),
    explanation: "Utilization targets are deterministic and recommendation-only. Calico never executes credit payments automatically.",
    factors: [
      `Current utilization: ${round(utilizationRatio * 100)}%.`,
      `Payment to reach <=30% utilization: ${round(paymentToSafeUtilization)}.`,
      "Credit limits are conservatively inferred when explicit limit data is unavailable.",
    ],
  };
}

function buildDebtPayoffSimulator(input: {
  nowIso: string;
  debts: DebtSnapshot[];
  affordability: MoneyAffordability;
  spendingLimits: MoneySpendingLimits;
  incomeStability: MoneyIncomeStabilityAnalysis;
  coverage: MoneyCoverage;
}): MoneyDebtPayoffSimulator {
  const totalDebtBalance = input.debts.reduce((sum, debt) => sum + debt.balance, 0);
  const totalMinPayment = input.debts.reduce((sum, debt) => sum + debt.minPayment, 0);
  const paymentBudget = round(
    Math.max(
      totalMinPayment,
      Math.min(
        Math.max(40, input.affordability.safeToSpendThisMonth * 0.45),
        Math.max(totalMinPayment, input.spendingLimits.monthlyLimit * 0.4),
      ),
    ),
  );

  const monthlyIncomeEstimate = input.incomeStability.averageIncomeAmount > 0
    ? input.incomeStability.averageIncomeAmount * (input.incomeStability.averageIncomeIntervalDays ? 30 / input.incomeStability.averageIncomeIntervalDays : 1)
    : 0;
  const debtToIncomeRatio = monthlyIncomeEstimate > 0 ? totalDebtBalance / monthlyIncomeEstimate : null;

  const avalanche = simulateDebtStrategy({
    debts: input.debts,
    monthlyPaymentBudget: paymentBudget,
    strategy: "avalanche",
    nowIso: input.nowIso,
    coverage: input.coverage,
  });
  const snowball = simulateDebtStrategy({
    debts: input.debts,
    monthlyPaymentBudget: paymentBudget,
    strategy: "snowball",
    nowIso: input.nowIso,
    coverage: input.coverage,
  });

  const estimatedInterestSavedByAvalanche = Math.max(0, snowball.totalInterest - avalanche.totalInterest);
  const recommendedStrategy: MoneyDebtPayoffSimulator["recommendedStrategy"] =
    input.debts.length === 0
      ? "manual"
      : estimatedInterestSavedByAvalanche >= 120
        ? "avalanche"
        : (snowball.monthsToDebtFree !== null && avalanche.monthsToDebtFree !== null && snowball.monthsToDebtFree <= avalanche.monthsToDebtFree + 1)
          ? "snowball"
          : "avalanche";

  const confidence = clamp(
    0.28 + input.coverage.confidence * 0.44 + Math.min(input.debts.length / 4, 1) * 0.28,
    0.2,
    0.98,
  );

  return {
    debts: input.debts,
    monthlyPaymentBudget: paymentBudget,
    totalDebtBalance: round(totalDebtBalance),
    debtToIncomeRatio: debtToIncomeRatio === null ? null : round(debtToIncomeRatio),
    avalanche,
    snowball,
    recommendedStrategy,
    estimatedInterestSavedByAvalanche: round(estimatedInterestSavedByAvalanche),
    confidence: round(confidence),
    explanation: "Debt simulation compares deterministic avalanche and snowball payoff paths. Recommendations are advisory only and never auto-executed.",
    factors: [
      `${input.debts.length} debt balance(s) in simulation.`,
      `Monthly payoff budget: ${paymentBudget}.`,
      `Estimated interest saved with avalanche: ${round(estimatedInterestSavedByAvalanche)}.`,
    ],
  };
}

function buildInvestmentPortfolioAnalysis(input: {
  connectedAccounts: MoneyConnectedAccountInput[];
  walletBalance: number;
  coverage: MoneyCoverage;
}): MoneyInvestmentPortfolioAnalysis {
  const investmentBalances = input.connectedAccounts
    .filter((account) => includesAny(account.type || "", ["investment", "brokerage", "retirement", "401", "ira"]))
    .map((account) => Math.max(0, account.balance ?? 0))
    .filter((value) => value > 0);
  const portfolioValue = investmentBalances.reduce((sum, value) => sum + value, 0);
  const largestHoldingShare = portfolioValue > 0
    ? Math.max(...investmentBalances) / portfolioValue
    : 0;

  const cashLikeBalances = input.connectedAccounts
    .filter((account) => includesAny(account.type || "", ["cash", "checking", "savings"]))
    .map((account) => Math.max(0, account.balance ?? 0))
    .reduce((sum, value) => sum + value, 0) + Math.max(0, input.walletBalance);
  const totalFinancialAssets = cashLikeBalances + portfolioValue;
  const cashConcentration = totalFinancialAssets > 0 ? cashLikeBalances / totalFinancialAssets : 1;

  const diversificationScore = portfolioValue <= 0
    ? 0
    : clamp(
      45
      + Math.min(investmentBalances.length / 4, 1) * 35
      - largestHoldingShare * 28
      - cashConcentration * 15,
      0,
      100,
    );

  const riskLevel: MoneyInvestmentPortfolioAnalysis["riskLevel"] =
    portfolioValue <= 0
      ? "manual"
      : diversificationScore >= 72
        ? "low"
        : diversificationScore >= 48
          ? "moderate"
          : "high";

  const confidence = clamp(
    0.2 + input.coverage.confidence * 0.45 + Math.min(investmentBalances.length / 4, 1) * 0.35,
    0.2,
    0.95,
  );

  return {
    portfolioValue: round(portfolioValue),
    investmentAccountCount: investmentBalances.length,
    largestHoldingSharePct: round(largestHoldingShare * 100),
    diversificationScore: round(diversificationScore),
    cashConcentrationPct: round(cashConcentration * 100),
    riskLevel,
    recommendation: portfolioValue <= 0
      ? "Add investment account balances (or manual holdings) to activate portfolio analysis."
      : diversificationScore < 50
        ? "Risk concentration is elevated. Consider diversifying across more than one investment bucket."
        : "Portfolio diversification looks reasonably balanced for current visibility.",
    confidence: round(confidence),
    explanation: "Portfolio analysis is deterministic and based on observed account-balance concentration, not hidden black-box risk models.",
    factors: [
      `Investment account count: ${investmentBalances.length}.`,
      `Largest holding share: ${round(largestHoldingShare * 100)}%.`,
      `Cash concentration: ${round(cashConcentration * 100)}%.`,
    ],
  };
}

function buildRetirementProjection(input: {
  affordability: MoneyAffordability;
  monthlySurvivalForecast: MoneyMonthlySurvivalForecast;
  spendingLimits: MoneySpendingLimits;
  investmentPortfolioAnalysis: MoneyInvestmentPortfolioAnalysis;
  coverage: MoneyCoverage;
}): MoneyRetirementProjection {
  const yearsProjected = 35;
  const annualReturn = 0.06;
  const currentInvestedAssets = input.investmentPortfolioAnalysis.portfolioValue;
  const monthlyContributionAssumption = Math.max(
    0,
    Math.min(
      input.affordability.safeToSpendThisMonth * 0.2,
      input.spendingLimits.monthlyLimit * 0.25,
    ),
  );
  const annualContribution = monthlyContributionAssumption * 12;

  const growthFactor = (1 + annualReturn) ** yearsProjected;
  const projectedPortfolioValue = currentInvestedAssets * growthFactor
    + annualContribution * ((growthFactor - 1) / annualReturn);
  const annualSpendingNeed = Math.max(
    (input.monthlySurvivalForecast.projectedBills30d + input.monthlySurvivalForecast.projectedVariableSpend30d * 0.7) * 12,
    24000,
  );
  const targetNestEgg = annualSpendingNeed * 25;
  const readinessRatio = targetNestEgg > 0 ? projectedPortfolioValue / targetNestEgg : 0;

  const requiredAnnual = targetNestEgg > currentInvestedAssets * growthFactor
    ? ((targetNestEgg - currentInvestedAssets * growthFactor) * annualReturn) / (growthFactor - 1)
    : 0;
  const recommendedMonthlyContribution = requiredAnnual / 12;

  const status: MoneyRetirementProjection["status"] =
    input.investmentPortfolioAnalysis.riskLevel === "manual" && monthlyContributionAssumption <= 0
      ? "manual"
      : readinessRatio >= 1
        ? "track_on"
        : readinessRatio >= 0.6
          ? "needs_boost"
          : "off_track";

  const confidence = clamp(
    0.2 + input.coverage.confidence * 0.45 + (input.investmentPortfolioAnalysis.riskLevel === "manual" ? 0.1 : 0.25),
    0.2,
    0.95,
  );

  return {
    yearsProjected,
    currentInvestedAssets: round(currentInvestedAssets),
    projectedPortfolioValue: round(projectedPortfolioValue),
    targetNestEgg: round(targetNestEgg),
    readinessRatio: round(readinessRatio),
    monthlyContributionAssumption: round(monthlyContributionAssumption),
    recommendedMonthlyContribution: round(Math.max(0, recommendedMonthlyContribution)),
    status,
    confidence: round(confidence),
    explanation: "Retirement projection uses transparent compound-growth math with conservative contribution assumptions.",
    factors: [
      `Projection horizon: ${yearsProjected} years at ${(annualReturn * 100).toFixed(1)}% annual return assumption.`,
      `Assumed monthly contribution: ${round(monthlyContributionAssumption)}.`,
      `Readiness ratio: ${round(readinessRatio)}.`,
    ],
  };
}

function monthsToGoal(gapAmount: number, monthlyContributionPlan: number): number | null {
  if (gapAmount <= 0) return 0;
  if (monthlyContributionPlan <= 0) return null;
  return Math.ceil(gapAmount / monthlyContributionPlan);
}

function buildLifeGoalPlanning(input: {
  walletBalance: number;
  affordability: MoneyAffordability;
  monthlySurvivalForecast: MoneyMonthlySurvivalForecast;
  debtPayoffSimulator: MoneyDebtPayoffSimulator;
  investmentPortfolioAnalysis: MoneyInvestmentPortfolioAnalysis;
  coverage: MoneyCoverage;
}): MoneyLifeGoalPlanning {
  const monthlyContributionCapacity = Math.max(
    0,
    Math.min(
      input.affordability.safeToSpendThisMonth * 0.4,
      input.monthlySurvivalForecast.projectedEndBalance30d > 0
        ? input.monthlySurvivalForecast.projectedEndBalance30d * 0.55
        : input.affordability.safeToSpendToday * 6,
    ),
  );
  const recommendedContributionNow = Math.max(0, monthlyContributionCapacity * 0.8);

  const emergencyTarget = Math.max(1000, input.monthlySurvivalForecast.projectedBills30d * 1.5);
  const emergencyCurrent = Math.max(0, input.walletBalance);
  const emergencyGap = Math.max(0, emergencyTarget - emergencyCurrent);

  const debtTarget = input.debtPayoffSimulator.totalDebtBalance;
  const debtGap = Math.max(0, debtTarget);

  const starterInvestingTarget = Math.max(1000, input.monthlySurvivalForecast.projectedVariableSpend30d * 0.6);
  const starterInvestingCurrent = Math.max(0, input.investmentPortfolioAnalysis.portfolioValue);
  const starterInvestingGap = Math.max(0, starterInvestingTarget - starterInvestingCurrent);

  const goals: MoneyLifeGoalPlanning["goals"] = [
    {
      id: "emergency_buffer",
      title: "Emergency buffer",
      targetAmount: round(emergencyTarget),
      currentAmount: round(emergencyCurrent),
      gapAmount: round(emergencyGap),
      monthlyContributionPlan: round(recommendedContributionNow),
      monthsToGoal: monthsToGoal(emergencyGap, recommendedContributionNow),
      status: emergencyGap <= 0 ? "on_track" : emergencyGap < emergencyTarget * 0.5 ? "watch" : "off_track",
      confidence: round(clamp(input.coverage.confidence * 0.85, 0.2, 0.98)),
      explanation: "Emergency goal target is tied to projected monthly obligations so runway planning stays grounded in cash-flow reality.",
      factors: [
        `Target set to max(1000, 1.5x projected monthly bills) = ${round(emergencyTarget)}.`,
        `Safe-to-spend this month informs contribution capacity: ${round(input.affordability.safeToSpendThisMonth)}.`,
      ],
    },
    {
      id: "debt_free",
      title: "Debt-free path",
      targetAmount: round(debtTarget),
      currentAmount: 0,
      gapAmount: round(debtGap),
      monthlyContributionPlan: round(Math.max(recommendedContributionNow, input.debtPayoffSimulator.monthlyPaymentBudget)),
      monthsToGoal: input.debtPayoffSimulator.avalanche.monthsToDebtFree,
      status: debtTarget <= 0
        ? "on_track"
        : (input.debtPayoffSimulator.avalanche.monthsToDebtFree ?? 999) <= 48
          ? "watch"
          : "off_track",
      confidence: round(input.debtPayoffSimulator.confidence),
      explanation: "Debt-free planning is linked to deterministic debt payoff simulation and safe monthly cash capacity.",
      factors: [
        `Total tracked debt: ${round(debtTarget)}.`,
        `Recommended payoff strategy: ${input.debtPayoffSimulator.recommendedStrategy}.`,
      ],
    },
    {
      id: "starter_investing",
      title: "Starter investing buffer",
      targetAmount: round(starterInvestingTarget),
      currentAmount: round(starterInvestingCurrent),
      gapAmount: round(starterInvestingGap),
      monthlyContributionPlan: round(recommendedContributionNow * 0.65),
      monthsToGoal: monthsToGoal(starterInvestingGap, recommendedContributionNow * 0.65),
      status: starterInvestingGap <= 0 ? "on_track" : starterInvestingCurrent > 0 ? "watch" : "manual",
      confidence: round(clamp(input.coverage.confidence * 0.8, 0.2, 0.95)),
      explanation: "Starter investing target scales to current spending pace to avoid overcommitting before essentials are covered.",
      factors: [
        `Target set from variable-spend baseline: ${round(starterInvestingTarget)}.`,
        `Current invested assets: ${round(starterInvestingCurrent)}.`,
      ],
    },
  ];

  const confidence = clamp(
    0.22 + input.coverage.confidence * 0.5 + (monthlyContributionCapacity > 0 ? 0.2 : 0.08),
    0.2,
    0.98,
  );

  return {
    monthlyContributionCapacity: round(monthlyContributionCapacity),
    recommendedContributionNow: round(recommendedContributionNow),
    goals,
    confidence: round(confidence),
    explanation: "Life goals are anchored to safe-to-spend windows and projected cash flow before any contribution recommendation is made.",
    factors: [
      `Safe-to-spend today/week/month: ${round(input.affordability.safeToSpendToday)} / ${round(input.affordability.safeToSpendThisWeek)} / ${round(input.affordability.safeToSpendThisMonth)}.`,
      `Projected 30-day end balance: ${round(input.monthlySurvivalForecast.projectedEndBalance30d)}.`,
    ],
  };
}

function simulateScenario(input: {
  assumptions: MoneyScenarioAssumptions;
  baseline: MoneyAdvancedComputationInput;
  debtSimulator: MoneyDebtPayoffSimulator;
}): MoneyScenarioSimulation {
  const assumptions: MoneyScenarioAssumptions = {
    ...input.assumptions,
    spendingChangePct: clamp(input.assumptions.spendingChangePct, -0.8, 1),
    incomeChangePct: clamp(input.assumptions.incomeChangePct, -0.8, 1),
    extraDebtPaydownMonthly: Math.max(0, input.assumptions.extraDebtPaydownMonthly),
    savingsContributionMonthly: Math.max(0, input.assumptions.savingsContributionMonthly),
  };

  const baseIncome = input.baseline.monthlySurvivalForecast.projectedIncome30d;
  const baseBills = input.baseline.monthlySurvivalForecast.projectedBills30d;
  const baseVariable = input.baseline.monthlySurvivalForecast.projectedVariableSpend30d;

  const adjustedIncome = baseIncome * (1 + assumptions.incomeChangePct);
  const adjustedVariable = Math.max(0, baseVariable * (1 + assumptions.spendingChangePct));
  const netBaselineFlow = adjustedIncome - baseBills - adjustedVariable;
  const monthlyDebtExtra = assumptions.extraDebtPaydownMonthly;
  const monthlySavingsExtra = assumptions.savingsContributionMonthly;

  const avgApr = input.debtSimulator.debts.length > 0
    ? mean(input.debtSimulator.debts.map((debt) => debt.aprEstimate))
    : 0.12;
  const debtInterestBenefit90d = monthlyDebtExtra * (avgApr / 12) * 2;

  const projectedEndBalance30d = input.baseline.walletBalance + netBaselineFlow - monthlyDebtExtra - monthlySavingsExtra;
  const projectedEndBalance90d =
    input.baseline.walletBalance
    + (netBaselineFlow - monthlyDebtExtra - monthlySavingsExtra) * 3
    + debtInterestBenefit90d;

  const incomeDelta = adjustedIncome - baseIncome;
  const spendDelta = adjustedVariable - baseVariable;
  const monthlyDelta = incomeDelta - spendDelta - monthlyDebtExtra - monthlySavingsExtra;
  const safeToSpendToday = Math.max(0, input.baseline.affordability.safeToSpendToday + monthlyDelta / 30);
  const safeToSpendThisWeek = Math.max(0, input.baseline.affordability.safeToSpendThisWeek + monthlyDelta * (7 / 30));
  const safeToSpendThisMonth = Math.max(0, input.baseline.affordability.safeToSpendThisMonth + monthlyDelta);

  const stressLevel = scenarioStressLevel({
    projectedEndBalance30d,
    projectedEndBalance90d,
    projectedBills30d: baseBills,
    safeToSpendToday,
  });

  const magnitude = Math.abs(assumptions.spendingChangePct)
    + Math.abs(assumptions.incomeChangePct)
    + (monthlyDebtExtra + monthlySavingsExtra) / Math.max(baseBills + baseVariable, 1);
  const confidence = clamp(
    input.baseline.coverage.confidence * 0.78 + 0.18 - magnitude * 0.08,
    0.2,
    0.97,
  );

  return {
    id: assumptions.id,
    label: assumptions.label,
    assumptions,
    projectedEndBalance30d: round(projectedEndBalance30d),
    projectedEndBalance90d: round(projectedEndBalance90d),
    safeToSpendToday: round(safeToSpendToday),
    safeToSpendThisWeek: round(safeToSpendThisWeek),
    safeToSpendThisMonth: round(safeToSpendThisMonth),
    stressLevel,
    confidence: round(confidence),
    explanation: "Scenario outputs are deterministic what-if math from baseline cash flow, spending, income, debt-paydown, and savings assumptions.",
    factors: [
      `Income change: ${(assumptions.incomeChangePct * 100).toFixed(1)}%. Spending change: ${(assumptions.spendingChangePct * 100).toFixed(1)}%.`,
      `Extra debt paydown: ${round(monthlyDebtExtra)}. Extra savings: ${round(monthlySavingsExtra)}.`,
      `Projected 30d end balance: ${round(projectedEndBalance30d)}.`,
    ],
  };
}

function buildFinancialRiskScoring(input: {
  coverage: MoneyCoverage;
  affordability: MoneyAffordability;
  monthlySurvivalForecast: MoneyMonthlySurvivalForecast;
  creditUtilization: MoneyCreditUtilizationOptimizer;
  debtSimulator: MoneyDebtPayoffSimulator;
  spendingHabits: MoneySpendingHabitAnalysis;
  incomeStability: MoneyIncomeStabilityAnalysis;
}): MoneyFinancialRiskScoring {
  const liquidityCoverage = input.monthlySurvivalForecast.projectedBills30d > 0
    ? input.affordability.safeToSpendThisMonth / input.monthlySurvivalForecast.projectedBills30d
    : 0;
  const liquidityRisk = input.affordability.safeToSpendThisMonth <= 0
    ? 95
    : clamp(78 - liquidityCoverage * 35, 12, 90);

  const debtRisk = input.debtSimulator.totalDebtBalance <= 0
    ? 20
    : clamp(
      ((input.debtSimulator.debtToIncomeRatio ?? 0.8) * 55)
      + (input.creditUtilization.utilizationRatio ?? 0) * 45,
      18,
      95,
    );

  const incomeRisk = input.incomeStability.reliable
    ? clamp(18 + input.incomeStability.incomeAmountVolatilityPct * 0.45 + ((input.incomeStability.intervalVolatilityPct ?? 0) * 0.4), 10, 85)
    : 74;
  const spendingRisk = input.spendingHabits.habitRiskLevel === "risky"
    ? 74
    : input.spendingHabits.habitRiskLevel === "watch"
      ? 52
      : 30;
  const dataRisk = clamp((1 - input.coverage.confidence) * 100, 4, 90);

  const overallRiskScore = clamp(
    liquidityRisk * 0.27
    + debtRisk * 0.26
    + incomeRisk * 0.2
    + spendingRisk * 0.17
    + dataRisk * 0.1,
    0,
    100,
  );

  const riskBand: MoneyFinancialRiskScoring["riskBand"] =
    overallRiskScore < 35
      ? "low"
      : overallRiskScore < 55
        ? "moderate"
        : overallRiskScore < 75
          ? "high"
          : "severe";

  const confidence = clamp(
    0.24 + input.coverage.confidence * 0.48 + (input.incomeStability.reliable ? 0.14 : 0.06),
    0.2,
    0.98,
  );

  return {
    overallRiskScore: round(overallRiskScore),
    riskBand,
    componentScores: {
      liquidityRisk: round(liquidityRisk),
      debtRisk: round(debtRisk),
      incomeRisk: round(incomeRisk),
      spendingRisk: round(spendingRisk),
      dataRisk: round(dataRisk),
    },
    confidence: round(confidence),
    explanation: "Risk score uses transparent weighted components: liquidity, debt load, income stability, spending habits, and data quality.",
    factors: [
      `Liquidity risk ${round(liquidityRisk)}, debt risk ${round(debtRisk)}, income risk ${round(incomeRisk)}.`,
      `Coverage confidence contributes via data-risk component (${round(dataRisk)}).`,
    ],
  };
}

function buildFinancialStressDetection(input: {
  coverage: MoneyCoverage;
  affordability: MoneyAffordability;
  monthlySurvivalForecast: MoneyMonthlySurvivalForecast;
  riskScoring: MoneyFinancialRiskScoring;
  incomeStability: MoneyIncomeStabilityAnalysis;
  creditUtilization: MoneyCreditUtilizationOptimizer;
}): MoneyFinancialStressDetection {
  const triggers: MoneyFinancialStressDetection["triggers"] = [];
  let stressScore = 0;

  if (input.monthlySurvivalForecast.status === "risk") {
    stressScore += 30;
    triggers.push({
      rule: "30_day_survival_risk",
      points: 30,
      evidence: `30-day projected end balance is ${input.monthlySurvivalForecast.projectedEndBalance30d}.`,
    });
  } else if (input.monthlySurvivalForecast.status === "watch") {
    stressScore += 16;
    triggers.push({
      rule: "30_day_survival_watch",
      points: 16,
      evidence: "30-day survival forecast is in watch status.",
    });
  }

  if (input.affordability.safeToSpendToday < 20) {
    stressScore += 18;
    triggers.push({
      rule: "low_safe_to_spend_today",
      points: 18,
      evidence: `Safe-to-spend today is ${input.affordability.safeToSpendToday}.`,
    });
  }

  if (input.affordability.safeToSpendThisWeek < Math.max(120, input.monthlySurvivalForecast.projectedBills30d * 0.2)) {
    stressScore += 14;
    triggers.push({
      rule: "low_safe_to_spend_week",
      points: 14,
      evidence: `Safe-to-spend this week is ${input.affordability.safeToSpendThisWeek}.`,
    });
  }

  if (!input.incomeStability.reliable) {
    stressScore += 12;
    triggers.push({
      rule: "income_unstable",
      points: 12,
      evidence: "Income cadence is not reliable yet.",
    });
  }

  if (input.creditUtilization.status === "high") {
    stressScore += 12;
    triggers.push({
      rule: "high_credit_utilization",
      points: 12,
      evidence: `Estimated utilization is ${(input.creditUtilization.utilizationRatio || 0) * 100}%.`,
    });
  }

  if (input.riskScoring.overallRiskScore >= 70) {
    stressScore += 14;
    triggers.push({
      rule: "high_overall_risk",
      points: 14,
      evidence: `Overall risk score is ${input.riskScoring.overallRiskScore}.`,
    });
  }

  if (input.coverage.lowData) {
    stressScore += 8;
    triggers.push({
      rule: "low_data_uncertainty",
      points: 8,
      evidence: "Partial coverage lowers certainty and increases precaution.",
    });
  }

  stressScore = clamp(stressScore, 0, 100);
  const status: MoneyFinancialStressDetection["status"] =
    stressScore < 25
      ? "low"
      : stressScore < 50
        ? "watch"
        : stressScore < 75
          ? "high"
          : "critical";

  const confidence = clamp(
    0.26 + input.coverage.confidence * 0.48 + Math.min(triggers.length / 6, 1) * 0.2,
    0.2,
    0.97,
  );

  return {
    stressScore: round(stressScore),
    status,
    triggers,
    confidence: round(confidence),
    explanation: "Stress detection uses transparent additive rules with visible evidence instead of hidden black-box scoring.",
    factors: triggers.length > 0
      ? triggers.slice(0, 4).map((trigger) => `${trigger.rule}: +${trigger.points}.`)
      : ["No high-stress rules were triggered."],
  };
}

export function simulateCustomFinancialScenario(input: {
  baseline: MoneyAdvancedComputationInput;
  debtSimulator: MoneyDebtPayoffSimulator;
  assumptions: MoneyScenarioAssumptions;
}): MoneyScenarioSimulation {
  return simulateScenario({
    assumptions: input.assumptions,
    baseline: input.baseline,
    debtSimulator: input.debtSimulator,
  });
}

export function buildAdvancedIntelligence(input: MoneyAdvancedComputationInput): MoneyAdvancedIntelligence {
  const incomeStability = buildIncomeStabilityAnalysis(input);
  const spendingHabits = buildSpendingHabitAnalysis(input);
  const creditUtilization = buildCreditUtilizationOptimizer({
    connectedAccounts: input.connectedAccounts,
    affordability: input.affordability,
    coverage: input.coverage,
  });
  const debts = buildDebtSnapshots({
    connectedAccounts: input.connectedAccounts,
    billPredictions: input.billPredictions,
  });
  const debtPayoff = buildDebtPayoffSimulator({
    nowIso: input.nowIso,
    debts,
    affordability: input.affordability,
    spendingLimits: input.spendingLimits,
    incomeStability,
    coverage: input.coverage,
  });
  const investmentAnalysis = buildInvestmentPortfolioAnalysis({
    connectedAccounts: input.connectedAccounts,
    walletBalance: input.walletBalance,
    coverage: input.coverage,
  });
  const retirementProjection = buildRetirementProjection({
    affordability: input.affordability,
    monthlySurvivalForecast: input.monthlySurvivalForecast,
    spendingLimits: input.spendingLimits,
    investmentPortfolioAnalysis: investmentAnalysis,
    coverage: input.coverage,
  });
  const lifeGoals = buildLifeGoalPlanning({
    walletBalance: input.walletBalance,
    affordability: input.affordability,
    monthlySurvivalForecast: input.monthlySurvivalForecast,
    debtPayoffSimulator: debtPayoff,
    investmentPortfolioAnalysis: investmentAnalysis,
    coverage: input.coverage,
  });

  const baselineScenario = simulateScenario({
    assumptions: {
      id: "baseline",
      label: "Baseline",
      spendingChangePct: 0,
      incomeChangePct: 0,
      extraDebtPaydownMonthly: 0,
      savingsContributionMonthly: 0,
    },
    baseline: input,
    debtSimulator: debtPayoff,
  });
  const whatIfScenarios: MoneyScenarioSimulation[] = [
    simulateScenario({
      assumptions: {
        id: "spend_trim_10",
        label: "Cut spending by 10%",
        spendingChangePct: -0.1,
        incomeChangePct: 0,
        extraDebtPaydownMonthly: 0,
        savingsContributionMonthly: 0,
      },
      baseline: input,
      debtSimulator: debtPayoff,
    }),
    simulateScenario({
      assumptions: {
        id: "income_plus_10",
        label: "Increase income by 10%",
        spendingChangePct: 0,
        incomeChangePct: 0.1,
        extraDebtPaydownMonthly: 0,
        savingsContributionMonthly: 0,
      },
      baseline: input,
      debtSimulator: debtPayoff,
    }),
    simulateScenario({
      assumptions: {
        id: "debt_sprint",
        label: "Debt sprint",
        spendingChangePct: 0,
        incomeChangePct: 0,
        extraDebtPaydownMonthly: Math.max(40, debtPayoff.monthlyPaymentBudget * 0.25),
        savingsContributionMonthly: 0,
      },
      baseline: input,
      debtSimulator: debtPayoff,
    }),
    simulateScenario({
      assumptions: {
        id: "savings_habit",
        label: "Start auto-savings",
        spendingChangePct: 0,
        incomeChangePct: 0,
        extraDebtPaydownMonthly: 0,
        savingsContributionMonthly: Math.max(25, lifeGoals.recommendedContributionNow * 0.6),
      },
      baseline: input,
      debtSimulator: debtPayoff,
    }),
  ];

  const riskScoring = buildFinancialRiskScoring({
    coverage: input.coverage,
    affordability: input.affordability,
    monthlySurvivalForecast: input.monthlySurvivalForecast,
    creditUtilization,
    debtSimulator: debtPayoff,
    spendingHabits,
    incomeStability,
  });
  const stressDetection = buildFinancialStressDetection({
    coverage: input.coverage,
    affordability: input.affordability,
    monthlySurvivalForecast: input.monthlySurvivalForecast,
    riskScoring,
    incomeStability,
    creditUtilization,
  });

  const confidence = clamp(
    0.24 + input.coverage.confidence * 0.42 + mean([
      lifeGoals.confidence,
      retirementProjection.confidence,
      debtPayoff.confidence,
      riskScoring.confidence,
      stressDetection.confidence,
    ]) * 0.34,
    0.2,
    0.98,
  );

  return {
    lifeGoalPlanning: lifeGoals,
    retirementProjection,
    scenarioSimulation: {
      baseline: baselineScenario,
      whatIfScenarios,
    },
    investmentPortfolioAnalysis: investmentAnalysis,
    creditUtilizationOptimizer: creditUtilization,
    debtPayoffSimulator: debtPayoff,
    financialRiskScoring: riskScoring,
    spendingHabitAnalysis: spendingHabits,
    incomeStabilityAnalysis: incomeStability,
    financialStressDetection: stressDetection,
    confidence: round(confidence),
    explanation: "Advanced intelligence is deterministic first, confidence-scored, and safety-aware under partial coverage.",
    factors: [
      `Coverage confidence: ${input.coverage.confidence}.`,
      `Scenario count: ${1 + whatIfScenarios.length} (baseline + what-if).`,
      `Stress status: ${stressDetection.status}. Risk band: ${riskScoring.riskBand}.`,
    ],
  };
}
