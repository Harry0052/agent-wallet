import test from "node:test";
import assert from "node:assert/strict";
import { computeMoneyIntelligence } from "../lib/server/moneyIntelligence/core.ts";
import type { MoneyTransactionInput } from "../lib/server/moneyIntelligence/types.ts";

const NOW_ISO = "2026-03-15T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function tx(input: {
  id: string;
  daysAgo: number;
  amount: number;
  category: string;
  merchant: string;
  pending?: boolean;
}): MoneyTransactionInput {
  return {
    id: input.id,
    merchantName: input.merchant,
    normalizedMerchant: input.merchant.toLowerCase(),
    amount: input.amount,
    category: input.category,
    pending: input.pending ?? false,
    occurredAt: new Date(Date.parse(NOW_ISO) - input.daysAgo * DAY_MS).toISOString(),
  };
}

test("statement aggregation excludes transfers/refunds/reversals/card-payments/duplicates", () => {
  const result = computeMoneyIntelligence({
    walletBalance: 2200,
    currency: "USD",
    transactions: [
      tx({ id: "income", merchant: "Payroll", amount: -1000, category: "payroll", daysAgo: 2 }),
      tx({ id: "spend_keep", merchant: "Grocer", amount: 80, category: "groceries", daysAgo: 1 }),
      tx({ id: "transfer", merchant: "Bank Transfer", amount: 200, category: "transfer", daysAgo: 1 }),
      tx({ id: "cc_payment", merchant: "Card Payment Thank You", amount: 90, category: "credit card payment", daysAgo: 1 }),
      tx({ id: "dupe_a", merchant: "Coffee Shop", amount: 30, category: "dining", daysAgo: 3 }),
      tx({ id: "dupe_b", merchant: "Coffee Shop", amount: 30, category: "dining", daysAgo: 3 }),
      tx({ id: "charge_then_refund", merchant: "Online Store", amount: 120, category: "shopping", daysAgo: 9 }),
      tx({ id: "refund_match", merchant: "Online Store", amount: -120, category: "refund", daysAgo: 5 }),
    ],
    recurring: [],
    connectedAccounts: [
      { id: "acc_1", lastSyncedAt: NOW_ISO },
    ],
    categoryRules: [],
    nowIso: NOW_ISO,
  });

  assert.equal(result.statement.trueSpendAmount, 110);
  assert.equal(result.statement.transferTransactions, 1);
  assert.equal(result.statement.creditCardPaymentTransactions, 1);
  assert.equal(result.statement.duplicateTransactions, 1);
  assert.equal(result.statement.refundTransactions, 2);
  assert.equal(result.statement.netCashFlow, 890);
  assert.match(result.statement.explanation, /exclude/i);
});

test("weekly prediction math is stable and affordability guards nullable until-income value", () => {
  const transactions: MoneyTransactionInput[] = [];
  for (let i = 0; i < 56; i += 1) {
    const amount = 18 + (i % 5);
    transactions.push(
      tx({
        id: `spend_${i}`,
        merchant: "Grocer",
        amount,
        category: "groceries",
        daysAgo: i,
      }),
    );
  }
  transactions.push(tx({
    id: "single_income_unreliable",
    merchant: "Payroll",
    amount: -1500,
    category: "payroll",
    daysAgo: 14,
  }));

  const result = computeMoneyIntelligence({
    walletBalance: 900,
    currency: "USD",
    transactions,
    recurring: [],
    connectedAccounts: [{ id: "acc_1", lastSyncedAt: NOW_ISO }],
    categoryRules: [],
    nowIso: NOW_ISO,
  });

  assert.ok(result.weeklyPrediction.predictedDailyBurn >= 18 && result.weeklyPrediction.predictedDailyBurn <= 22);
  assert.ok(result.weeklyPrediction.predictedSpendNext7d >= 126 && result.weeklyPrediction.predictedSpendNext7d <= 154);
  assert.equal(result.affordability.incomeCadenceReliable, false);
  assert.equal(result.affordability.safeToSpendUntilNextIncome, null);
  assert.ok(result.affordability.safeToSpendToday >= 0);
  assert.ok(result.affordability.safeToSpendThisWeek >= 0);
  assert.ok(result.affordability.safeToSpendThisMonth >= 0);
});

