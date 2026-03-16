import test from "node:test";
import assert from "node:assert/strict";
import { computeMoneyIntelligence } from "../lib/server/moneyIntelligence/core.ts";
import { simulateCustomFinancialScenario } from "../lib/server/moneyIntelligence/advanced.ts";
import type { MoneyTransactionInput } from "../lib/server/moneyIntelligence/types.ts";

const NOW_ISO = "2026-03-15T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function tx(input: {
  id: string;
  daysAgo: number;
  amount: number;
  category: string;
  merchant: string;
  linkedAccountId?: string;
}): MoneyTransactionInput {
  return {
    id: input.id,
    merchantName: input.merchant,
    normalizedMerchant: input.merchant.toLowerCase(),
    amount: input.amount,
    category: input.category,
    pending: false,
    occurredAt: new Date(Date.parse(NOW_ISO) - input.daysAgo * DAY_MS).toISOString(),
    linkedAccountId: input.linkedAccountId,
  };
}

function buildFixture() {
  const transactions: MoneyTransactionInput[] = [
    tx({ id: "income_1", merchant: "Payroll", amount: -1400, category: "payroll", daysAgo: 70, linkedAccountId: "checking_a" }),
    tx({ id: "income_2", merchant: "Payroll", amount: -1450, category: "payroll", daysAgo: 56, linkedAccountId: "checking_a" }),
    tx({ id: "income_3", merchant: "Payroll", amount: -1420, category: "payroll", daysAgo: 42, linkedAccountId: "checking_a" }),
    tx({ id: "income_4", merchant: "Payroll", amount: -1475, category: "payroll", daysAgo: 28, linkedAccountId: "checking_a" }),
    tx({ id: "income_5", merchant: "Payroll", amount: -1440, category: "payroll", daysAgo: 14, linkedAccountId: "checking_a" }),
    tx({ id: "rent_1", merchant: "Campus Housing", amount: 850, category: "housing", daysAgo: 44, linkedAccountId: "checking_a" }),
    tx({ id: "rent_2", merchant: "Campus Housing", amount: 850, category: "housing", daysAgo: 14, linkedAccountId: "checking_a" }),
    tx({ id: "groceries_1", merchant: "Grocer", amount: 115, category: "groceries", daysAgo: 12, linkedAccountId: "checking_a" }),
    tx({ id: "groceries_2", merchant: "Grocer", amount: 108, category: "groceries", daysAgo: 5, linkedAccountId: "checking_a" }),
    tx({ id: "dining_1", merchant: "Late Night Club", amount: 96, category: "entertainment", daysAgo: 10, linkedAccountId: "credit_a" }),
    tx({ id: "card_payment_1", merchant: "Card Payment Thank You", amount: 420, category: "credit card payment", daysAgo: 8, linkedAccountId: "checking_a" }),
    tx({ id: "loan_payment_1", merchant: "Student Loan Servicer", amount: 180, category: "loan payment", daysAgo: 7, linkedAccountId: "checking_a" }),
  ];

  const recurring = [
    {
      id: "rec_rent",
      merchant: "Campus Housing",
      estimatedMonthlyCost: 850,
      recurrenceInterval: "monthly",
      confidence: 0.92,
      lastSeen: "2026-03-01T00:00:00.000Z",
      lifecycleStatus: "confirmed" as const,
    },
    {
      id: "rec_loan",
      merchant: "Student Loan Servicer",
      estimatedMonthlyCost: 180,
      recurrenceInterval: "monthly",
      confidence: 0.88,
      lastSeen: "2026-03-02T00:00:00.000Z",
      lifecycleStatus: "confirmed" as const,
    },
  ];

  const connectedAccounts = [
    { id: "checking_a", lastSyncedAt: NOW_ISO, type: "checking", balance: 2300 },
    { id: "credit_a", lastSyncedAt: NOW_ISO, type: "credit", balance: -1800 },
    { id: "loan_a", lastSyncedAt: NOW_ISO, type: "loan", balance: -6400 },
    { id: "invest_a", lastSyncedAt: NOW_ISO, type: "investment", balance: 1200 },
  ];

  return {
    walletBalance: 2100,
    currency: "USD",
    transactions,
    recurring,
    connectedAccounts,
    categoryRules: [],
    nowIso: NOW_ISO,
  };
}

