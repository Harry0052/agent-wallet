import "server-only";

import {
  listConnectorItemSecretsByPlaidItemId,
  updateItemStatus,
} from "@/financial_connectors/tokenVault";
import { syncPlaidTransactionsForConnectorItem } from "@/transactions/transactionSync";
import { logServerEvent } from "@/lib/server/observability";

export interface PlaidWebhookPayload {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  new_transactions?: number;
  error?: {
    error_code?: string;
    error_message?: string;
  };
  consent_expiration_time?: string;
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

async function handleItemWebhook(
  payload: PlaidWebhookPayload,
): Promise<TransactionWebhookResult> {
  const webhookCode = payload.webhook_code?.trim().toUpperCase();
  const itemId = payload.item_id?.trim();

  if (!itemId) {
    return { handled: false, reason: "ITEM webhook missing item_id.", synced_items: 0, synced_users: 0 };
  }

  const secrets = await listConnectorItemSecretsByPlaidItemId(itemId);
  if (secrets.length === 0) {
    return { handled: true, reason: "No linked users for ITEM webhook.", synced_items: 0, synced_users: 0 };
  }

  const errorCode = payload.error?.error_code;
  const isLoginRequired = webhookCode === "ERROR" && errorCode === "ITEM_LOGIN_REQUIRED";
  const isPendingExpiration = webhookCode === "PENDING_EXPIRATION";
  const isPendingDisconnect = webhookCode === "PENDING_DISCONNECT";
  const isNewAccountsAvailable = webhookCode === "NEW_ACCOUNTS_AVAILABLE";
  const isUserPermissionRevoked = webhookCode === "USER_PERMISSION_REVOKED";

  // Relink-required states: login required, pending expiration, pending disconnect
  if (isLoginRequired || isPendingExpiration || isPendingDisconnect) {
    for (const secret of secrets) {
      await updateItemStatus({
        userId: secret.user_id,
        plaidItemId: secret.plaid_item_id,
        status: "relink_required",
        errorCode: errorCode || webhookCode || "RELINK_REQUIRED",
      });
    }

    logServerEvent("warn", "connect.webhook.item_relink_required", {
      itemId,
      webhookCode,
      errorCode,
      usersAffected: secrets.length,
    });

    return {
      handled: true,
      reason: `Item relink required (${webhookCode}).`,
      synced_items: 0,
      synced_users: secrets.length,
    };
  }

  // User revoked permission — mark as error, the item is no longer usable
  if (isUserPermissionRevoked) {
    for (const secret of secrets) {
      await updateItemStatus({
        userId: secret.user_id,
        plaidItemId: secret.plaid_item_id,
        status: "error",
        errorCode: "USER_PERMISSION_REVOKED",
      });
    }

    logServerEvent("warn", "connect.webhook.user_permission_revoked", {
      itemId,
      usersAffected: secrets.length,
    });

    return {
      handled: true,
      reason: "User permission revoked — item disconnected.",
      synced_items: 0,
      synced_users: secrets.length,
    };
  }

  // New accounts available — log for awareness, user can re-link to add them
  if (isNewAccountsAvailable) {
    logServerEvent("info", "connect.webhook.new_accounts_available", {
      itemId,
      usersAffected: secrets.length,
    });

    return {
      handled: true,
      reason: "New accounts available at institution — user can re-link to add.",
      synced_items: 0,
      synced_users: secrets.length,
    };
  }

  return { handled: false, reason: `Unhandled ITEM webhook code: ${webhookCode}.`, synced_items: 0, synced_users: 0 };
}

export async function handlePlaidTransactionWebhook(
  payload: PlaidWebhookPayload,
): Promise<TransactionWebhookResult> {
  const webhookType = payload.webhook_type?.trim().toUpperCase();
  const webhookCode = payload.webhook_code?.trim().toUpperCase();
  const itemId = payload.item_id?.trim();

  // Handle ITEM webhooks for relink/error detection
  if (webhookType === "ITEM") {
    return handleItemWebhook(payload);
  }

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
