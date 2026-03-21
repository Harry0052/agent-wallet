import "server-only";

import { randomUUID } from "node:crypto";
import { query } from "@/lib/server/db";
import { decryptVaultValue } from "@/lib/server/vaultCrypto";
import { decryptData, encryptData } from "@/security/encryption";
import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";

assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");

export type ConnectedAccountType = "credit" | "checking" | "savings" | "loan" | "investment" | "other";

export interface ConnectedAccount {
  id: string;
  user_id: string;
  plaid_item_id: string;
  institution_name: string;
  account_type: ConnectedAccountType;
  subtype: string | null;
  mask: string;
  nickname: string;
  official_name: string | null;
  balance_available: number | null;
  balance_current: number | null;
  balance_limit: number | null;
  balance_currency: string;
  balance_refreshed_at: string | null;
  last_synced_at: string | null;
  item_status: "good" | "error" | "relink_required";
  item_error_code: string | null;
}

interface ConnectedAccountRow {
  id: string;
  user_id: string;
  plaid_item_id: string;
  institution_name: string;
  account_type: ConnectedAccountType;
  subtype: string | null;
  mask: string;
  nickname: string;
  official_name: string | null;
  balance_available: string | null;
  balance_current: string | null;
  balance_limit: string | null;
  balance_currency: string | null;
  balance_refreshed_at: string | null;
  last_synced_at: string | null;
  item_status: string | null;
  item_error_code: string | null;
}

interface StoredAccountInput {
  plaidAccountId: string;
  accountType: ConnectedAccountType;
  subtype: string | null;
  mask: string;
  nickname: string;
  officialName: string | null;
}

interface UpsertItemInput {
  userId: string;
  plaidItemId: string;
  plaidAccessToken: string;
  institutionId: string | null;
  institutionName: string;
  accounts: StoredAccountInput[];
}

interface InstitutionSummaryRow {
  institution_name: string;
  account_count: string;
}

interface ConnectorItemSecretRow {
  user_id: string;
  plaid_item_id: string;
  access_token_encrypted: string;
  access_token_key_version: string;
}

interface LinkedAccountBindingRow {
  id: string;
  plaid_account_id: string;
}

interface AccountOwnershipRow {
  id: string;
  user_id: string;
  item_id: string;
  plaid_account_id: string;
}

export interface ConnectedInstitution {
  institution_name: string;
  account_count: number;
}

export interface ConnectorItemSecret {
  user_id: string;
  plaid_item_id: string;
  plaid_access_token: string;
}

export interface LinkedAccountBinding {
  id: string;
  plaid_account_id: string;
}

declare global {
  var __financialConnectorsSchemaInitPromise: Promise<void> | undefined;
}

function rowToConnectedAccount(row: ConnectedAccountRow): ConnectedAccount {
  const status = row.item_status as ConnectedAccount["item_status"] | null;
  return {
    id: row.id,
    user_id: row.user_id,
    plaid_item_id: row.plaid_item_id,
    institution_name: row.institution_name,
    account_type: row.account_type,
    subtype: row.subtype ?? null,
    mask: row.mask,
    nickname: row.nickname,
    official_name: row.official_name ?? null,
    balance_available: row.balance_available != null ? Number(row.balance_available) : null,
    balance_current: row.balance_current != null ? Number(row.balance_current) : null,
    balance_limit: row.balance_limit != null ? Number(row.balance_limit) : null,
    balance_currency: row.balance_currency || "USD",
    balance_refreshed_at: row.balance_refreshed_at ?? null,
    last_synced_at: row.last_synced_at ?? null,
    item_status: status === "error" ? "error" : status === "relink_required" ? "relink_required" : "good",
    item_error_code: row.item_error_code ?? null,
  };
}

function decodeStoredAccessToken(
  encryptedValue: string,
  keyVersion: string,
): string {
  let decrypted: { access_token?: unknown } | null = null;
  try {
    decrypted = decryptData<{ access_token?: unknown }>(encryptedValue, keyVersion);
  } catch {
    // Backward compatibility for rows encrypted with legacy vault keys.
    const legacy = decryptVaultValue(encryptedValue, keyVersion);
    if (legacy && typeof legacy === "object") {
      decrypted = legacy as { access_token?: unknown };
    }
  }
  if (!decrypted || typeof decrypted !== "object") {
    throw new Error("Malformed encrypted Plaid access token payload.");
  }

  const token = decrypted.access_token;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Missing Plaid access token in vault payload.");
  }

  return token;
}

