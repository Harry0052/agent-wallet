import 'server-only';

import type { SecureDbClient } from '@/database/dbService';
import { withDbTransaction } from '@/lib/server/db';

const APP_SCOPED_TABLES = [
  'app_account_audit_events',
] as const;

const WALLET_SCOPED_TABLES = [
  'wallet_payment_methods',
  'wallet_recipients',
  'recipients',
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

export async function deleteUserAccountData(input: {
  appUserId: string;
  walletUserId: string;
}): Promise<void> {
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
