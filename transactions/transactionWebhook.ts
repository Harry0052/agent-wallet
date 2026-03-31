import "server-only";

import {
  listConnectorItemSecretsByPlaidItemId,
  setNewAccountsAvailable,
  updateItemStatus,
} from "@/financial_connectors/tokenVault";
import { syncPlaidTransactionsForConnectorItem } from "@/transactions/transactionSync";
import { runStatementPipeline } from "@/statements/statementSync";
import { reconcileAllForUser } from "@/statements/statementReconciler";
import { syncInvestmentsForUser } from "@/financial_connectors/investmentService";
import { syncLiabilitiesForUser } from "@/financial_connectors/liabilityService";
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
  const isLoginRepaired = webhookCode === "LOGIN_REPAIRED";
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

  // Login repaired — Plaid auto-fixed the login, clear relink_required state
  if (isLoginRepaired) {
    for (const secret of secrets) {
      await updateItemStatus({
        userId: secret.user_id,
        plaidItemId: secret.plaid_item_id,
        status: "good",
      });
    }

    logServerEvent("info", "connect.webhook.login_repaired", {
      itemId,
      usersAffected: secrets.length,
    });

    return {
      handled: true,
      reason: `Login repaired — ${secrets.length} item(s) restored to good status.`,
      synced_items: 0,
      synced_users: secrets.length,
    };
  }

  // New accounts available — persist flag so UI can prompt the user
  if (isNewAccountsAvailable) {
    for (const secret of secrets) {
      await setNewAccountsAvailable({
        userId: secret.user_id,
        plaidItemId: secret.plaid_item_id,
        available: true,
      });
    }

    logServerEvent("info", "connect.webhook.new_accounts_available", {
      itemId,
      usersAffected: secrets.length,
    });

    return {
      handled: true,
      reason: `New accounts available — ${secrets.length} user(s) flagged.`,
      synced_items: 0,
      synced_users: secrets.length,
    };
  }

  return { handled: false, reason: `Unhandled ITEM webhook code: ${webhookCode}.`, synced_items: 0, synced_users: 0 };
}

const STATEMENTS_SYNC_CODES = new Set([
  "STATEMENTS_REFRESH_COMPLETE",
]);

async function handleStatementsWebhook(
  payload: PlaidWebhookPayload,
): Promise<TransactionWebhookResult> {
  const webhookCode = payload.webhook_code?.trim().toUpperCase();
  const itemId = payload.item_id?.trim();

  if (!webhookCode || !STATEMENTS_SYNC_CODES.has(webhookCode)) {
    return {
      handled: false,
      reason: `Ignored unsupported STATEMENTS webhook code: ${webhookCode}.`,
      synced_items: 0,
      synced_users: 0,
    };
  }

  if (!itemId) {
    return {
      handled: false,
      reason: "STATEMENTS webhook missing item_id.",
      synced_items: 0,
      synced_users: 0,
    };
  }

  const secrets = await listConnectorItemSecretsByPlaidItemId(itemId);
  if (secrets.length === 0) {
    return {
      handled: true,
      reason: "No linked users found for STATEMENTS webhook item_id.",
      synced_items: 0,
      synced_users: 0,
    };
  }

  const seenUsers = new Set<string>();
  let syncedItems = 0;

  for (const secret of secrets) {
    try {
      // Run full statement pipeline: metadata sync + download + parse
      const pipelineResult = await runStatementPipeline({
        userId: secret.user_id,
        itemId: secret.plaid_item_id,
        plaidItemId: secret.plaid_item_id,
        accessToken: secret.plaid_access_token,
        institutionId: null,
        institutionName: null,
      });

      // Reconcile extracted transactions against live data
      await reconcileAllForUser(secret.user_id);

      seenUsers.add(secret.user_id);
      syncedItems += 1;

      logServerEvent("info", "connect.webhook.statements.synced", {
        userId: secret.user_id,
        itemId: secret.plaid_item_id,
        metadataSynced: pipelineResult.metadataSynced,
        downloaded: pipelineResult.downloaded,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statement sync failed.";
      logServerEvent("error", "connect.webhook.statements.sync_failed", {
        userId: secret.user_id,
        itemId: secret.plaid_item_id,
        message,
      });
    }
  }

  return {
    handled: true,
    reason: `Statement sync completed for ${syncedItems} item(s).`,
    synced_items: syncedItems,
    synced_users: seenUsers.size,
  };
}

async function handleProductSyncWebhook(
  payload: PlaidWebhookPayload,
  product: "investments" | "liabilities",
): Promise<TransactionWebhookResult> {
  const webhookCode = payload.webhook_code?.trim().toUpperCase();
  const itemId = payload.item_id?.trim();

  // Only sync on DEFAULT_UPDATE (the standard refresh trigger)
  if (webhookCode !== "DEFAULT_UPDATE") {
    return {
      handled: false,
      reason: `Ignored ${product} webhook code: ${webhookCode}.`,
      synced_items: 0,
      synced_users: 0,
    };
  }

  if (!itemId) {
    return {
      handled: false,
      reason: `${product} webhook missing item_id.`,
      synced_items: 0,
      synced_users: 0,
    };
  }

  const secrets = await listConnectorItemSecretsByPlaidItemId(itemId);
  if (secrets.length === 0) {
    return {
      handled: true,
      reason: `No linked users for ${product} webhook item_id.`,
      synced_items: 0,
      synced_users: 0,
    };
  }

  const seenUsers = new Set<string>();
  for (const secret of secrets) {
    try {
      if (product === "investments") {
        await syncInvestmentsForUser(secret.user_id);
      } else {
        await syncLiabilitiesForUser(secret.user_id);
      }
      seenUsers.add(secret.user_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      logServerEvent("error", `connect.webhook.${product}.sync_failed`, {
        userId: secret.user_id,
        itemId,
        message,
      });
    }
  }

  return {
    handled: true,
    reason: `${product} sync completed for ${seenUsers.size} user(s).`,
    synced_items: seenUsers.size,
    synced_users: seenUsers.size,
  };
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

  // Handle STATEMENTS webhooks for statement refresh completion
  if (webhookType === "STATEMENTS") {
    return handleStatementsWebhook(payload);
  }

  // Handle HOLDINGS webhooks for investment data updates
  if (webhookType === "HOLDINGS") {
    return handleProductSyncWebhook(payload, "investments");
  }

  // Handle LIABILITIES webhooks for liability data updates
  if (webhookType === "LIABILITIES") {
    return handleProductSyncWebhook(payload, "liabilities");
  }

  if (webhookType !== "TRANSACTIONS") {
    return {
      handled: false,
      reason: "Ignored non-supported webhook type.",
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
