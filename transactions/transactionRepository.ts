import "server-only";

import { randomUUID } from "node:crypto";
import { query } from "@/lib/server/db";
import type { NormalizedTransactionRecord } from "@/transactions/transactionNormalizer";

interface StoredTransactionRow {
  id: string;
  user_id: string;
  linked_account_id: string;
  merchant_name: string;
  normalized_merchant: string;
  amount: string;
  currency: string;
  pending: boolean;
  occurred_at: string;
  category: string;
  category_detailed: string | null;
  pending_transaction_id: string | null;
  payment_channel: string | null;
  authorized_date: string | null;
  original_description: string | null;
  logo_url: string | null;
  merchant_entity_id: string | null;
}

interface SyncCursorRow {
  cursor: string | null;
}

export interface StatementTransaction {
  id: string;
  user_id: string;
  linked_account_id: string;
  merchant_name: string;
  normalized_merchant: string;
  amount: number;
  currency: string;
  category: string;
  category_detailed?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  payment_channel?: string | null;
  authorized_date?: string | null;
  original_description?: string | null;
  logo_url?: string | null;
  merchant_entity_id?: string | null;
  occurred_at: string;
}

declare global {
  var __transactionsSchemaInitPromise: Promise<void> | undefined;
}

function rowToStatementTransaction(row: StoredTransactionRow): StatementTransaction {
  return {
    id: row.id,
    user_id: row.user_id,
    linked_account_id: row.linked_account_id,
    merchant_name: row.merchant_name,
    normalized_merchant: row.normalized_merchant,
    amount: Number(row.amount),
    currency: row.currency,
    category: row.category,
    category_detailed: row.category_detailed ?? null,
    pending: row.pending,
    pending_transaction_id: row.pending_transaction_id ?? null,
    payment_channel: row.payment_channel ?? null,
    authorized_date: row.authorized_date ?? null,
    original_description: row.original_description ?? null,
    logo_url: row.logo_url ?? null,
    merchant_entity_id: row.merchant_entity_id ?? null,
    occurred_at: row.occurred_at,
  };
}

export async function ensureTransactionSchema(): Promise<void> {
  if (globalThis.__transactionsSchemaInitPromise) {
    return globalThis.__transactionsSchemaInitPromise;
  }

  globalThis.__transactionsSchemaInitPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        linked_account_id TEXT NOT NULL,
        provider_transaction_id TEXT NOT NULL,
        merchant_name TEXT NOT NULL,
        normalized_merchant TEXT NOT NULL,
        amount NUMERIC(14, 2) NOT NULL,
        currency TEXT NOT NULL,
        pending BOOLEAN NOT NULL,
        pending_transaction_id TEXT,
        occurred_at TIMESTAMPTZ NOT NULL,
        authorized_date TEXT,
        category TEXT NOT NULL,
        category_detailed TEXT,
        payment_channel TEXT,
        original_description TEXT,
        logo_url TEXT,
        merchant_entity_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, provider_transaction_id)
      );
    `);

    // Add columns that may not exist on older schemas
    const txNewColumns = [
      { name: "pending_transaction_id", definition: "TEXT" },
      { name: "authorized_date", definition: "TEXT" },
      { name: "category_detailed", definition: "TEXT" },
      { name: "payment_channel", definition: "TEXT" },
      { name: "original_description", definition: "TEXT" },
      { name: "logo_url", definition: "TEXT" },
      { name: "merchant_entity_id", definition: "TEXT" },
    ];
    for (const col of txNewColumns) {
      await query(`
        ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS ${col.name} ${col.definition};
      `).catch(() => { /* column may already exist */ });
    }

    await query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_user_occurred_at
      ON transactions (user_id, occurred_at DESC);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_linked_account
      ON transactions (linked_account_id, occurred_at DESC);
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS transaction_sync_cursors (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        plaid_item_id TEXT NOT NULL,
        cursor TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, plaid_item_id)
      );
    `);
  })();

  return globalThis.__transactionsSchemaInitPromise;
}

export async function getSyncCursor(input: {
  userId: string;
  plaidItemId: string;
}): Promise<string | null> {
  await ensureTransactionSchema();

  const result = await query<SyncCursorRow>(
    `
      SELECT cursor
      FROM transaction_sync_cursors
      WHERE user_id = $1
        AND plaid_item_id = $2
      LIMIT 1
    `,
    [input.userId, input.plaidItemId],
  );

  return result.rows[0]?.cursor || null;
}

