import "server-only";

import { randomUUID } from "node:crypto";
import { query } from "@/lib/server/db";
import { logServerEvent } from "@/lib/server/observability";

export interface StatementDocumentRow {
  id: string;
  user_id: string;
  item_id: string;
  plaid_account_id: string | null;
  plaid_statement_id: string;
  institution_id: string | null;
  institution_name: string | null;
  account_mask: string | null;
  month: number;
  year: number;
  period_start: string | null;
  period_end: string | null;
  storage_path: string | null;
  checksum: string | null;
  download_status: string;
  parse_status: string;
  reconcile_status: string;
  source_support_status: string;
  error_message: string | null;
  downloaded_at: string | null;
  parsed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractedTransactionInput {
  userId: string;
  itemId: string;
  plaidAccountId: string | null;
  statementDocumentId: string;
  postedDate: string; // YYYY-MM-DD
  descriptionRaw: string;
  descriptionNormalized: string;
  amount: number;
  currency: string;
  direction: "debit" | "credit";
  runningBalance: number | null;
  extractionConfidence: number | null;
  category: string | null;
}

declare global {
  var __statementDocumentsSchemaInitPromise: Promise<void> | undefined;
}

export async function ensureStatementSchema(): Promise<void> {
  if (globalThis.__statementDocumentsSchemaInitPromise) {
    return globalThis.__statementDocumentsSchemaInitPromise;
  }

  globalThis.__statementDocumentsSchemaInitPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS statement_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        plaid_account_id TEXT,
        plaid_statement_id TEXT NOT NULL,
        institution_id TEXT,
        institution_name TEXT,
        account_mask TEXT,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        period_start DATE,
        period_end DATE,
        storage_path TEXT,
        checksum TEXT,
        download_status TEXT NOT NULL DEFAULT 'pending',
        parse_status TEXT NOT NULL DEFAULT 'pending',
        reconcile_status TEXT NOT NULL DEFAULT 'pending',
        source_support_status TEXT NOT NULL DEFAULT 'unknown',
        error_message TEXT,
        downloaded_at TIMESTAMPTZ,
        parsed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, plaid_statement_id)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_statement_documents_user_year_month
      ON statement_documents (user_id, year DESC, month DESC);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_statement_documents_download_status
      ON statement_documents (user_id, download_status);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_statement_documents_parse_status
      ON statement_documents (user_id, parse_status);
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS statement_extracted_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        plaid_account_id TEXT,
        statement_document_id TEXT NOT NULL REFERENCES statement_documents(id) ON DELETE CASCADE,
        posted_date DATE NOT NULL,
        description_raw TEXT NOT NULL,
        description_normalized TEXT NOT NULL,
        amount NUMERIC(14, 2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
        running_balance NUMERIC(14, 2),
        extraction_confidence NUMERIC(4, 3),
        category TEXT,
        matched_live_transaction_id TEXT,
        match_quality TEXT DEFAULT 'no_match',
        visible_in_unified BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_statement_extracted_txns_doc
      ON statement_extracted_transactions (statement_document_id);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_statement_extracted_txns_user
      ON statement_extracted_transactions (user_id, posted_date DESC);
    `);
  })();

  return globalThis.__statementDocumentsSchemaInitPromise;
}

export async function upsertStatementDocument(doc: {
  userId: string;
  itemId: string;
  plaidAccountId: string | null;
  plaidStatementId: string;
  institutionId: string | null;
  institutionName: string | null;
  accountMask: string | null;
  month: number;
  year: number;
}): Promise<{ id: string; isNew: boolean }> {
  await ensureStatementSchema();

  const id = randomUUID();
  const result = await query<{ id: string; is_new: boolean }>(
    `
      INSERT INTO statement_documents (
        id, user_id, item_id, plaid_account_id, plaid_statement_id,
        institution_id, institution_name, account_mask, month, year
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id, plaid_statement_id)
      DO UPDATE SET
        item_id = EXCLUDED.item_id,
        plaid_account_id = EXCLUDED.plaid_account_id,
        institution_id = EXCLUDED.institution_id,
        institution_name = EXCLUDED.institution_name,
        account_mask = EXCLUDED.account_mask,
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS is_new
    `,
    [
      id,
      doc.userId,
      doc.itemId,
      doc.plaidAccountId,
      doc.plaidStatementId,
      doc.institutionId,
      doc.institutionName,
      doc.accountMask,
      doc.month,
      doc.year,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to upsert statement document.");
  }

  logServerEvent("info", "statements.document.upserted", {
    docId: row.id,
    isNew: row.is_new,
    userId: doc.userId,
    plaidStatementId: doc.plaidStatementId,
    year: doc.year,
    month: doc.month,
  });

  return { id: row.id, isNew: row.is_new };
}

export async function listPendingDownloads(userId: string): Promise<StatementDocumentRow[]> {
  await ensureStatementSchema();

  const result = await query<StatementDocumentRow>(
    `
      SELECT *
      FROM statement_documents
      WHERE user_id = $1
        AND download_status = 'pending'
      ORDER BY year DESC, month DESC
    `,
    [userId],
  );

  return result.rows;
}

export async function listPendingParses(userId: string): Promise<StatementDocumentRow[]> {
  await ensureStatementSchema();

  const result = await query<StatementDocumentRow>(
    `
      SELECT *
      FROM statement_documents
      WHERE user_id = $1
        AND download_status = 'downloaded'
        AND parse_status = 'pending'
      ORDER BY year DESC, month DESC
    `,
    [userId],
  );

  return result.rows;
}

export async function markDownloaded(
  docId: string,
  storagePath: string,
  checksum: string | null,
): Promise<void> {
  await ensureStatementSchema();

  await query(
    `
      UPDATE statement_documents
      SET
        download_status = 'downloaded',
        storage_path = $1,
        checksum = $2,
        downloaded_at = NOW(),
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $3
    `,
    [storagePath, checksum, docId],
  );

  logServerEvent("info", "statements.document.downloaded", {
    docId,
    storagePath,
  });
}

export async function markDownloadFailed(docId: string, error: string): Promise<void> {
  await ensureStatementSchema();

  await query(
    `
      UPDATE statement_documents
      SET
        download_status = 'failed',
        error_message = $1,
        updated_at = NOW()
      WHERE id = $2
    `,
    [error, docId],
  );

  logServerEvent("warn", "statements.document.download_failed", {
    docId,
    error,
  });
}

export async function markParsed(
  docId: string,
  periodStart: string | null,
  periodEnd: string | null,
): Promise<void> {
  await ensureStatementSchema();

  await query(
    `
      UPDATE statement_documents
      SET
        parse_status = 'parsed',
        period_start = $1,
        period_end = $2,
        parsed_at = NOW(),
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $3
    `,
    [periodStart, periodEnd, docId],
  );

  logServerEvent("info", "statements.document.parsed", {
    docId,
    periodStart,
    periodEnd,
  });
}

export async function markParseFailed(docId: string, error: string): Promise<void> {
  await ensureStatementSchema();

  await query(
    `
      UPDATE statement_documents
      SET
        parse_status = 'failed',
        error_message = $1,
        updated_at = NOW()
      WHERE id = $2
    `,
    [error, docId],
  );

  logServerEvent("warn", "statements.document.parse_failed", {
    docId,
    error,
  });
}

export async function insertExtractedTransactions(
  rows: ExtractedTransactionInput[],
): Promise<number> {
  await ensureStatementSchema();
  if (rows.length === 0) return 0;

  const CHUNK_SIZE = 50;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j];
      const offset = j * 13;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`,
      );
      values.push(
        randomUUID(),
        row.userId,
        row.itemId,
        row.plaidAccountId,
        row.statementDocumentId,
        row.postedDate,
        row.descriptionRaw,
        row.descriptionNormalized,
        row.amount,
        row.currency,
        row.direction,
        row.runningBalance,
        row.extractionConfidence,
      );
    }

    await query(
      `INSERT INTO statement_extracted_transactions (
        id, user_id, item_id, plaid_account_id, statement_document_id,
        posted_date, description_raw, description_normalized, amount, currency,
        direction, running_balance, extraction_confidence
      ) VALUES ${placeholders.join(", ")}
      ON CONFLICT DO NOTHING`,
      values,
    );

    inserted += chunk.length;
  }

  logServerEvent("info", "statements.extracted_transactions.inserted", {
    count: inserted,
  });

  return inserted;
}

