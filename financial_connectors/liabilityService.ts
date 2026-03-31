import "server-only";

import { randomUUID } from "node:crypto";
import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";
import { getPlaidClient } from "@/financial_connectors/plaidClient";
import { listConnectorItemSecretsForUser } from "@/financial_connectors/tokenVault";
import { query } from "@/lib/server/db";
import { logServerEvent } from "@/lib/server/observability";

assertNoAiFinancialConnectorAccess("/financial_connectors/liabilityService.ts");

// ── Types ─────────────────────────────────────────────────────────────

export interface StoredLiabilityDetail {
  id: string;
  user_id: string;
  plaid_account_id: string;
  liability_type: "credit" | "mortgage" | "student";
  interest_rate: number | null;
  interest_rate_type: string | null;
  minimum_payment: number | null;
  next_payment_due_date: string | null;
  last_payment_amount: number | null;
  last_payment_date: string | null;
  last_statement_balance: number | null;
  is_overdue: boolean | null;
  origination_date: string | null;
  origination_principal: number | null;
  loan_term: string | null;
  maturity_date: string | null;
  extra_data: Record<string, unknown>;
  updated_at: string;
}

export interface LiabilitySyncResult {
  user_id: string;
  plaid_item_id: string;
  liabilities_synced: number;
  status: "completed" | "failed" | "skipped";
  error_message?: string;
}

// ── Schema ────────────────────────────────────────────────────────────

declare global {
  var __liabilitySchemaInitPromise: Promise<void> | undefined;
}

