import "server-only";

import { randomUUID } from "node:crypto";
import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";
import { getPlaidClient, type PlaidHolding, type PlaidSecurity } from "@/financial_connectors/plaidClient";
import { listConnectorItemSecretsForUser } from "@/financial_connectors/tokenVault";
import { query } from "@/lib/server/db";
import { logServerEvent } from "@/lib/server/observability";

assertNoAiFinancialConnectorAccess("/financial_connectors/investmentService.ts");

// ── Types ─────────────────────────────────────────────────────────────

export interface StoredSecurity {
  id: string;
  plaid_security_id: string;
  name: string | null;
  ticker_symbol: string | null;
  type: string | null;
  close_price: number | null;
  close_price_as_of: string | null;
  currency: string;
  updated_at: string;
}

export interface StoredHolding {
  id: string;
  user_id: string;
  plaid_account_id: string;
  plaid_security_id: string;
  quantity: number;
  institution_price: number;
  institution_value: number;
  cost_basis: number | null;
  currency: string;
  institution_price_as_of: string | null;
  updated_at: string;
  // Joined from securities table
  security_name?: string | null;
  ticker_symbol?: string | null;
  security_type?: string | null;
}

export interface InvestmentSyncResult {
  user_id: string;
  plaid_item_id: string;
  holdings_synced: number;
  securities_synced: number;
  status: "completed" | "failed" | "skipped";
  error_message?: string;
}

// ── Schema ────────────────────────────────────────────────────────────

declare global {
  var __investmentSchemaInitPromise: Promise<void> | undefined;
}

