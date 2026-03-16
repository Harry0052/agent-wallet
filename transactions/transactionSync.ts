import "server-only";

import { randomUUID } from "node:crypto";
import { getPlaidClient } from "@/financial_connectors/plaidClient";
import {
  listConnectorItemSecretsForUser,
  listLinkedAccountBindingsForUser,
} from "@/financial_connectors/tokenVault";
import { normalizePlaidTransaction } from "@/transactions/transactionNormalizer";
import {
  getSyncCursor,
  removeTransactionsByProviderIds,
  setSyncCursor,
  upsertNormalizedTransactions,
} from "@/transactions/transactionRepository";
import {
  buildTransactionSyncIdempotencyKey,
  dedupeByProviderId,
  dedupeRemovedProviderTransactionIds,
} from "@/transactions/transactionSyncCore";
import { generateStatementTasks } from "@/statements/taskGenerator";
import { emitEngineEvent } from "@/lib/server/engines/eventBus";
import {
  acquireFinancialSyncLease,
  beginFinancialSyncRun,
  completeFinancialSyncRun,
  failFinancialSyncRun,
  releaseFinancialSyncLease,
} from "@/lib/server/financialOs/store";
import { logServerEvent } from "@/lib/server/observability";

export interface TransactionSyncResult {
  user_id: string;
  plaid_item_id: string;
  added_count: number;
  modified_count: number;
  removed_count: number;
  pages: number;
  cursor: string | null;
  run_id?: string;
  status?: "completed" | "failed" | "skipped";
  skip_reason?: string;
}

interface SyncConnectorItemInput {
  userId: string;
  plaidItemId: string;
  accessToken: string;
}

function resolveLinkedAccountMap(bindings: Array<{ id: string; plaid_account_id: string }>): Map<string, string> {
  return new Map(bindings.map((binding) => [binding.plaid_account_id, binding.id]));
}

export async function syncPlaidTransactionsForConnectorItem(
  input: SyncConnectorItemInput,
): Promise<TransactionSyncResult> {
  const leaseHolderId = randomUUID();
  const leaseAcquired = await acquireFinancialSyncLease({
    userId: input.userId,
    plaidItemId: input.plaidItemId,
    holderId: leaseHolderId,
    leaseSeconds: 180,
  });
  if (!leaseAcquired) {
    logServerEvent("info", "connect.transactions.sync.skipped_lock", {
      userId: input.userId,
      plaidItemId: input.plaidItemId,
    });
    return {
      user_id: input.userId,
      plaid_item_id: input.plaidItemId,
      added_count: 0,
      modified_count: 0,
      removed_count: 0,
      pages: 0,
      cursor: null,
      status: "skipped",
      skip_reason: "sync_already_in_progress",
    };
  }

  const plaid = getPlaidClient();
  const linkedBindings = await listLinkedAccountBindingsForUser(input.userId);
  const linkedAccountMap = resolveLinkedAccountMap(linkedBindings);
  const cursorStart = await getSyncCursor({
    userId: input.userId,
    plaidItemId: input.plaidItemId,
  });
  let cursor = cursorStart;
  const run = await beginFinancialSyncRun({
    userId: input.userId,
    plaidItemId: input.plaidItemId,
    idempotencyKey: buildTransactionSyncIdempotencyKey({
      plaidItemId: input.plaidItemId,
      cursorStart,
    }),
    cursorStart,
  });

  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;
  let pageCount = 0;
  let hasMore = true;
  try {
    while (hasMore) {
      const page = await plaid.syncTransactions({
        accessToken: input.accessToken,
        cursor,
        count: 100,
      });
      pageCount += 1;

      const addedRows = dedupeByProviderId(page.added
        .map((transaction) => {
          const linkedAccountId = linkedAccountMap.get(transaction.account_id);
          if (!linkedAccountId) return null;
          return normalizePlaidTransaction({
            user_id: input.userId,
            linked_account_id: linkedAccountId,
            raw: transaction,
          });
        })
        .filter((row): row is NonNullable<typeof row> => row !== null));

      const modifiedRows = dedupeByProviderId(page.modified
        .map((transaction) => {
          const linkedAccountId = linkedAccountMap.get(transaction.account_id);
          if (!linkedAccountId) return null;
          return normalizePlaidTransaction({
            user_id: input.userId,
            linked_account_id: linkedAccountId,
            raw: transaction,
          });
        })
        .filter((row): row is NonNullable<typeof row> => row !== null));

      const removedIds = dedupeRemovedProviderTransactionIds(
        page.removed.map((removed) => removed.transaction_id),
      );

      addedCount += await upsertNormalizedTransactions(addedRows);
      modifiedCount += await upsertNormalizedTransactions(modifiedRows);
      removedCount += await removeTransactionsByProviderIds({
        userId: input.userId,
        providerTransactionIds: removedIds,
      });

      cursor = page.nextCursor || cursor;
      hasMore = page.hasMore;
    }

    await setSyncCursor({
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      cursor,
    });

    await completeFinancialSyncRun({
      id: run.id,
      userId: input.userId,
      status: "completed",
      cursorEnd: cursor,
      addedCount,
      modifiedCount,
      removedCount,
      pages: pageCount,
    });

    const result: TransactionSyncResult = {
      user_id: input.userId,
      plaid_item_id: input.plaidItemId,
      added_count: addedCount,
      modified_count: modifiedCount,
      removed_count: removedCount,
      pages: pageCount,
      cursor,
      run_id: run.id,
      status: "completed",
    };

    await generateStatementTasks(input.userId, result);

    emitEngineEvent("transaction_synced", input.userId, {
      addedCount: addedCount,
      modifiedCount: modifiedCount,
      removedCount: removedCount,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    await failFinancialSyncRun({
      id: run.id,
      userId: input.userId,
      cursorEnd: cursor,
      addedCount,
      modifiedCount,
      removedCount,
      pages: pageCount,
      errorMessage: message,
    });

    logServerEvent("error", "connect.transactions.sync.run_failed", {
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      runId: run.id,
      message,
    });
    throw error;
  } finally {
    await releaseFinancialSyncLease({
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      holderId: leaseHolderId,
    });
  }
}

export async function syncPlaidTransactionsForUser(
  userId: string,
): Promise<TransactionSyncResult[]> {
  const itemSecrets = await listConnectorItemSecretsForUser(userId);
  const results: TransactionSyncResult[] = [];

  for (const item of itemSecrets) {
    const synced = await syncPlaidTransactionsForConnectorItem({
      userId: item.user_id,
      plaidItemId: item.plaid_item_id,
      accessToken: item.plaid_access_token,
    });
    results.push(synced);
  }

  return results;
}
