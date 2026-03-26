import "server-only";

import { query } from "@/lib/server/db";
/* ─── Types ──────────────────────────────────────────────────────── */

export interface UnifiedTransaction {
  id: string;
  userId: string;
  accountRef: string | null;
  effectiveDate: string;
  description: string;
  normalizedDescription: string;
  amount: number;
  currency: string;
  category: string | null;
  sourceType: "plaid_live" | "statement_derived";
  sourceRefId: string;
  pending: boolean;
  confidence: number | null;
  merchantLogo: string | null;
}

export interface HistoricalCoverage {
  year: number;
  month: number;
  hasLiveTransactions: boolean;
  hasStatementDocument: boolean;
  hasStatementLineItems: boolean;
  transactionCount: number;
  statementLineItemCount: number;
  sourceCoverageConfidence: number;
}

export interface StatementDocumentInfo {
  documentId: string;
  plaidStatementId: string;
  institutionName: string | null;
  accountMask: string | null;
  storagePath: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  downloadStatus: string;
  parseStatus: string;
}

/* ─── Internal row types ─────────────────────────────────────────── */

interface UnifiedRow {
  id: string;
  user_id: string;
  account_ref: string | null;
  effective_date: string;
  description: string;
  normalized_description: string;
  amount: string;
  currency: string;
  category: string | null;
  source_type: string;
  source_ref_id: string;
  pending: boolean;
  confidence: string | null;
  merchant_logo: string | null;
  total_count: string;
}

interface CoverageRow {
  yr: string;
  mo: string;
  live_count: string;
  stmt_count: string;
  has_document: boolean;
}

interface DocumentRow {
  id: string;
  plaid_statement_id: string;
  institution_name: string | null;
  account_mask: string | null;
  storage_path: string | null;
  period_start: string | null;
  period_end: string | null;
  download_status: string;
  parse_status: string;
}

/* ─── Row mappers ────────────────────────────────────────────────── */

function rowToUnifiedTransaction(row: UnifiedRow): UnifiedTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    accountRef: row.account_ref,
    effectiveDate: row.effective_date,
    description: row.description,
    normalizedDescription: row.normalized_description,
    amount: Number(row.amount),
    currency: row.currency,
    category: row.category,
    sourceType: row.source_type as UnifiedTransaction["sourceType"],
    sourceRefId: row.source_ref_id,
    pending: row.pending,
    confidence: row.confidence !== null ? Number(row.confidence) : null,
    merchantLogo: row.merchant_logo,
  };
}

/* ─── Public API ─────────────────────────────────────────────────── */

/**
 * Get unified transaction history for a month, merging live Plaid
 * transactions with statement-derived historical transactions.
 */