test("bill prediction, subscription timeline, alerts, and explainability/confidence are populated", () => {
  const result = computeMoneyIntelligence({
    walletBalance: 250,
    currency: "USD",
    transactions: [
      tx({ id: "spend_today_1", merchant: "Delivery", amount: 90, category: "food", daysAgo: 0 }),
      tx({ id: "spend_today_2", merchant: "Delivery", amount: 80, category: "food", daysAgo: 0 }),
      tx({ id: "spend_week", merchant: "Ride", amount: 70, category: "transport", daysAgo: 2 }),
      tx({ id: "income_a", merchant: "Payroll", amount: -500, category: "payroll", daysAgo: 40 }),
      tx({ id: "income_b", merchant: "Payroll", amount: -500, category: "payroll", daysAgo: 26 }),
      tx({ id: "income_c", merchant: "Payroll", amount: -500, category: "payroll", daysAgo: 12 }),
    ],
    recurring: [
      {
        id: "sub_1",
        merchant: "Video Stream",
        estimatedMonthlyCost: 60,
        recurrenceInterval: "monthly",
        confidence: 0.92,
        lastSeen: "2026-02-20T12:00:00.000Z",
        lifecycleStatus: "confirmed",
      },
      {
        id: "sub_2",
        merchant: "Phone",
        estimatedMonthlyCost: 85,
        recurrenceInterval: "monthly",
        confidence: 0.89,
        lastSeen: "2026-02-10T12:00:00.000Z",
        lifecycleStatus: "confirmed",
      },
    ],
    connectedAccounts: [{ id: "acc_1", lastSyncedAt: NOW_ISO }],
    categoryRules: [],
    nowIso: NOW_ISO,
  });

  assert.ok(result.billPredictions.length >= 2);
  assert.ok(result.subscriptionTimeline.length >= 2);
  assert.ok(result.alerts.length >= 1);
  assert.ok(result.alerts.some((alert) => alert.kind === "daily_limit" || alert.kind === "weekly_limit" || alert.kind === "bill_spike" || alert.kind === "survival_risk"));

  assert.ok(result.weeklyPrediction.confidence > 0 && result.weeklyPrediction.confidence <= 1);
  assert.ok(result.monthlySurvivalForecast.confidence > 0 && result.monthlySurvivalForecast.confidence <= 1);
  assert.ok(result.affordability.explanation.length > 0);
  assert.ok(result.monthlySurvivalForecast.factors.length > 0);
});

test("student refund runway detects refund-like lump-sum deposits and builds semester plan", () => {
  const result = computeMoneyIntelligence({
    walletBalance: 1800,
    currency: "USD",
    transactions: [
      tx({ id: "aid_refund", merchant: "University Financial Aid Refund", amount: -4800, category: "financial aid", daysAgo: 8 }),
      tx({ id: "groceries_1", merchant: "Campus Grocer", amount: 85, category: "groceries", daysAgo: 7 }),
      tx({ id: "dorm_bill", merchant: "Campus Housing", amount: 650, category: "housing", daysAgo: 4 }),
      tx({ id: "meal_1", merchant: "Dining Hall", amount: 32, category: "meal", daysAgo: 2 }),
    ],
    recurring: [],
    connectedAccounts: [{ id: "acc_1", lastSyncedAt: NOW_ISO }],
    categoryRules: [],
    nowIso: NOW_ISO,
  });

  assert.equal(result.studentFocus.refundBudgeting.latestRefundLikeDepositAmount, 4800);
  assert.ok((result.studentFocus.refundBudgeting.weeklyRunwayBudget ?? 0) > 0);
  assert.ok((result.studentFocus.refundBudgeting.estimatedRunwayDays ?? 0) > 0);
  assert.ok(result.studentFocus.cards.some((card) => card.id === "refund_survival"));
  assert.ok(result.studentFocus.insights.some((insight) => insight.kind === "refund_runway"));
});

test("student P2P tracking dedupes mirrored Venmo/CashApp transfer pairs", () => {
  const result = computeMoneyIntelligence({
    walletBalance: 700,
    currency: "USD",
    transactions: [
      tx({ id: "venmo_mirror_out", merchant: "Venmo Transfer", amount: 120, category: "transfer", daysAgo: 2 }),
      tx({ id: "venmo_mirror_in", merchant: "Venmo Transfer", amount: -120, category: "transfer", daysAgo: 2 }),
      tx({ id: "cashapp_out", merchant: "Cash App", amount: 55, category: "transfer", daysAgo: 1 }),
      tx({ id: "cashapp_in", merchant: "Cash App", amount: -25, category: "transfer", daysAgo: 1 }),
      tx({ id: "food", merchant: "Food Truck", amount: 18, category: "food", daysAgo: 0 }),
    ],
    recurring: [],
    connectedAccounts: [{ id: "acc_1", lastSyncedAt: NOW_ISO }],
    categoryRules: [],
    nowIso: NOW_ISO,
  });

  assert.equal(result.studentFocus.p2pTracking.dedupedMirroredPairs30d, 1);
  assert.equal(result.studentFocus.p2pTracking.sent30d, 55);
  assert.equal(result.studentFocus.p2pTracking.received30d, 25);
  assert.equal(result.studentFocus.p2pTracking.netOutflow30d, 30);
});

test("student nightlife calculator remains conservative for paycheck-to-paycheck safety", () => {
  const result = computeMoneyIntelligence({
    walletBalance: 130,
    currency: "USD",
    transactions: [
      tx({ id: "night_1", merchant: "Campus Bar", amount: 88, category: "nightlife", daysAgo: 3 }),
      tx({ id: "night_2", merchant: "Late Night Club", amount: 92, category: "entertainment", daysAgo: 10 }),
      tx({ id: "night_3", merchant: "Ride Share", amount: 40, category: "uber", daysAgo: 11 }),
      tx({ id: "groceries", merchant: "Grocer", amount: 45, category: "groceries", daysAgo: 1 }),
      tx({ id: "income_once", merchant: "Part Time Payroll", amount: -220, category: "payroll", daysAgo: 13 }),
    ],
    recurring: [],
    connectedAccounts: [{ id: "acc_1", lastSyncedAt: NOW_ISO }],
    categoryRules: [],
    nowIso: NOW_ISO,
  });

  assert.ok(result.studentFocus.nightlife.suggestedTonightLimit >= 0);
  assert.equal(result.studentFocus.nightlife.canAffordTypicalNight, false);
  assert.ok(result.studentFocus.cards.some((card) => card.id === "can_i_afford_tonight"));
});