async function ensureLiabilitySchema(): Promise<void> {
  if (globalThis.__liabilitySchemaInitPromise) {
    return globalThis.__liabilitySchemaInitPromise;
  }

  globalThis.__liabilitySchemaInitPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS liability_details (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        plaid_account_id TEXT NOT NULL,
        liability_type TEXT NOT NULL CHECK (liability_type IN ('credit', 'mortgage', 'student')),
        interest_rate NUMERIC(8, 4),
        interest_rate_type TEXT,
        minimum_payment NUMERIC(14, 2),
        next_payment_due_date TEXT,
        last_payment_amount NUMERIC(14, 2),
        last_payment_date TEXT,
        last_statement_balance NUMERIC(14, 2),
        is_overdue BOOLEAN,
        origination_date TEXT,
        origination_principal NUMERIC(14, 2),
        loan_term TEXT,
        maturity_date TEXT,
        extra_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, plaid_account_id, liability_type)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_liability_details_user_id
      ON liability_details (user_id, updated_at DESC);
    `);
  })();

  return globalThis.__liabilitySchemaInitPromise;
}

// ── Upsert ────────────────────────────────────────────────────────────

interface LiabilityUpsertInput {
  userId: string;
  plaidAccountId: string;
  liabilityType: "credit" | "mortgage" | "student";
  interestRate: number | null;
  interestRateType: string | null;
  minimumPayment: number | null;
  nextPaymentDueDate: string | null;
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;
  lastStatementBalance: number | null;
  isOverdue: boolean | null;
  originationDate: string | null;
  originationPrincipal: number | null;
  loanTerm: string | null;
  maturityDate: string | null;
  extraData: Record<string, unknown>;
}

async function upsertLiabilityDetail(input: LiabilityUpsertInput): Promise<void> {
  await query(
    `INSERT INTO liability_details (
      id, user_id, plaid_account_id, liability_type,
      interest_rate, interest_rate_type, minimum_payment,
      next_payment_due_date, last_payment_amount, last_payment_date,
      last_statement_balance, is_overdue, origination_date,
      origination_principal, loan_term, maturity_date, extra_data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (user_id, plaid_account_id, liability_type)
    DO UPDATE SET
      interest_rate = EXCLUDED.interest_rate,
      interest_rate_type = EXCLUDED.interest_rate_type,
      minimum_payment = EXCLUDED.minimum_payment,
      next_payment_due_date = EXCLUDED.next_payment_due_date,
      last_payment_amount = EXCLUDED.last_payment_amount,
      last_payment_date = EXCLUDED.last_payment_date,
      last_statement_balance = EXCLUDED.last_statement_balance,
      is_overdue = EXCLUDED.is_overdue,
      origination_date = EXCLUDED.origination_date,
      origination_principal = EXCLUDED.origination_principal,
      loan_term = EXCLUDED.loan_term,
      maturity_date = EXCLUDED.maturity_date,
      extra_data = EXCLUDED.extra_data,
      updated_at = NOW()`,
    [
      randomUUID(),
      input.userId,
      input.plaidAccountId,
      input.liabilityType,
      input.interestRate,
      input.interestRateType,
      input.minimumPayment,
      input.nextPaymentDueDate,
      input.lastPaymentAmount,
      input.lastPaymentDate,
      input.lastStatementBalance,
      input.isOverdue,
      input.originationDate,
      input.originationPrincipal,
      input.loanTerm,
      input.maturityDate,
      JSON.stringify(input.extraData),
    ],
  );
}

// ── Sync ──────────────────────────────────────────────────────────────

async function syncLiabilitiesForItem(input: {
  userId: string;
  plaidItemId: string;
  accessToken: string;
}): Promise<LiabilitySyncResult> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/liabilityService.ts");
  await ensureLiabilitySchema();
  const plaid = getPlaidClient();

  try {
    const response = await plaid.getLiabilities(input.accessToken);
    let synced = 0;

    // Credit card liabilities
    for (const credit of response.liabilities.credit ?? []) {
      const primaryApr = credit.aprs?.[0];
      await upsertLiabilityDetail({
        userId: input.userId,
        plaidAccountId: credit.account_id,
        liabilityType: "credit",
        interestRate: primaryApr?.apr_percentage ?? null,
        interestRateType: primaryApr?.apr_type ?? null,
        minimumPayment: credit.minimum_payment_amount,
        nextPaymentDueDate: credit.next_payment_due_date,
        lastPaymentAmount: credit.last_payment_amount,
        lastPaymentDate: credit.last_payment_date,
        lastStatementBalance: credit.last_statement_balance,
        isOverdue: credit.is_overdue,
        originationDate: null,
        originationPrincipal: null,
        loanTerm: null,
        maturityDate: null,
        extraData: { aprs: credit.aprs },
      });
      synced += 1;
    }

    // Mortgage liabilities
    for (const mortgage of response.liabilities.mortgage ?? []) {
      await upsertLiabilityDetail({
        userId: input.userId,
        plaidAccountId: mortgage.account_id,
        liabilityType: "mortgage",
        interestRate: mortgage.interest_rate?.percentage ?? null,
        interestRateType: mortgage.interest_rate?.type ?? null,
        minimumPayment: mortgage.next_monthly_payment,
        nextPaymentDueDate: mortgage.next_payment_due_date,
        lastPaymentAmount: mortgage.last_payment_amount,
        lastPaymentDate: mortgage.last_payment_date,
        lastStatementBalance: null,
        isOverdue: (mortgage.past_due_amount ?? 0) > 0 ? true : null,
        originationDate: mortgage.origination_date,
        originationPrincipal: mortgage.origination_principal_amount,
        loanTerm: mortgage.loan_term,
        maturityDate: mortgage.maturity_date,
        extraData: {
          escrow_balance: mortgage.escrow_balance,
          has_pmi: mortgage.has_pmi,
          ytd_interest_paid: mortgage.ytd_interest_paid,
          ytd_principal_paid: mortgage.ytd_principal_paid,
        },
      });
      synced += 1;
    }

    // Student loan liabilities
    for (const student of response.liabilities.student ?? []) {
      await upsertLiabilityDetail({
        userId: input.userId,
        plaidAccountId: student.account_id,
        liabilityType: "student",
        interestRate: student.interest_rate_percentage,
        interestRateType: null,
        minimumPayment: student.minimum_payment_amount,
        nextPaymentDueDate: student.next_payment_due_date,
        lastPaymentAmount: student.last_payment_amount,
        lastPaymentDate: student.last_payment_date,
        lastStatementBalance: null,
        isOverdue: student.is_overdue,
        originationDate: student.origination_date,
        originationPrincipal: student.origination_principal_amount,
        loanTerm: null,
        maturityDate: student.expected_payoff_date,
        extraData: {
          loan_name: student.loan_name,
          loan_status: student.loan_status,
          repayment_plan: student.repayment_plan,
          outstanding_interest: student.outstanding_interest_amount,
        },
      });
      synced += 1;
    }

    logServerEvent("info", "connect.liabilities.sync.success", {
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      liabilitiesSynced: synced,
      requestId: response.requestId,
    });

    return {
      user_id: input.userId,
      plaid_item_id: input.plaidItemId,
      liabilities_synced: synced,
      status: "completed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Liability sync failed";
    const errorCode = (error as { errorCode?: string })?.errorCode;

    if (errorCode === "PRODUCTS_NOT_SUPPORTED" || errorCode === "PRODUCTS_NOT_READY"
        || errorCode === "NO_LIABILITY_ACCOUNTS") {
      logServerEvent("info", "connect.liabilities.sync.skipped", {
        userId: input.userId,
        plaidItemId: input.plaidItemId,
        errorCode,
      });
      return {
        user_id: input.userId,
        plaid_item_id: input.plaidItemId,
        liabilities_synced: 0,
        status: "skipped",
        error_message: errorCode,
      };
    }

    logServerEvent("error", "connect.liabilities.sync.failed", {
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      message,
    });

    return {
      user_id: input.userId,
      plaid_item_id: input.plaidItemId,
      liabilities_synced: 0,
      status: "failed",
      error_message: message,
    };
  }
}

export async function syncLiabilitiesForUser(
  userId: string,
): Promise<LiabilitySyncResult[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/liabilityService.ts");
  await ensureLiabilitySchema();

  const itemSecrets = await listConnectorItemSecretsForUser(userId);
  const results: LiabilitySyncResult[] = [];

  for (const item of itemSecrets) {
    const result = await syncLiabilitiesForItem({
      userId: item.user_id,
      plaidItemId: item.plaid_item_id,
      accessToken: item.plaid_access_token,
    });
    results.push(result);
  }

  return results;
}

// ── Read ──────────────────────────────────────────────────────────────

interface LiabilityRow {
  id: string;
  user_id: string;
  plaid_account_id: string;
  liability_type: string;
  interest_rate: string | null;
  interest_rate_type: string | null;
  minimum_payment: string | null;
  next_payment_due_date: string | null;
  last_payment_amount: string | null;
  last_payment_date: string | null;
  last_statement_balance: string | null;
  is_overdue: boolean | null;
  origination_date: string | null;
  origination_principal: string | null;
  loan_term: string | null;
  maturity_date: string | null;
  extra_data: string;
  updated_at: string;
}

export async function listLiabilityDetails(
  userId: string,
): Promise<StoredLiabilityDetail[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/liabilityService.ts");
  await ensureLiabilitySchema();

  const result = await query<LiabilityRow>(
    `SELECT
      id, user_id, plaid_account_id, liability_type,
      interest_rate::text, interest_rate_type,
      minimum_payment::text, next_payment_due_date,
      last_payment_amount::text, last_payment_date,
      last_statement_balance::text, is_overdue,
      origination_date, origination_principal::text,
      loan_term, maturity_date,
      extra_data::text, updated_at::text
    FROM liability_details
    WHERE user_id = $1
    ORDER BY updated_at DESC`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    plaid_account_id: row.plaid_account_id,
    liability_type: row.liability_type as StoredLiabilityDetail["liability_type"],
    interest_rate: row.interest_rate != null ? Number(row.interest_rate) : null,
    interest_rate_type: row.interest_rate_type,
    minimum_payment: row.minimum_payment != null ? Number(row.minimum_payment) : null,
    next_payment_due_date: row.next_payment_due_date,
    last_payment_amount: row.last_payment_amount != null ? Number(row.last_payment_amount) : null,
    last_payment_date: row.last_payment_date,
    last_statement_balance: row.last_statement_balance != null ? Number(row.last_statement_balance) : null,
    is_overdue: row.is_overdue,
    origination_date: row.origination_date,
    origination_principal: row.origination_principal != null ? Number(row.origination_principal) : null,
    loan_term: row.loan_term,
    maturity_date: row.maturity_date,
    extra_data: typeof row.extra_data === "string" ? JSON.parse(row.extra_data) : (row.extra_data || {}),
    updated_at: row.updated_at,
  }));
}
