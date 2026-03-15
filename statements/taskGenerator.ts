import "server-only";

import { recordAgentTask } from "@/lib/server/ledger";
import { listNormalizedTransactions } from "@/transactions/transactionRepository";
import type { TransactionSyncResult } from "@/transactions/transactionSync";

/**
 * Inspects a completed transaction sync result and emits agent_task entries
 * for notable events: first import, recurring subscriptions, spend spikes,
 * and unknown merchants.
 *
 * Does NOT store raw transaction text in any vector/embedding store (per spec C.8).
 */
export async function generateStatementTasks(
  userId: string,
  syncResult: TransactionSyncResult,
): Promise<void> {
  if (!userId || !syncResult) return;

  const tasks: Array<{
    taskType: string;
    intent: string;
    input: Record<string, unknown>;
  }> = [];

  // C.7.1 — statement_imported: emit on any sync with > 0 added transactions.
  if (syncResult.added_count > 0) {
    tasks.push({
      taskType: "statement_imported",
      intent: "New transactions imported from connected account",
      input: {
        plaid_item_id: syncResult.plaid_item_id,
        added_count: syncResult.added_count,
        modified_count: syncResult.modified_count,
        removed_count: syncResult.removed_count,
      },
    });
  }

  // Fetch recent transactions for analysis (limit 500 covers ~3 months for most users).
  const transactions = await listNormalizedTransactions({ userId, limit: 500 });

  if (transactions.length === 0) {
    await Promise.all(
      tasks.map((t) =>
        recordAgentTask({
          userId,
          taskType: t.taskType,
          intent: t.intent,
          status: "ready",
          input: t.input,
        }),
      ),
    );
    return;
  }

  // C.7.2 — recurring_subscription_found: merchant appears ≥ 2× in the same
  // calendar month with the same amount ±10%.
  const merchantMonthMap = new Map<
    string,
    Map<string, Array<{ amount: number }>>
  >();

  for (const tx of transactions) {
    const merchant = tx.normalized_merchant?.trim();
    if (!merchant) continue;
    const month = tx.occurred_at.slice(0, 7); // "YYYY-MM"
    if (!merchantMonthMap.has(merchant)) {
      merchantMonthMap.set(merchant, new Map());
    }
    const monthMap = merchantMonthMap.get(merchant)!;
    if (!monthMap.has(month)) {
      monthMap.set(month, []);
    }
    monthMap.get(month)!.push({ amount: tx.amount });
  }

  const emittedSubscriptions = new Set<string>();
  for (const [merchant, monthMap] of merchantMonthMap) {
    for (const [month, entries] of monthMap) {
      if (entries.length < 2) continue;
      // Check that all entries are within ±10% of the first amount.
      const baseAmount = entries[0].amount;
      const allSimilar = entries.every(
        (e) => Math.abs(e.amount - baseAmount) / Math.max(Math.abs(baseAmount), 0.01) <= 0.1,
      );
      if (allSimilar && !emittedSubscriptions.has(merchant)) {
        emittedSubscriptions.add(merchant);
        tasks.push({
          taskType: "subscription_found",
          intent: `Recurring subscription detected for ${merchant}`,
          input: { merchant, month, occurrences: entries.length, amount: baseAmount },
        });
      }
    }
  }

  // C.7.3 — unusual_spend_spike: single transaction > 2× the 90-day average
  // for its category.
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const categoryAmounts = new Map<string, number[]>();

  for (const tx of transactions) {
    const txMs = new Date(tx.occurred_at).getTime();
    if (now - txMs > NINETY_DAYS_MS) continue;
    const cat = tx.category?.trim() || "unknown";
    if (!categoryAmounts.has(cat)) categoryAmounts.set(cat, []);
    categoryAmounts.get(cat)!.push(tx.amount);
  }

  const categoryAvg = new Map<string, number>();
  for (const [cat, amounts] of categoryAmounts) {
    const avg = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    categoryAvg.set(cat, avg);
  }

  // Only check transactions from the current sync (the most recently added ones).
  // We approximate "newly added" by looking at the newest `added_count` transactions.
  const recentAdded = transactions.slice(0, Math.max(syncResult.added_count, 1));
  for (const tx of recentAdded) {
    const cat = tx.category?.trim() || "unknown";
    const avg = categoryAvg.get(cat);
    if (avg && avg > 0 && tx.amount > avg * 2) {
      tasks.push({
        taskType: "spend_spike",
        intent: `Unusual spend detected in category ${cat}`,
        input: {
          category: cat,
          amount: tx.amount,
          category_avg: avg,
          merchant: tx.merchant_name || tx.normalized_merchant,
          occurred_at: tx.occurred_at,
        },
      });
    }
  }

  // C.7.4 — unknown_merchant: merchant_name is null/empty on a transaction > $5.
  for (const tx of recentAdded) {
    const isMissingMerchant = !tx.merchant_name?.trim();
    if (isMissingMerchant && tx.amount > 5) {
      tasks.push({
        taskType: "unknown_merchant",
        intent: "Transaction from unidentified merchant",
        input: {
          amount: tx.amount,
          category: tx.category,
          occurred_at: tx.occurred_at,
        },
      });
    }
  }

  await Promise.all(
    tasks.map((t) =>
      recordAgentTask({
        userId,
        taskType: t.taskType,
        intent: t.intent,
        status: "ready",
        input: t.input,
      }),
    ),
  );
}
