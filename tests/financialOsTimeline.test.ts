import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCrossAccountMoneyFlowAnalysis,
  composeFinancialTimeline,
  detectInternalTransferPairs,
  type FinancialOsTransactionSignal,
} from "../lib/server/financialOs/intelligence.ts";

const NOW_ISO = "2026-03-15T12:00:00.000Z";

function tx(input: {
  id: string;
  accountId: string;
  amount: number;
  merchant: string;
  category: string;
  occurredAt: string;
  pending?: boolean;
}): FinancialOsTransactionSignal {
  return {
    id: input.id,
    linkedAccountId: input.accountId,
    merchantName: input.merchant,
    normalizedMerchant: input.merchant.toLowerCase(),
    amount: input.amount,
    category: input.category,
    pending: input.pending ?? false,
    occurredAt: input.occurredAt,
  };
}

test("dedup/internal transfer detection separates mirrored cross-account movements from true spend/income", () => {
  const transactions: FinancialOsTransactionSignal[] = [
    tx({
      id: "t1",
      accountId: "checking",
      amount: 300,
      merchant: "Internal Transfer",
      category: "transfer",
      occurredAt: "2026-03-12T14:00:00.000Z",
    }),
    tx({
      id: "t2",
      accountId: "savings",
      amount: -300,
      merchant: "Internal Transfer",
      category: "transfer",
      occurredAt: "2026-03-12T14:05:00.000Z",
    }),
    tx({
      id: "t3",
      accountId: "checking",
      amount: 60,
      merchant: "Grocer",
      category: "groceries",
      occurredAt: "2026-03-13T15:00:00.000Z",
    }),
    tx({
      id: "t4",
      accountId: "checking",
      amount: -900,
      merchant: "Payroll",
      category: "income",
      occurredAt: "2026-03-14T08:00:00.000Z",
    }),
  ];

  const transferPairs = detectInternalTransferPairs({
    transactions,
    nowIso: NOW_ISO,
  });
  assert.equal(transferPairs.length, 1);
  assert.equal(transferPairs[0].amount, 300);
  assert.equal(transferPairs[0].fromAccountId, "checking");
  assert.equal(transferPairs[0].toAccountId, "savings");

  const flow = buildCrossAccountMoneyFlowAnalysis({
    transactions,
    transferPairs,
  });
  assert.equal(flow.internalTransferAmount, 300);
  assert.equal(flow.trueSpendAmount, 60);
  assert.equal(flow.trueIncomeAmount, 900);
  assert.equal(flow.netCashFlow, 840);
});

test("financial timeline composes paydays, bills, subscriptions, tasks, anomalies, transfers, and goals", () => {
  const transactions: FinancialOsTransactionSignal[] = [
    tx({
      id: "income1",
      accountId: "checking",
      amount: -850,
      merchant: "Payroll",
      category: "income",
      occurredAt: "2026-03-14T08:00:00.000Z",
    }),
  ];
  const transferPairs = detectInternalTransferPairs({ transactions, nowIso: NOW_ISO });

  const timeline = composeFinancialTimeline({
    nowIso: NOW_ISO,
    currency: "USD",
    transactions,
    transferPairs,
    bills: [
      {
        id: "bill_1",
        merchant: "Phone Co",
        amount: 78,
        dueDate: "2026-03-18T00:00:00.000Z",
        intervalDays: 30,
        source: "subscription",
        confidence: 0.9,
        explanation: "recurrence",
        factors: ["monthly cadence"],
      },
    ],
    subscriptions: [
      {
        id: "sub_1",
        merchant: "Music App",
        monthlyCost: 12,
        lastSeen: "2026-03-01T00:00:00.000Z",
        nextExpectedChargeDate: "2026-03-20T00:00:00.000Z",
        lifecycleStatus: "confirmed",
        confidence: 0.88,
        explanation: "timeline",
        factors: ["recurring"],
      },
    ],
    taskActions: [
      {
        id: "task_1",
        userId: "u1",
        taskId: "t1",
        actionType: "bill_pay",
        policy: "user_confirm_required",
        status: "pending_confirm",
        title: "Pay electricity bill",
        summary: "Confirm before attempting payment.",
        dedupKey: "d1",
        confidence: 0.8,
        coverageConfidence: 0.8,
        explainability: {
          summary: "deterministic",
          factors: ["bill due"],
          confidence: 0.8,
          coverageConfidence: 0.8,
        },
        payload: {},
        amount: 120,
        currency: "USD",
        requiresExplicitConfirmation: true,
        cooldownUntil: null,
        snoozedUntil: null,
        lastError: null,
        attemptedAt: null,
        completedAt: null,
        dismissedAt: null,
        detectedAt: "2026-03-15T07:00:00.000Z",
        createdAt: "2026-03-15T07:00:00.000Z",
        updatedAt: "2026-03-15T07:05:00.000Z",
      },
    ],
    taskSummary: {
      generatedAt: NOW_ISO,
      policyMode: "user_confirm_required",
      pendingConfirmCount: 1,
      suggestedCount: 0,
      activeCount: 1,
      completed7dCount: 0,
      failed7dCount: 0,
      dismissed7dCount: 0,
      topActions: [],
    },
    anomalyInsights: [
      {
        id: "anomaly_1",
        title: "Unusual charge at Store",
        summary: "Large unusual charge.",
        amountImpact: 230,
        generatedAt: "2026-03-15T09:00:00.000Z",
      },
    ],
    monthlyBudget: 900,
  });

  const kinds = new Set(timeline.map((event) => event.kind));
  assert.ok(kinds.has("payday"));
  assert.ok(kinds.has("bill"));
  assert.ok(kinds.has("subscription"));
  assert.ok(kinds.has("task"));
  assert.ok(kinds.has("anomaly"));
  assert.ok(kinds.has("goal"));
  assert.ok(timeline.length >= 6);
});
