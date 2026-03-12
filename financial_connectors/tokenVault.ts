import "server-only";

import { randomUUID } from "node:crypto";
import { query } from "@/lib/server/db";
import { decryptVaultValue } from "@/lib/server/vaultCrypto";
import { decryptData, encryptData } from "@/security/encryption";
import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";

assertNoAiFinancialConnectorAccess("/financial_connectors/tokenVault.ts");

export type ConnectedAccountType = "credit" | "checking" | "savings";

export interface ConnectedAccount {
  id: string;
  user_id: string;
  institution_name: string;
  account_type: ConnectedAccountType;
  mask: string;
  nickname: string;
}

interface ConnectedAccountRow {
  id: string;
  user_id: string;
  institution_name: string;
  account_type: ConnectedAccountType;
  mask: string;
  nickname: string;
}

interface StoredAccountInput {
  plaidAccountId: string;
  accountType: ConnectedAccountType;
  mask: string;
  nickname: string;
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
  return {
    id: row.id,
    user_id: row.user_id,
    institution_name: row.institution_name,
    account_type: row.account_type,
    mask: row.mask,
    nickname: row.nickname,
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
        account_type TEXT NOT NULL CHECK (account_type IN ('credit', 'checking', 'savings')),
        mask TEXT NOT NULL,
        nickname TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, plaid_account_id)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_financial_connector_accounts_user_id
      ON financial_connector_accounts (user_id, updated_at DESC);
    `);
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
          mask,
          nickname
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, plaid_account_id)
        DO UPDATE SET
          item_id = EXCLUDED.item_id,
          account_type = EXCLUDED.account_type,
          mask = EXCLUDED.mask,
          nickname = EXCLUDED.nickname,
          updated_at = NOW()
      `,
      [
        randomUUID(),
        input.userId,
        itemId,
        account.plaidAccountId,
        account.accountType,
        account.mask,
        account.nickname,
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
        i.institution_name,
        a.account_type,
        a.mask,
        a.nickname
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
