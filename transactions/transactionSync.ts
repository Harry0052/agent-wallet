import "server-only";

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

export interface TransactionSyncResult {
  user_id: string;
  plaid_item_id: string;
  added_count: number;
  modified_count: number;
  removed_count: number;
  pages: number;
  cursor: string | null;
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
  const plaid = getPlaidClient();
  const linkedBindings = await listLinkedAccountBindingsForUser(input.userId);
  const linkedAccountMap = resolveLinkedAccountMap(linkedBindings);
  let cursor = await getSyncCursor({
    userId: input.userId,
    plaidItemId: input.plaidItemId,
  });

  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;
  let pageCount = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await plaid.syncTransactions({
      accessToken: input.accessToken,
      cursor,
      count: 100,
    });
    pageCount += 1;

    const addedRows = page.added
      .map((transaction) => {
        const linkedAccountId = linkedAccountMap.get(transaction.account_id);
        if (!linkedAccountId) return null;
        return normalizePlaidTransaction({
          user_id: input.userId,
          linked_account_id: linkedAccountId,
          raw: transaction,
        });
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const modifiedRows = page.modified
      .map((transaction) => {
        const linkedAccountId = linkedAccountMap.get(transaction.account_id);
        if (!linkedAccountId) return null;
        return normalizePlaidTransaction({
          user_id: input.userId,
          linked_account_id: linkedAccountId,
          raw: transaction,
        });
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const removedIds = page.removed
      .map((removed) => removed.transaction_id)
      .filter((id) => id.trim().length > 0);

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

  return {
    user_id: input.userId,
    plaid_item_id: input.plaidItemId,
    added_count: addedCount,
    modified_count: modifiedCount,
    removed_count: removedCount,
    pages: pageCount,
    cursor,
  };
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
