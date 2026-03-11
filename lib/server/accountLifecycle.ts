import 'server-only';

import type { PoolClient } from 'pg';
import { withDbTransaction } from '@/lib/server/db';

const WALLET_SCOPED_TABLES = [
  'wallet_payment_methods',
  'wallet_recipients',
  'recipients',
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

async function deleteWalletScopedData(
  client: PoolClient,
  walletUserId: string,
): Promise<void> {
  for (const table of WALLET_SCOPED_TABLES) {
    await client.query(
      `DELETE FROM ${quotedTableName(table)} WHERE user_id = $1`,
      [walletUserId],
    );
  }
}

export async function deleteUserAccountData(input: {
  appUserId: string;
  walletUserId: string;
}): Promise<void> {
  await withDbTransaction(async (client) => {
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
