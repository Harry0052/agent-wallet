import "server-only";

import {
  listConnectorItemSecretsByPlaidItemId,
} from "@/financial_connectors/tokenVault";
import { syncPlaidTransactionsForConnectorItem } from "@/transactions/transactionSync";

export interface PlaidWebhookPayload {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  new_transactions?: number;
}

export interface TransactionWebhookResult {
  handled: boolean;
  reason: string;
  synced_items: number;
  synced_users: number;
}

const SYNC_TRIGGER_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "DEFAULT_UPDATE",
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "TRANSACTIONS_REMOVED",
]);

export async function handlePlaidTransactionWebhook(
  payload: PlaidWebhookPayload,
): Promise<TransactionWebhookResult> {
  const webhookType = payload.webhook_type?.trim().toUpperCase();
  const webhookCode = payload.webhook_code?.trim().toUpperCase();
  const itemId = payload.item_id?.trim();

  if (webhookType !== "TRANSACTIONS") {
    return {
      handled: false,
      reason: "Ignored non-TRANSACTIONS webhook.",
      synced_items: 0,
      synced_users: 0,
    };
  }

  if (!webhookCode || !SYNC_TRIGGER_CODES.has(webhookCode)) {
    return {
      handled: false,
      reason: "Ignored unsupported TRANSACTIONS webhook code.",
      synced_items: 0,
      synced_users: 0,
    };
  }

  if (!itemId) {
    return {
      handled: false,
      reason: "Ignored webhook without item_id.",
      synced_items: 0,
      synced_users: 0,
    };
  }

  const secrets = await listConnectorItemSecretsByPlaidItemId(itemId);
  if (secrets.length === 0) {
    return {
      handled: true,
      reason: "No linked users found for webhook item_id.",
      synced_items: 0,
      synced_users: 0,
    };
  }

  const seenUsers = new Set<string>();
  let syncedItems = 0;

  for (const secret of secrets) {
    await syncPlaidTransactionsForConnectorItem({
      userId: secret.user_id,
      plaidItemId: secret.plaid_item_id,
      accessToken: secret.plaid_access_token,
    });
    seenUsers.add(secret.user_id);
    syncedItems += 1;
  }

  return {
    handled: true,
    reason: `Synced ${syncedItems} connector item(s).`,
    synced_items: syncedItems,
    synced_users: seenUsers.size,
  };
}