export async function ensureFinancialConnectorSchema(): Promise<void> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  if (globalThis.__financialConnectorsSchemaInitPromise) {
    return globalThis.__financialConnectorsSchemaInitPromise;
  }

  globalThis.__financialConnectorsSchemaInitPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS financial_connector_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        plaid_item_id TEXT NOT NULL,
        access_token_encrypted TEXT NOT NULL,
        access_token_key_version TEXT NOT NULL,
        institution_id TEXT,
        institution_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, plaid_item_id)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_financial_connector_items_user_id
      ON financial_connector_items (user_id, updated_at DESC);
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS financial_connector_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES financial_connector_items(id) ON DELETE CASCADE,
        plaid_account_id TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK (account_type IN ('credit', 'checking', 'savings', 'loan', 'investment', 'other')),
        subtype TEXT,
        mask TEXT NOT NULL,
        nickname TEXT NOT NULL,
        official_name TEXT,
        balance_available NUMERIC(14, 2),
        balance_current NUMERIC(14, 2),
        balance_limit NUMERIC(14, 2),
        balance_currency TEXT NOT NULL DEFAULT 'USD',
        balance_refreshed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, plaid_account_id)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_financial_connector_accounts_user_id
      ON financial_connector_accounts (user_id, updated_at DESC);
    `);

    // Add columns that may not exist on older schemas (safe to run repeatedly)
    const newColumns = [
      { name: "subtype", definition: "TEXT" },
      { name: "official_name", definition: "TEXT" },
      { name: "balance_available", definition: "NUMERIC(14, 2)" },
      { name: "balance_current", definition: "NUMERIC(14, 2)" },
      { name: "balance_limit", definition: "NUMERIC(14, 2)" },
      { name: "balance_currency", definition: "TEXT NOT NULL DEFAULT 'USD'" },
      { name: "balance_refreshed_at", definition: "TIMESTAMPTZ" },
    ];
    for (const col of newColumns) {
      await query(`
        ALTER TABLE financial_connector_accounts
        ADD COLUMN IF NOT EXISTS ${col.name} ${col.definition};
      `).catch(() => { /* column may already exist */ });
    }

    // Add item status columns for relink/error tracking
    const itemStatusColumns = [
      { name: "status", definition: "TEXT NOT NULL DEFAULT 'good'" },
      { name: "error_code", definition: "TEXT" },
      { name: "consent_expiration_time", definition: "TIMESTAMPTZ" },
    ];
    for (const col of itemStatusColumns) {
      await query(`
        ALTER TABLE financial_connector_items
        ADD COLUMN IF NOT EXISTS ${col.name} ${col.definition};
      `).catch(() => { /* column may already exist */ });
    }
  })();

  return globalThis.__financialConnectorsSchemaInitPromise;
}

export async function upsertConnectedItem(input: UpsertItemInput): Promise<void> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  await ensureFinancialConnectorSchema();

  const encrypted = encryptData({
    access_token: input.plaidAccessToken,
  });

  const upsertedItem = await query<{ id: string }>(
    `
      INSERT INTO financial_connector_items (
        id,
        user_id,
        plaid_item_id,
        access_token_encrypted,
        access_token_key_version,
        institution_id,
        institution_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, plaid_item_id)
      DO UPDATE SET
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        access_token_key_version = EXCLUDED.access_token_key_version,
        institution_id = EXCLUDED.institution_id,
        institution_name = EXCLUDED.institution_name,
        updated_at = NOW()
      RETURNING id
    `,
    [
      randomUUID(),
      input.userId,
      input.plaidItemId,
      encrypted.encrypted,
      encrypted.keyVersion,
      input.institutionId,
      input.institutionName,
    ],
  );

  const itemId = upsertedItem.rows[0]?.id;
  if (!itemId) {
    throw new Error("Failed to persist connected financial item.");
  }

  for (const account of input.accounts) {
    await query(
      `
        INSERT INTO financial_connector_accounts (
          id,
          user_id,
          item_id,
          plaid_account_id,
          account_type,
          subtype,
          mask,
          nickname,
          official_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id, plaid_account_id)
        DO UPDATE SET
          item_id = EXCLUDED.item_id,
          account_type = EXCLUDED.account_type,
          subtype = EXCLUDED.subtype,
          mask = EXCLUDED.mask,
          nickname = EXCLUDED.nickname,
          official_name = EXCLUDED.official_name,
          updated_at = NOW()
      `,
      [
        randomUUID(),
        input.userId,
        itemId,
        account.plaidAccountId,
        account.accountType,
        account.subtype,
        account.mask,
        account.nickname,
        account.officialName,
      ],
    );
  }

  if (input.accounts.length > 0) {
    const plaidIds = input.accounts.map((account) => account.plaidAccountId);
    await query(
      `
        DELETE FROM financial_connector_accounts
        WHERE user_id = $1
          AND item_id = $2
          AND NOT (plaid_account_id = ANY($3::text[]))
      `,
      [input.userId, itemId, plaidIds],
    );
  }
}

export async function listStoredConnectedAccounts(
  userId: string,
): Promise<ConnectedAccount[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  await ensureFinancialConnectorSchema();

  const result = await query<ConnectedAccountRow>(
    `
      SELECT
        a.id,
        a.user_id,
        i.plaid_item_id,
        i.institution_name,
        a.account_type,
        a.subtype,
        a.mask,
        a.nickname,
        a.official_name,
        a.balance_available::text AS balance_available,
        a.balance_current::text AS balance_current,
        a.balance_limit::text AS balance_limit,
        a.balance_currency,
        a.balance_refreshed_at::text AS balance_refreshed_at,
        i.updated_at::text AS last_synced_at,
        i.status AS item_status,
        i.error_code AS item_error_code
      FROM financial_connector_accounts a
      JOIN financial_connector_items i
        ON i.id = a.item_id
      WHERE a.user_id = $1
      ORDER BY a.updated_at DESC
    `,
    [userId],
  );

  return result.rows.map(rowToConnectedAccount);
}

export async function listStoredConnectedInstitutions(
  userId: string,
): Promise<ConnectedInstitution[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  await ensureFinancialConnectorSchema();

  const result = await query<InstitutionSummaryRow>(
    `
      SELECT
        i.institution_name,
        COUNT(a.id)::text AS account_count
      FROM financial_connector_items i
      JOIN financial_connector_accounts a
        ON a.item_id = i.id
      WHERE i.user_id = $1
      GROUP BY i.institution_name
      ORDER BY i.institution_name ASC
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    institution_name: row.institution_name,
    account_count: Number.parseInt(row.account_count, 10) || 0,
  }));
}