export async function getStatementDocumentByMonth(
  userId: string,
  year: number,
  month: number,
): Promise<StatementDocumentRow | null> {
  await ensureStatementSchema();

  const result = await query<StatementDocumentRow>(
    `
      SELECT *
      FROM statement_documents
      WHERE user_id = $1
        AND year = $2
        AND month = $3
      LIMIT 1
    `,
    [userId, year, month],
  );

  return result.rows[0] || null;
}

export async function listStatementDocuments(userId: string): Promise<StatementDocumentRow[]> {
  await ensureStatementSchema();

  const result = await query<StatementDocumentRow>(
    `
      SELECT *
      FROM statement_documents
      WHERE user_id = $1
      ORDER BY year DESC, month DESC
    `,
    [userId],
  );

  return result.rows;
}

export async function updateReconcileStatus(
  docId: string,
  status: "reconciled" | "partially_reconciled" | "failed",
): Promise<void> {
  await ensureStatementSchema();

  await query(
    `
      UPDATE statement_documents
      SET
        reconcile_status = $1,
        updated_at = NOW()
      WHERE id = $2
    `,
    [status, docId],
  );

  logServerEvent("info", "statements.document.reconcile_updated", {
    docId,
    status,
  });
}

export async function updateExtractedTransactionMatch(
  extractedTxnId: string,
  matchedLiveId: string | null,
  matchQuality: "exact_match" | "likely_match" | "no_match" | "ambiguous",
  visibleInUnified: boolean,
): Promise<void> {
  await ensureStatementSchema();

  await query(
    `
      UPDATE statement_extracted_transactions
      SET
        matched_live_transaction_id = $1,
        match_quality = $2,
        visible_in_unified = $3,
        updated_at = NOW()
      WHERE id = $4
    `,
    [matchedLiveId, matchQuality, visibleInUnified, extractedTxnId],
  );
}
