import "server-only";

import { query } from "@/lib/server/db";
import { ensureTransactionSchema, type StatementTransaction } from "@/transactions/transactionRepository";
import {
  offsetFromPagination,
  paginationMeta,
  type StatementFilters,
  type StatementPagination,
  type StatementPaginationMeta,
} from "@/statements/statementService";

interface TransactionRow {
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
}

interface SpendRow {
  total: string | null;
}

export interface UnifiedStatementResult {
  user_id: string;
  total_spend_month: number;
  transactions: StatementTransaction[];
  pagination: StatementPaginationMeta;
}

function rowToTransaction(row: TransactionRow): StatementTransaction {
  return {
    id: row.id,
    user_id: row.user_id,
    linked_account_id: row.linked_account_id,
    merchant_name: row.merchant_name,
    normalized_merchant: row.normalized_merchant,
    amount: Number(row.amount),
    currency: row.currency,
    category: row.category,
    pending: row.pending,
    occurred_at: row.occurred_at,
  };
}

function buildUnifiedFiltersSql(input: {
  userId: string;
  filters: StatementFilters;
}): { whereSql: string; params: unknown[] } {
  const clauses: string[] = ["t.user_id = $1"];
  const params: unknown[] = [input.userId];
  let index = 2;

  if (input.filters.date_from) {
    clauses.push(`t.occurred_at >= $${index}::timestamptz`);
    params.push(input.filters.date_from);
    index += 1;
  }

  if (input.filters.date_to) {
    clauses.push(`t.occurred_at <= $${index}::timestamptz`);
    params.push(input.filters.date_to);
    index += 1;
  }

  if (input.filters.merchant) {
    clauses.push(
      `(t.merchant_name ILIKE $${index} OR t.normalized_merchant ILIKE $${index})`,
    );
    params.push(`%${input.filters.merchant}%`);
    index += 1;
  }

  if (input.filters.category) {
    clauses.push(`LOWER(t.category) = $${index}`);
    params.push(input.filters.category.toLowerCase());
    index += 1;
  }

  if (input.filters.pending !== null) {
    clauses.push(`t.pending = $${index}`);
    params.push(input.filters.pending);
  }

  return {
    whereSql: clauses.join(" AND "),
    params,
  };
}

export async function getUnifiedStatement(input: {
  userId: string;
  filters: StatementFilters;
  pagination: StatementPagination;
}): Promise<UnifiedStatementResult> {
  await ensureTransactionSchema();

  const filtered = buildUnifiedFiltersSql({
    userId: input.userId,
    filters: input.filters,
  });
  const limit = input.pagination.page_size;
  const offset = offsetFromPagination(input.pagination);

  // Combined query: COUNT(*) OVER() avoids a separate count round-trip
  const transactionQuery = await query<TransactionRow & { total_count: string }>(
    `
      SELECT
        t.id,
        t.user_id,
        t.linked_account_id,
        t.merchant_name,
        t.normalized_merchant,
        t.amount::text,
        t.currency,
        t.pending,
        t.occurred_at::text,
        t.category,
        COUNT(*) OVER()::text AS total_count
      FROM transactions t
      WHERE ${filtered.whereSql}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT $${filtered.params.length + 1}
      OFFSET $${filtered.params.length + 2}
    `,
    [...filtered.params, limit, offset],
  );

  const total = Number.parseInt(transactionQuery.rows[0]?.total_count || "0", 10) || 0;

  // Monthly spend — run in parallel with nothing (kept separate for clarity + index usage)
  const monthSpendResult = await query<SpendRow>(
    `
      SELECT COALESCE(SUM(amount), 0)::text AS total
      FROM transactions
      WHERE user_id = $1
        AND pending = FALSE
        AND occurred_at >= date_trunc('month', NOW())
        AND occurred_at < (date_trunc('month', NOW()) + INTERVAL '1 month')
    `,
    [input.userId],
  );

  return {
    user_id: input.userId,
    total_spend_month: Number.parseFloat(monthSpendResult.rows[0]?.total || "0") || 0,
    transactions: transactionQuery.rows.map(rowToTransaction),
    pagination: paginationMeta({
      page: input.pagination.page,
      pageSize: input.pagination.page_size,
      total,
    }),
  };
}