export async function listConnectorItemSecretsForUser(
  userId: string,
): Promise<ConnectorItemSecret[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  await ensureFinancialConnectorSchema();

  const result = await query<ConnectorItemSecretRow>(
    `
      SELECT
        user_id,
        plaid_item_id,
        access_token_encrypted,
        access_token_key_version
      FROM financial_connector_items
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    user_id: row.user_id,
    plaid_item_id: row.plaid_item_id,
    plaid_access_token: decodeStoredAccessToken(
      row.access_token_encrypted,
      row.access_token_key_version,
    ),
  }));
}

export async function listConnectorItemSecretsByPlaidItemId(
  plaidItemId: string,
): Promise<ConnectorItemSecret[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  await ensureFinancialConnectorSchema();

  const result = await query<ConnectorItemSecretRow>(
    `
      SELECT
        user_id,
        plaid_item_id,
        access_token_encrypted,
        access_token_key_version
      FROM financial_connector_items
      WHERE plaid_item_id = $1
      ORDER BY updated_at DESC
    `,
    [plaidItemId],
  );

  return result.rows.map((row) => ({
    user_id: row.user_id,
    plaid_item_id: row.plaid_item_id,
    plaid_access_token: decodeStoredAccessToken(
      row.access_token_encrypted,
      row.access_token_key_version,
    ),
  }));
}

export async function listLinkedAccountBindingsForUser(
  userId: string,
): Promise<LinkedAccountBinding[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  await ensureFinancialConnectorSchema();

  const result = await query<LinkedAccountBindingRow>(
    `
      SELECT id, plaid_account_id
      FROM financial_connector_accounts
      WHERE user_id = $1
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    plaid_account_id: row.plaid_account_id,
  }));
}

