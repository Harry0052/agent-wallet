import "server-only";

import { query } from "@/lib/server/db";
import { ensureFinancialConnectorSchema } from "@/financial_connectors/tokenVault";
import { ensureTransactionSchema, type StatementTransaction } from "@/transactions/transactionRepository";
import {
  offsetFromPagination,
  paginationMeta,
  type StatementFilters,
  type StatementPagination,
  type StatementPaginationMeta,
} from "@/statements/statementService";

interface AccountRow {
  id: string;
  nickname: string;
}

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

interface CountRow {
  total: string;
}

export interface AccountStatementResult {
  account_id: string;
  account_name: string;
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

function buildTransactionFiltersSql(input: {
  userId: string;
  accountId: string;
  filters: StatementFilters;
}): { whereSql: string; params: unknown[] } {
  const clauses: string[] = ["t.user_id = $1", "t.linked_account_id = $2"];
  const params: unknown[] = [input.userId, input.accountId];
  let index = params.length + 1;

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

async function resolveAccount(input: {
  userId: string;
  accountId: string;
}): Promise<AccountRow | null> {
  const result = await query<AccountRow>(
    `
      SELECT id, nickname
      FROM financial_connector_accounts
      WHERE user_id = $1
        AND id = $2
      LIMIT 1
    `,
    [input.userId, input.accountId],
  );

  return result.rows[0] || null;
}

export async function getAccountStatement(input: {
  userId: string;
  accountId: string;
  filters: StatementFilters;
  pagination: StatementPagination;
}): Promise<AccountStatementResult> {
  await ensureFinancialConnectorSchema();
  await ensureTransactionSchema();

  const account = await resolveAccount({
    userId: input.userId,
    accountId: input.accountId,
  });

  if (!account) {
    throw new Error("Linked account not found.");
  }

  const filtered = buildTransactionFiltersSql({
    userId: input.userId,
    accountId: input.accountId,
    filters: input.filters,
  });
  const limit = input.pagination.page_size;
  const offset = offsetFromPagination(input.pagination);

  const countQuery = await query<CountRow>(
    `
      SELECT COUNT(*)::text AS total
      FROM transactions t
      WHERE ${filtered.whereSql}
    `,
    filtered.params,
  );
  const total = Number.parseInt(countQuery.rows[0]?.total || "0", 10) || 0;

  const transactionQuery = await query<TransactionRow>(
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
        t.category
      FROM transactions t
      WHERE ${filtered.whereSql}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT $${filtered.params.length + 1}
      OFFSET $${filtered.params.length + 2}
    `,
    [...filtered.params, limit, offset],
  );

  return {
    account_id: account.id,
    account_name: account.nickname,
    transactions: transactionQuery.rows.map(rowToTransaction),
    pagination: paginationMeta({
      page: input.pagination.page,
      pageSize: input.pagination.page_size,
      total,
    }),
  };
}
