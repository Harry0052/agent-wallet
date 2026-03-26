import 'server-only';

import type {
  FinancialTimelineEvent,
  FinancialTimelineEventPriority,
  FinancialTransferPair,
  CrossAccountMoneyFlowAnalysis,
} from "@/lib/server/financialOs/types";
import type { MoneyBillPrediction, MoneySubscriptionTimelineItem } from "@/lib/server/moneyIntelligence/types";
import type { AutomationActionRecord, AutomationActionSummary } from "@/lib/types";

export interface FinancialOsTransactionSignal {
  id: string;
  linkedAccountId: string;
  merchantName: string;
  normalizedMerchant: string;
  amount: number;
  category: string;
  pending: boolean;
  occurredAt: string;
}

export interface FinancialTimelineInput {
  nowIso: string;
  currency: string;
  transactions: FinancialOsTransactionSignal[];
  transferPairs: FinancialTransferPair[];
  bills: MoneyBillPrediction[];
  subscriptions: MoneySubscriptionTimelineItem[];
  taskActions: AutomationActionRecord[];
  taskSummary: AutomationActionSummary;
  anomalyInsights: Array<{
    id: string;
    title: string;
    summary: string;
    amountImpact?: number | null;
    generatedAt: string;
  }>;
  monthlyBudget: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeDate(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  return Date.now();
}

function priorityForTaskStatus(status: string): FinancialTimelineEventPriority {
  if (status === "pending_confirm") return "high";
  if (status === "failed") return "high";
  if (status === "attempted") return "medium";
  return "low";
}

export function detectInternalTransferPairs(input: {
  transactions: FinancialOsTransactionSignal[];
  nowIso: string;
  maxPairWindowDays?: number;
}): FinancialTransferPair[] {
  const maxPairWindowMs = (input.maxPairWindowDays ?? 2) * MS_PER_DAY;
  const settled = input.transactions
    .filter((tx) => !tx.pending && Number.isFinite(tx.amount) && tx.amount !== 0)
    .sort((a, b) => safeDate(a.occurredAt) - safeDate(b.occurredAt));
  const used = new Set<string>();
  const pairs: FinancialTransferPair[] = [];

  for (const tx of settled) {
    if (used.has(tx.id)) continue;

    const absAmount = Math.abs(tx.amount);
    if (absAmount < 1) continue;

    let matched: FinancialOsTransactionSignal | null = null;
    for (const candidate of settled) {
      if (candidate.id === tx.id || used.has(candidate.id)) continue;
      if (candidate.linkedAccountId === tx.linkedAccountId) continue;
      const closeAmount = Math.abs(Math.abs(candidate.amount) - absAmount) <= 0.01;
      if (!closeAmount) continue;
      if (Math.sign(candidate.amount) !== -Math.sign(tx.amount)) continue;
      const delta = Math.abs(safeDate(candidate.occurredAt) - safeDate(tx.occurredAt));
      if (delta > maxPairWindowMs) continue;
      matched = candidate;
      break;
    }

    if (!matched) continue;
    used.add(tx.id);
    used.add(matched.id);

    const debit = tx.amount > 0 ? tx : matched;
    const credit = tx.amount < 0 ? tx : matched;
    const deltaDays = Math.abs(safeDate(matched.occurredAt) - safeDate(tx.occurredAt)) / MS_PER_DAY;
    const confidence = clamp(0.72 + (1 - clamp(deltaDays / (maxPairWindowMs / MS_PER_DAY), 0, 1)) * 0.22, 0.5, 0.98);
    pairs.push({
      debitTransactionId: debit.id,
      creditTransactionId: credit.id,
      fromAccountId: debit.linkedAccountId,
      toAccountId: credit.linkedAccountId,
      amount: round(Math.abs(debit.amount)),
      occurredAt: new Date(Math.max(safeDate(debit.occurredAt), safeDate(credit.occurredAt))).toISOString(),
      confidence: round(confidence),
    });
  }

  return pairs.sort((a, b) => safeDate(b.occurredAt) - safeDate(a.occurredAt));
}

export function buildCrossAccountMoneyFlowAnalysis(input: {
  transactions: FinancialOsTransactionSignal[];
  transferPairs: FinancialTransferPair[];
}): CrossAccountMoneyFlowAnalysis {
  const pairedIds = new Set<string>();
  for (const pair of input.transferPairs) {
    pairedIds.add(pair.debitTransactionId);
    pairedIds.add(pair.creditTransactionId);
  }

  let trueSpendAmount = 0;
  let trueIncomeAmount = 0;
  const byAccount = new Map<string, { inflow: number; outflow: number }>();

  for (const tx of input.transactions) {
    if (tx.pending || pairedIds.has(tx.id)) continue;
    const amount = Math.abs(tx.amount);
    const summary = byAccount.get(tx.linkedAccountId) || { inflow: 0, outflow: 0 };
    if (tx.amount > 0) {
      trueSpendAmount += amount;
      summary.outflow += amount;
    } else {
      trueIncomeAmount += amount;
      summary.inflow += amount;
    }
    byAccount.set(tx.linkedAccountId, summary);
  }

  const internalTransferAmount = input.transferPairs.reduce((sum, pair) => sum + pair.amount, 0);
  const byAccountList = [...byAccount.entries()].map(([accountId, values]) => ({
    accountId,
    inflow: round(values.inflow),
    outflow: round(values.outflow),
    net: round(values.inflow - values.outflow),
  }));

  const confidence = clamp(
    0.45
      + Math.min(input.transactions.length / 180, 1) * 0.35
      + Math.min(input.transferPairs.length / 12, 1) * 0.2,
    0.2,
    0.98,
  );

  return {
    internalTransferAmount: round(internalTransferAmount),
    trueSpendAmount: round(trueSpendAmount),
    trueIncomeAmount: round(trueIncomeAmount),
    netCashFlow: round(trueIncomeAmount - trueSpendAmount),
    transferPairs: input.transferPairs,
    byAccount: byAccountList.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    confidence: round(confidence),
    explanation:
      "Cross-account analysis removes mirrored internal transfers before calculating true spend and income.",
    factors: [
      `${input.transferPairs.length} internal transfer pair(s) identified.`,
      `${byAccountList.length} account-level flow stream(s) summarized.`,
    ],
  };
}

export function composeFinancialTimeline(input: FinancialTimelineInput): FinancialTimelineEvent[] {
  const nowMs = safeDate(input.nowIso);
  const events: FinancialTimelineEvent[] = [];

  const incomeSignals = input.transactions
    .filter((tx) => !tx.pending && tx.amount < 0 && Math.abs(tx.amount) >= 50)
    .sort((a, b) => safeDate(b.occurredAt) - safeDate(a.occurredAt))
    .slice(0, 6);
  for (const tx of incomeSignals) {
    events.push({
      id: `payday:${tx.id}`,
      kind: "payday",
      title: "Payday posted",
      summary: `${tx.merchantName || "Income"} credited to account.`,
      occurredAt: tx.occurredAt,
      direction: safeDate(tx.occurredAt) <= nowMs ? "past" : "upcoming",
      amount: round(Math.abs(tx.amount)),
      currency: input.currency,
      priority: "medium",
      deepLink: "/transactions?filter=income",
      confidence: 0.9,
      explainability: {
        summary: "Detected as an income transaction by amount sign and amount threshold.",
        factors: [`Merchant: ${tx.merchantName}.`, `Amount: ${round(Math.abs(tx.amount))}.`],
      },
    });
  }

  for (const bill of input.bills.slice(0, 8)) {
    events.push({
      id: `bill:${bill.id}`,
      kind: "bill",
      title: `Bill expected: ${bill.merchant}`,
      summary: `Predicted ${bill.merchant} bill from recurring cadence.`,
      occurredAt: bill.dueDate,
      direction: safeDate(bill.dueDate) <= nowMs ? "past" : "upcoming",
      amount: round(bill.amount),
      currency: input.currency,
      priority: safeDate(bill.dueDate) <= nowMs + 3 * MS_PER_DAY ? "high" : "medium",
      deepLink: "/statements",
      confidence: bill.confidence,
      explainability: {
        summary: bill.explanation,
        factors: bill.factors,
      },
    });
  }

  for (const subscription of input.subscriptions.slice(0, 8)) {
    const date = subscription.nextExpectedChargeDate || subscription.lastSeen;
    events.push({
      id: `subscription:${subscription.id}`,
      kind: "subscription",
      title: `Subscription: ${subscription.merchant}`,
      summary: `Recurring subscription timeline event (${subscription.lifecycleStatus}).`,
      occurredAt: date,
      direction: safeDate(date) <= nowMs ? "past" : "upcoming",
      amount: round(subscription.monthlyCost),
      currency: input.currency,
      priority: "low",
      deepLink: "/subscriptions",
      confidence: subscription.confidence,
      explainability: {
        summary: subscription.explanation,
        factors: subscription.factors,
      },
    });
  }

  for (const task of input.taskActions.slice(0, 12)) {
    events.push({
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      summary: task.summary,
      occurredAt: task.updatedAt,
      direction: safeDate(task.updatedAt) <= nowMs ? "past" : "upcoming",
      amount: task.amount === null ? null : round(task.amount),
      currency: task.currency,
      priority: priorityForTaskStatus(task.status),
      deepLink: "/tasks",
      confidence: task.confidence,
      explainability: {
        summary: task.explainability.summary,
        factors: task.explainability.factors,
      },
    });
  }

  for (const insight of input.anomalyInsights.slice(0, 6)) {
    events.push({
      id: `anomaly:${insight.id}`,
      kind: "anomaly",
      title: insight.title,
      summary: insight.summary,
      occurredAt: insight.generatedAt,
      direction: safeDate(insight.generatedAt) <= nowMs ? "past" : "upcoming",
      amount: insight.amountImpact ?? null,
      currency: input.currency,
      priority: "high",
      deepLink: "/insights",
      confidence: 0.82,
      explainability: {
        summary: "Derived from anomaly insight generation.",
        factors: ["Unusual spending insight marked active."],
      },
    });
  }

  for (const transfer of input.transferPairs.slice(0, 8)) {
    events.push({
      id: `transfer:${transfer.debitTransactionId}:${transfer.creditTransactionId}`,
      kind: "transfer",
      title: "Internal transfer detected",
      summary: `Money moved between linked accounts (${transfer.fromAccountId} -> ${transfer.toAccountId}).`,
      occurredAt: transfer.occurredAt,
      direction: safeDate(transfer.occurredAt) <= nowMs ? "past" : "upcoming",
      amount: round(transfer.amount),
      currency: input.currency,
      priority: "low",
      deepLink: "/accounts",
      confidence: transfer.confidence,
      explainability: {
        summary: "Matched opposite-sign transactions of same amount across accounts.",
        factors: [
          `From account: ${transfer.fromAccountId}.`,
          `To account: ${transfer.toAccountId}.`,
        ],
      },
    });
  }

  if (input.monthlyBudget > 0) {
    const now = new Date(nowMs);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() - 1;
    events.push({
      id: `goal:monthly_budget:${now.getFullYear()}-${now.getMonth() + 1}`,
      kind: "goal",
      title: "Monthly budget checkpoint",
      summary: `Monthly budget target is ${round(input.monthlyBudget)}.`,
      occurredAt: new Date(monthEnd).toISOString(),
      direction: monthEnd <= nowMs ? "past" : "upcoming",
      amount: round(input.monthlyBudget),
      currency: input.currency,
      priority: input.taskSummary.pendingConfirmCount > 0 ? "medium" : "low",
      deepLink: "/budgets",
      confidence: 0.92,
      explainability: {
        summary: "Generated from wallet budget settings as a timeline goal marker.",
        factors: [`Budget target: ${round(input.monthlyBudget)}.`],
      },
    });
  }

  return events
    .sort((a, b) => safeDate(a.occurredAt) - safeDate(b.occurredAt))
    .slice(0, 80);
}