export interface BalanceUpdate {
  plaidAccountId: string;
  balanceAvailable: number | null;
  balanceCurrent: number | null;
  balanceLimit: number | null;
  balanceCurrency: string;
}

export async function updateAccountBalances(input: {
  userId: string;
  balances: BalanceUpdate[];
}): Promise<number> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  await ensureFinancialConnectorSchema();

  let updated = 0;
  for (const balance of input.balances) {
    const result = await query<{ id: string }>(
      `
        UPDATE financial_connector_accounts
        SET
          balance_available = $1,
          balance_current = $2,
          balance_limit = $3,
          balance_currency = $4,
          balance_refreshed_at = NOW(),
          updated_at = NOW()
        WHERE user_id = $5
          AND plaid_account_id = $6
        RETURNING id
      `,
      [
        balance.balanceAvailable,
        balance.balanceCurrent,
        balance.balanceLimit,
        balance.balanceCurrency,
        input.userId,
        balance.plaidAccountId,
      ],
    );
    updated += result.rows.length;
  }
  return updated;
}

export async function updateItemStatus(input: {
  userId: string;
  plaidItemId: string;
  status: "good" | "error" | "relink_required";
  errorCode?: string | null;
}): Promise<void> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  await ensureFinancialConnectorSchema();

  await query(
    `
      UPDATE financial_connector_items
      SET
        status = $1,
        error_code = $2,
        updated_at = NOW()
      WHERE user_id = $3
        AND plaid_item_id = $4
    `,
    [input.status, input.errorCode ?? null, input.userId, input.plaidItemId],
  );
}

export async function removeStoredConnectedAccount(input: {
  userId: string;
  accountId: string;
}): Promise<{
  removed: boolean;
  removedItem: boolean;
  transactionsRemoved: number;
}> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");
  await ensureFinancialConnectorSchema();

  const owned = await query<AccountOwnershipRow>(
    `
      SELECT id, user_id, item_id, plaid_account_id
      FROM financial_connector_accounts
      WHERE user_id = $1
        AND id = $2
      LIMIT 1
    `,
    [input.userId, input.accountId],
  );

  const account = owned.rows[0];
  if (!account) {
    return {
      removed: false,
      removedItem: false,
      transactionsRemoved: 0,
    };
  }

  // Clean up transactions associated with this account
  const txRemoval = await query<{ id: string }>(
    `
      DELETE FROM transactions
      WHERE user_id = $1
        AND linked_account_id = $2
      RETURNING id
    `,
    [input.userId, input.accountId],
  );
  const transactionsRemoved = txRemoval.rows.length;

  await query(
    `
      DELETE FROM financial_connector_accounts
      WHERE user_id = $1
        AND id = $2
    `,
    [input.userId, input.accountId],
  );

  const remaining = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM financial_connector_accounts
      WHERE user_id = $1
        AND item_id = $2
    `,
    [input.userId, account.item_id],
  );

  const remainingCount = Number.parseInt(remaining.rows[0]?.count || "0", 10) || 0;
  if (remainingCount > 0) {
    return {
      removed: true,
      removedItem: false,
      transactionsRemoved,
    };
  }

  // Also clean up sync cursors for the removed item
  await query(
    `
      DELETE FROM transaction_sync_cursors
      WHERE user_id = $1
        AND plaid_item_id = (
          SELECT plaid_item_id FROM financial_connector_items
          WHERE user_id = $1 AND id = $2
        )
    `,
    [input.userId, account.item_id],
  ).catch(() => { /* cursor may already be gone */ });

  await query(
    `
      DELETE FROM financial_connector_items
      WHERE user_id = $1
        AND id = $2
    `,
    [input.userId, account.item_id],
  );

  return {
    removed: true,
    removedItem: true,
    transactionsRemoved,
  };
}