export async function getTransactionsByMonth(
  userId: string,
  year: number,
  month: number,
  options?: { limit?: number; offset?: number; accountId?: string },
): Promise<{ transactions: UnifiedTransaction[]; total: number }> {
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
  const offset = Math.max(0, options?.offset ?? 0);

  // Build date range: first day of month to first day of next month
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  // Optional account filter
  const liveAccountClause = options?.accountId
    ? "AND t.linked_account_id = $3"
    : "";
  const stmtAccountClause = options?.accountId
    ? "AND s.plaid_account_id = $3"
    : "";

  const baseParams: unknown[] = [userId, startDate, endDate];
  if (options?.accountId) {
    // accountId is $3, push endDate to $4
    baseParams.splice(2, 0, options.accountId);
  }

  // Recalculate param indices based on whether accountId is present
  const userParam = "$1";
  const accountIdExists = !!options?.accountId;
  const startParam = accountIdExists ? "$4" : "$2";
  const endParam = accountIdExists ? "$5" : "$3";
  const limitParam = accountIdExists ? "$6" : "$4";
  const offsetParam = accountIdExists ? "$7" : "$5";

  // Rebuild params in correct order
  const queryParams: unknown[] = [userId];
  if (options?.accountId) queryParams.push(options.accountId);
  queryParams.push(startDate, endDate, limit, offset);

  const result = await query<UnifiedRow>(
    `
      SELECT *, COUNT(*) OVER()::text AS total_count FROM (
        -- Live Plaid transactions for the month
        SELECT
          t.id,
          t.user_id,
          t.linked_account_id AS account_ref,
          t.occurred_at::text AS effective_date,
          t.merchant_name AS description,
          t.normalized_merchant AS normalized_description,
          t.amount::text,
          t.currency,
          t.category,
          'plaid_live' AS source_type,
          t.id AS source_ref_id,
          t.pending,
          '1.0' AS confidence,
          t.logo_url AS merchant_logo
        FROM transactions t
        WHERE t.user_id = ${userParam}
          ${liveAccountClause}
          AND t.occurred_at >= ${startParam}::date
          AND t.occurred_at < ${endParam}::date

        UNION ALL

        -- Statement-derived transactions (only visible_in_unified = TRUE)
        SELECT
          s.id,
          s.user_id,
          s.plaid_account_id AS account_ref,
          s.posted_date::text AS effective_date,
          s.description_raw AS description,
          s.description_normalized AS normalized_description,
          s.amount::text,
          s.currency,
          s.category,
          'statement_derived' AS source_type,
          s.id AS source_ref_id,
          FALSE AS pending,
          s.extraction_confidence::text AS confidence,
          NULL AS merchant_logo
        FROM statement_extracted_transactions s
        WHERE s.user_id = ${userParam}
          ${stmtAccountClause}
          AND s.posted_date >= ${startParam}::date
          AND s.posted_date < ${endParam}::date
          AND s.visible_in_unified = TRUE
      ) AS unified
      ORDER BY effective_date DESC, id DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    queryParams,
  );

  const total =
    Number.parseInt(result.rows[0]?.total_count || "0", 10) || 0;

  return {
    transactions: result.rows.map(rowToUnifiedTransaction),
    total,
  };
}

/**
 * Get the historical coverage map showing what data exists for each month.
 * Returns entries from the earliest available data (or startYear/startMonth)
 * through the current month.
 */
export async function getHistoricalCoverageMap(
  userId: string,
  startYear?: number,
  startMonth?: number,
): Promise<HistoricalCoverage[]> {
  // Default: look back 3 years if no start provided
  const now = new Date();
  const effectiveStartYear = startYear ?? now.getFullYear() - 3;
  const effectiveStartMonth = startMonth ?? 1;
  const startDate = `${effectiveStartYear}-${String(effectiveStartMonth).padStart(2, "0")}-01`;

  const result = await query<CoverageRow>(
    `
      WITH months AS (
        SELECT
          EXTRACT(YEAR FROM gs)::int AS yr,
          EXTRACT(MONTH FROM gs)::int AS mo
        FROM generate_series(
          $2::date,
          date_trunc('month', NOW()),
          '1 month'::interval
        ) AS gs
      ),
      live_counts AS (
        SELECT
          EXTRACT(YEAR FROM occurred_at)::int AS yr,
          EXTRACT(MONTH FROM occurred_at)::int AS mo,
          COUNT(*)::text AS cnt
        FROM transactions
        WHERE user_id = $1
          AND occurred_at >= $2::date
        GROUP BY 1, 2
      ),
      stmt_counts AS (
        SELECT
          EXTRACT(YEAR FROM posted_date)::int AS yr,
          EXTRACT(MONTH FROM posted_date)::int AS mo,
          COUNT(*)::text AS cnt
        FROM statement_extracted_transactions
        WHERE user_id = $1
          AND posted_date >= $2::date
          AND visible_in_unified = TRUE
        GROUP BY 1, 2
      ),
      doc_exists AS (
        SELECT DISTINCT year AS yr, month AS mo
        FROM statement_documents
        WHERE user_id = $1
          AND year >= EXTRACT(YEAR FROM $2::date)::int
      )
      SELECT
        m.yr::text,
        m.mo::text,
        COALESCE(lc.cnt, '0') AS live_count,
        COALESCE(sc.cnt, '0') AS stmt_count,
        (de.yr IS NOT NULL) AS has_document
      FROM months m
      LEFT JOIN live_counts lc ON lc.yr = m.yr AND lc.mo = m.mo
      LEFT JOIN stmt_counts sc ON sc.yr = m.yr AND sc.mo = m.mo
      LEFT JOIN doc_exists de ON de.yr = m.yr AND de.mo = m.mo
      ORDER BY m.yr, m.mo
    `,
    [userId, startDate],
  );

  return result.rows.map((row): HistoricalCoverage => {
    const liveCount = Number.parseInt(row.live_count, 10) || 0;
    const stmtCount = Number.parseInt(row.stmt_count, 10) || 0;
    const hasLive = liveCount > 0;
    const hasStmt = stmtCount > 0;
    const hasDoc = row.has_document;

    // Confidence heuristic:
    //   1.0 if both live + statement data exist
    //   0.8 if only live data
    //   0.6 if only statement line items (parsed from PDF)
    //   0.3 if document exists but no line items parsed yet
    //   0.0 if no data at all
    let confidence = 0;
    if (hasLive && hasStmt) confidence = 1.0;
    else if (hasLive) confidence = 0.8;
    else if (hasStmt) confidence = 0.6;
    else if (hasDoc) confidence = 0.3;

    return {
      year: Number.parseInt(row.yr, 10),
      month: Number.parseInt(row.mo, 10),
      hasLiveTransactions: hasLive,
      hasStatementDocument: hasDoc,
      hasStatementLineItems: hasStmt,
      transactionCount: liveCount,
      statementLineItemCount: stmtCount,
      sourceCoverageConfidence: confidence,
    };
  });
}

/**
 * Get statement document metadata for a specific month (for document retrieval).
 */
export async function getStatementDocumentForMonth(
  userId: string,
  year: number,
  month: number,
  accountId?: string,
): Promise<StatementDocumentInfo | null> {
  const accountClause = accountId ? "AND plaid_account_id = $4" : "";
  const params: unknown[] = [userId, year, month];
  if (accountId) params.push(accountId);

  const result = await query<DocumentRow>(
    `
      SELECT
        id,
        plaid_statement_id,
        institution_name,
        account_mask,
        storage_path,
        period_start::text,
        period_end::text,
        download_status,
        parse_status
      FROM statement_documents
      WHERE user_id = $1
        AND year = $2
        AND month = $3
        ${accountClause}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    params,
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    documentId: row.id,
    plaidStatementId: row.plaid_statement_id,
    institutionName: row.institution_name,
    accountMask: row.account_mask,
    storagePath: row.storage_path,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    downloadStatus: row.download_status,
    parseStatus: row.parse_status,
  };
}