export async function setSyncCursor(input: {
  userId: string;
  plaidItemId: string;
  cursor: string | null;
}): Promise<void> {
  await ensureTransactionSchema();

  await query(
    `
      INSERT INTO transaction_sync_cursors (
        id,
        user_id,
        plaid_item_id,
        cursor
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, plaid_item_id)
      DO UPDATE SET
        cursor = EXCLUDED.cursor,
        updated_at = NOW()
    `,
    [randomUUID(), input.userId, input.plaidItemId, input.cursor],
  );
}

export async function upsertNormalizedTransactions(
  rows: NormalizedTransactionRecord[],
): Promise<number> {
  await ensureTransactionSchema();
  if (rows.length === 0) return 0;

  for (const row of rows) {
    await query(
      `
        INSERT INTO transactions (
          id,
          user_id,
          linked_account_id,
          provider_transaction_id,
          merchant_name,
          normalized_merchant,
          amount,
          currency,
          pending,
          pending_transaction_id,
          occurred_at,
          authorized_date,
          category,
          category_detailed,
          payment_channel,
          original_description,
          logo_url,
          merchant_entity_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (user_id, provider_transaction_id)
        DO UPDATE SET
          linked_account_id = EXCLUDED.linked_account_id,
          merchant_name = EXCLUDED.merchant_name,
          normalized_merchant = EXCLUDED.normalized_merchant,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          pending = EXCLUDED.pending,
          pending_transaction_id = EXCLUDED.pending_transaction_id,
          occurred_at = EXCLUDED.occurred_at,
          authorized_date = EXCLUDED.authorized_date,
          category = EXCLUDED.category,
          category_detailed = EXCLUDED.category_detailed,
          payment_channel = EXCLUDED.payment_channel,
          original_description = EXCLUDED.original_description,
          logo_url = EXCLUDED.logo_url,
          merchant_entity_id = EXCLUDED.merchant_entity_id,
          updated_at = NOW()
      `,
      [
        randomUUID(),
        row.user_id,
        row.linked_account_id,
        row.provider_transaction_id,
        row.merchant_name,
        row.normalized_merchant,
        row.amount,
        row.currency,
        row.pending,
        row.pending_transaction_id,
        row.occurred_at,
        row.authorized_date,
        row.category,
        row.category_detailed,
        row.payment_channel,
        row.original_description,
        row.logo_url,
        row.merchant_entity_id,
      ],
    );
  }

  return rows.length;
}

export async function removeTransactionsByProviderIds(input: {
  userId: string;
  providerTransactionIds: string[];
}): Promise<number> {
  await ensureTransactionSchema();
  if (input.providerTransactionIds.length === 0) return 0;

  const result = await query<{ id: string }>(
    `
      DELETE FROM transactions
      WHERE user_id = $1
        AND provider_transaction_id = ANY($2::text[])
      RETURNING id
    `,
    [input.userId, input.providerTransactionIds],
  );

  return result.rows.length;
}

export async function removeTransactionsByLinkedAccount(input: {
  userId: string;
  linkedAccountId: string;
}): Promise<number> {
  await ensureTransactionSchema();
  const result = await query<{ id: string }>(
    `
      DELETE FROM transactions
      WHERE user_id = $1
        AND linked_account_id = $2
      RETURNING id
    `,
    [input.userId, input.linkedAccountId],
  );
  return result.rows.length;
}

export async function listNormalizedTransactions(input: {
  userId: string;
  limit?: number;
}): Promise<StatementTransaction[]> {
  await ensureTransactionSchema();
  const limit = Math.max(1, Math.min(input.limit || 100, 500));

  const result = await query<StoredTransactionRow>(
    `
      SELECT
        id,
        user_id,
        linked_account_id,
        merchant_name,
        normalized_merchant,
        amount::text,
        currency,
        pending,
        occurred_at::text,
        category,
        category_detailed,
        pending_transaction_id,
        payment_channel,
        authorized_date,
        original_description,
        logo_url,
        merchant_entity_id
      FROM transactions
      WHERE user_id = $1
      ORDER BY occurred_at DESC
      LIMIT $2
    `,
    [input.userId, limit],
  );

  return result.rows.map(rowToStatementTransaction);
}
