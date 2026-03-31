import 'server-only';

import type { SecureDbClient } from '@/database/dbService';
import { withDbTransaction } from '@/lib/server/db';
import { logServerEvent } from '@/lib/server/observability';

const APP_SCOPED_TABLES = [
  'app_account_audit_events',
] as const;

const WALLET_SCOPED_TABLES = [
  'wallet_payment_methods',
  'wallet_recipients',
  'recipients',
  // Plaid-derived data — clean up before removing items
  'investment_holdings',
  'liability_details',
  'statement_extracted_transactions',
  'statement_documents',
  // Core financial connector tables
  'financial_connector_accounts',
  'financial_connector_items',
  'transactions',
  'transaction_sync_cursors',
  'user_autofill_profiles',
  'ledger_entries',
  'payment_flow_events',
  'payment_retry_jobs',
  'refund_audit_logs',
  'refund_cases',
  'payment_flows',
  'agent_tasks',
  'web_action_logs',
  'approval_decisions',
  'procurement_findings',
  'procurement_tasks',
  'subscription_actions',
  'agent_memory',
  'financial_sync_leases',
  'financial_sync_runs',
  'financial_notifications',
  'financial_documents',
] as const;

function quotedTableName(table: string): string {
  return `"${table.replace(/"/g, '')}"`;
}

async function tableExists(client: SecureDbClient, table: string): Promise<boolean> {
  const result = await client.query<{ table_name: string | null }>(
    `SELECT to_regclass($1) AS table_name`,
    [`public.${table}`],
  );
  return Boolean(result.rows[0]?.table_name);
}

async function deleteUserScopedData(
  client: SecureDbClient,
  table: string,
  column: string,
  userId: string,
): Promise<void> {
  if (!(await tableExists(client, table))) return;

  await client.query(
    `DELETE FROM ${quotedTableName(table)} WHERE ${quotedTableName(column)} = $1`,
    [userId],
  );
}

async function deleteAppScopedData(
  client: SecureDbClient,
  appUserId: string,
): Promise<void> {
  for (const table of APP_SCOPED_TABLES) {
    await deleteUserScopedData(client, table, 'user_id', appUserId);
  }
}

async function deleteWalletScopedData(
  client: SecureDbClient,
  walletUserId: string,
): Promise<void> {
  for (const table of WALLET_SCOPED_TABLES) {
    await deleteUserScopedData(client, table, 'user_id', walletUserId);
  }
}

/**
 * Call Plaid /item/remove for all active Items belonging to a user.
 * Best-effort: failures are logged but do not block account deletion.
 * Must be called BEFORE DB rows are deleted (needs access tokens).
 */
async function removeAllPlaidItemsForUser(walletUserId: string): Promise<void> {
  try {
    // Dynamic import to avoid circular deps and keep this module lightweight
    const { listConnectorItemSecretsForUser } = await import(
      '@/financial_connectors/tokenVault'
    );
    const { getPlaidClient } = await import(
      '@/financial_connectors/plaidClient'
    );

    const secrets = await listConnectorItemSecretsForUser(walletUserId);
    if (secrets.length === 0) return;

    const plaid = getPlaidClient();
    for (const item of secrets) {
      try {
        await plaid.removeItem(item.plaid_access_token);
        logServerEvent('info', 'account.deletion.plaid_item_removed', {
          walletUserId,
          plaidItemId: item.plaid_item_id,
        });
      } catch (error) {
        // INVALID_ACCESS_TOKEN means already removed — that's fine.
        const message = error instanceof Error ? error.message : 'unknown';
        logServerEvent('warn', 'account.deletion.plaid_item_remove_failed', {
          walletUserId,
          plaidItemId: item.plaid_item_id,
          message,
        });
      }
    }
  } catch (error) {
    // If the entire lookup fails, log and proceed with local deletion
    const message = error instanceof Error ? error.message : 'unknown';
    logServerEvent('warn', 'account.deletion.plaid_items_lookup_failed', {
      walletUserId,
      message,
    });
  }
}

export async function deleteUserAccountData(input: {
  appUserId: string;
  walletUserId: string;
}): Promise<void> {
  // Remove Plaid Items from Plaid's side BEFORE deleting local DB rows
  // (we need the encrypted access tokens which live in the DB).
  await removeAllPlaidItemsForUser(input.walletUserId);

  await withDbTransaction(async (client) => {
    // Purge application events/logs that are not covered by FK cascades.
    await deleteAppScopedData(client, input.appUserId);

    // Deleting app_users cascades app-bound auth/session/settings rows.
    await client.query(
      `DELETE FROM app_users WHERE id = $1`,
      [input.appUserId],
    );

    // Purge wallet-scoped records that are not guaranteed by FK cascades.
    await deleteWalletScopedData(client, input.walletUserId);

    // Wallet user deletion cascades user_tools + vault/tool events/configs.
    await client.query(
      `DELETE FROM wallet_users WHERE user_id = $1`,
      [input.walletUserId],
    );
  });
}