async function ensureInvestmentSchema(): Promise<void> {
  if (globalThis.__investmentSchemaInitPromise) {
    return globalThis.__investmentSchemaInitPromise;
  }

  globalThis.__investmentSchemaInitPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS investment_securities (
        id TEXT PRIMARY KEY,
        plaid_security_id TEXT NOT NULL UNIQUE,
        name TEXT,
        ticker_symbol TEXT,
        type TEXT,
        close_price NUMERIC(14, 4),
        close_price_as_of TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS investment_holdings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        plaid_account_id TEXT NOT NULL,
        plaid_security_id TEXT NOT NULL,
        quantity NUMERIC(18, 8) NOT NULL DEFAULT 0,
        institution_price NUMERIC(14, 4) NOT NULL DEFAULT 0,
        institution_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
        cost_basis NUMERIC(14, 2),
        currency TEXT NOT NULL DEFAULT 'USD',
        institution_price_as_of TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, plaid_account_id, plaid_security_id)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_investment_holdings_user_id
      ON investment_holdings (user_id, updated_at DESC);
    `);
  })();

  return globalThis.__investmentSchemaInitPromise;
}

// ── Upsert helpers ────────────────────────────────────────────────────

function resolveCurrency(iso: string | null, unofficial: string | null): string {
  return (iso || unofficial || "USD").toUpperCase().slice(0, 3);
}

async function upsertSecurities(securities: PlaidSecurity[]): Promise<number> {
  let count = 0;
  for (const sec of securities) {
    await query(
      `INSERT INTO investment_securities (
        id, plaid_security_id, name, ticker_symbol, type,
        close_price, close_price_as_of, currency
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (plaid_security_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        ticker_symbol = EXCLUDED.ticker_symbol,
        type = EXCLUDED.type,
        close_price = EXCLUDED.close_price,
        close_price_as_of = EXCLUDED.close_price_as_of,
        currency = EXCLUDED.currency,
        updated_at = NOW()`,
      [
        randomUUID(),
        sec.security_id,
        sec.name,
        sec.ticker_symbol,
        sec.type,
        sec.close_price,
        sec.close_price_as_of,
        resolveCurrency(sec.iso_currency_code, sec.unofficial_currency_code),
      ],
    );
    count += 1;
  }
  return count;
}

async function upsertHoldings(
  userId: string,
  holdings: PlaidHolding[],
): Promise<number> {
  let count = 0;
  for (const h of holdings) {
    await query(
      `INSERT INTO investment_holdings (
        id, user_id, plaid_account_id, plaid_security_id,
        quantity, institution_price, institution_value,
        cost_basis, currency, institution_price_as_of
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id, plaid_account_id, plaid_security_id)
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        institution_price = EXCLUDED.institution_price,
        institution_value = EXCLUDED.institution_value,
        cost_basis = EXCLUDED.cost_basis,
        currency = EXCLUDED.currency,
        institution_price_as_of = EXCLUDED.institution_price_as_of,
        updated_at = NOW()`,
      [
        randomUUID(),
        userId,
        h.account_id,
        h.security_id,
        h.quantity,
        h.institution_price,
        h.institution_value,
        h.cost_basis,
        resolveCurrency(h.iso_currency_code, h.unofficial_currency_code),
        h.institution_price_as_of,
      ],
    );
    count += 1;
  }
  return count;
}

// ── Sync ──────────────────────────────────────────────────────────────

async function syncInvestmentsForItem(input: {
  userId: string;
  plaidItemId: string;
  accessToken: string;
}): Promise<InvestmentSyncResult> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/investmentService.ts");
  await ensureInvestmentSchema();
  const plaid = getPlaidClient();

  try {
    const response = await plaid.getInvestmentHoldings(input.accessToken);

    const securitiesSynced = await upsertSecurities(response.securities);
    const holdingsSynced = await upsertHoldings(input.userId, response.holdings);

    logServerEvent("info", "connect.investments.sync.success", {
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      holdingsSynced,
      securitiesSynced,
      requestId: response.requestId,
    });

    return {
      user_id: input.userId,
      plaid_item_id: input.plaidItemId,
      holdings_synced: holdingsSynced,
      securities_synced: securitiesSynced,
      status: "completed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Investment sync failed";
    const errorCode = (error as { errorCode?: string })?.errorCode;

    // PRODUCTS_NOT_SUPPORTED or PRODUCTS_NOT_READY are non-fatal for items
    // that don't have investment accounts
    if (errorCode === "PRODUCTS_NOT_SUPPORTED" || errorCode === "PRODUCTS_NOT_READY"
        || errorCode === "NO_INVESTMENT_ACCOUNTS") {
      logServerEvent("info", "connect.investments.sync.skipped", {
        userId: input.userId,
        plaidItemId: input.plaidItemId,
        errorCode,
      });
      return {
        user_id: input.userId,
        plaid_item_id: input.plaidItemId,
        holdings_synced: 0,
        securities_synced: 0,
        status: "skipped",
        error_message: errorCode,
      };
    }

    logServerEvent("error", "connect.investments.sync.failed", {
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      message,
    });

    return {
      user_id: input.userId,
      plaid_item_id: input.plaidItemId,
      holdings_synced: 0,
      securities_synced: 0,
      status: "failed",
      error_message: message,
    };
  }
}

export async function syncInvestmentsForUser(
  userId: string,
): Promise<InvestmentSyncResult[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/investmentService.ts");
  await ensureInvestmentSchema();

  const itemSecrets = await listConnectorItemSecretsForUser(userId);
  const results: InvestmentSyncResult[] = [];

  for (const item of itemSecrets) {
    const result = await syncInvestmentsForItem({
      userId: item.user_id,
      plaidItemId: item.plaid_item_id,
      accessToken: item.plaid_access_token,
    });
    results.push(result);
  }

  return results;
}

// ── Read ──────────────────────────────────────────────────────────────

interface HoldingRow {
  id: string;
  user_id: string;
  plaid_account_id: string;
  plaid_security_id: string;
  quantity: string;
  institution_price: string;
  institution_value: string;
  cost_basis: string | null;
  currency: string;
  institution_price_as_of: string | null;
  updated_at: string;
  security_name: string | null;
  ticker_symbol: string | null;
  security_type: string | null;
}

export async function listInvestmentHoldings(
  userId: string,
): Promise<StoredHolding[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/investmentService.ts");
  await ensureInvestmentSchema();

  const result = await query<HoldingRow>(
    `SELECT
      h.id,
      h.user_id,
      h.plaid_account_id,
      h.plaid_security_id,
      h.quantity::text,
      h.institution_price::text,
      h.institution_value::text,
      h.cost_basis::text,
      h.currency,
      h.institution_price_as_of,
      h.updated_at::text,
      s.name AS security_name,
      s.ticker_symbol,
      s.type AS security_type
    FROM investment_holdings h
    LEFT JOIN investment_securities s
      ON s.plaid_security_id = h.plaid_security_id
    WHERE h.user_id = $1
    ORDER BY h.institution_value DESC NULLS LAST`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    plaid_account_id: row.plaid_account_id,
    plaid_security_id: row.plaid_security_id,
    quantity: Number(row.quantity),
    institution_price: Number(row.institution_price),
    institution_value: Number(row.institution_value),
    cost_basis: row.cost_basis != null ? Number(row.cost_basis) : null,
    currency: row.currency,
    institution_price_as_of: row.institution_price_as_of,
    updated_at: row.updated_at,
    security_name: row.security_name,
    ticker_symbol: row.ticker_symbol,
    security_type: row.security_type,
  }));
}