test("advanced intelligence projections include explainable retirement, goals, debt simulation, risk, and stress", () => {
  const result = computeMoneyIntelligence(buildFixture());
  const advanced = result.advancedIntelligence;

  assert.ok(advanced.confidence > 0 && advanced.confidence <= 1);
  assert.ok(advanced.factors.length > 0);

  assert.ok(advanced.retirementProjection.projectedPortfolioValue > advanced.retirementProjection.currentInvestedAssets);
  assert.ok(advanced.retirementProjection.targetNestEgg > 0);
  assert.ok(advanced.lifeGoalPlanning.goals.length >= 3);
  assert.ok(advanced.lifeGoalPlanning.recommendedContributionNow >= 0);

  assert.ok(advanced.debtPayoffSimulator.totalDebtBalance > 0);
  assert.ok(advanced.debtPayoffSimulator.avalanche.confidence > 0);
  assert.ok(advanced.debtPayoffSimulator.snowball.confidence > 0);
  assert.ok(advanced.debtPayoffSimulator.estimatedInterestSavedByAvalanche >= 0);

  assert.ok(advanced.financialRiskScoring.overallRiskScore >= 0 && advanced.financialRiskScoring.overallRiskScore <= 100);
  assert.ok(advanced.financialStressDetection.stressScore >= 0 && advanced.financialStressDetection.stressScore <= 100);
  assert.ok(advanced.financialStressDetection.triggers.length >= 1);
  assert.ok(advanced.financialStressDetection.explanation.includes("transparent"));
});

test("what-if scenario simulation responds deterministically to spending/income/debt/savings changes", () => {
  const fixture = buildFixture();
  const result = computeMoneyIntelligence(fixture);
  const advanced = result.advancedIntelligence;
  const baselineInput = {
    nowIso: NOW_ISO,
    currency: fixture.currency,
    walletBalance: fixture.walletBalance,
    coverage: result.coverage,
    statement: result.statement,
    affordability: result.affordability,
    weeklyPrediction: result.weeklyPrediction,
    monthlySurvivalForecast: result.monthlySurvivalForecast,
    spendingLimits: result.spendingLimits,
    connectedAccounts: fixture.connectedAccounts,
    billPredictions: result.billPredictions,
  };

  const baseline = advanced.scenarioSimulation.baseline;

  const spendUp = simulateCustomFinancialScenario({
    baseline: baselineInput,
    debtSimulator: advanced.debtPayoffSimulator,
    assumptions: {
      id: "spend_up",
      label: "Spend up",
      spendingChangePct: 0.2,
      incomeChangePct: 0,
      extraDebtPaydownMonthly: 0,
      savingsContributionMonthly: 0,
    },
  });
  const incomeUp = simulateCustomFinancialScenario({
    baseline: baselineInput,
    debtSimulator: advanced.debtPayoffSimulator,
    assumptions: {
      id: "income_up",
      label: "Income up",
      spendingChangePct: 0,
      incomeChangePct: 0.2,
      extraDebtPaydownMonthly: 0,
      savingsContributionMonthly: 0,
    },
  });
  const debtAndSavings = simulateCustomFinancialScenario({
    baseline: baselineInput,
    debtSimulator: advanced.debtPayoffSimulator,
    assumptions: {
      id: "debt_savings",
      label: "Debt and savings",
      spendingChangePct: 0,
      incomeChangePct: 0,
      extraDebtPaydownMonthly: 120,
      savingsContributionMonthly: 90,
    },
  });

  assert.ok(spendUp.projectedEndBalance30d <= baseline.projectedEndBalance30d);
  assert.ok(incomeUp.projectedEndBalance30d >= baseline.projectedEndBalance30d);
  assert.ok(debtAndSavings.safeToSpendThisMonth <= baseline.safeToSpendThisMonth);
  assert.ok(debtAndSavings.factors.length > 0);
  assert.ok(debtAndSavings.confidence > 0 && debtAndSavings.confidence <= 1);
});

