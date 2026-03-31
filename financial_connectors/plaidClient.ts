import "server-only";
import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";
import { getRequiredSecret } from "@/security/secretsManager";

assertNoAiFinancialConnectorAccess("/financial_connectors/plaidClient.ts");

type PlaidEnvironment = "sandbox" | "development" | "production";

interface PlaidConfig {
  clientId: string;
  secret: string;
  env: PlaidEnvironment;
}

interface PlaidApiErrorResponse {
  error_code?: string;
  error_type?: string;
  error_message?: string;
  display_message?: string | null;
  request_id?: string;
}

export class PlaidApiError extends Error {
  readonly errorCode: string;
  readonly errorType: string;
  readonly displayMessage: string | null;
  readonly requestId: string;

  constructor(response: PlaidApiErrorResponse, httpStatus: number) {
    const userMessage = response.display_message
      || response.error_message
      || `Plaid API request failed (${httpStatus}).`;
    super(userMessage);
    this.name = "PlaidApiError";
    this.errorCode = response.error_code || "UNKNOWN";
    this.errorType = response.error_type || "API_ERROR";
    this.displayMessage = response.display_message ?? null;
    this.requestId = response.request_id || "unknown";
  }
}

export interface PlaidAccountBalance {
  available: number | null;
  current: number | null;
  limit: number | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances?: PlaidAccountBalance;
}

interface LinkTokenCreateResponse {
  link_token: string;
  expiration: string;
  request_id: string;
}

interface PublicTokenExchangeResponse {
  access_token: string;
  item_id: string;
  request_id: string;
}

interface AccountsGetResponse {
  accounts: PlaidAccount[];
  item: {
    institution_id: string | null;
  };
  request_id: string;
}

interface InstitutionGetByIdResponse {
  institution: {
    institution_id: string;
    name: string;
  };
  request_id: string;
}

export interface PlaidSyncTransaction {
  transaction_id: string;
  account_id: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  date: string;
  authorized_date: string | null;
  category: string[] | null;
  personal_finance_category?: {
    primary?: string;
    detailed?: string;
  } | null;
  payment_channel?: string | null;
  logo_url?: string | null;
  website?: string | null;
  merchant_entity_id?: string | null;
  location?: {
    city?: string | null;
    region?: string | null;
    country?: string | null;
  } | null;
}

export interface PlaidStatementMetadata {
  statement_id: string;
  account_id: string;
  month: number;
  year: number;
  institution_id: string;
  institution_name: string;
}

// ── Investment types ──────────────────────────────────────────────────

export interface PlaidSecurity {
  security_id: string;
  name: string | null;
  ticker_symbol: string | null;
  type: string | null;
  close_price: number | null;
  close_price_as_of: string | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
}

export interface PlaidHolding {
  account_id: string;
  security_id: string;
  quantity: number;
  institution_price: number;
  institution_price_as_of: string | null;
  institution_value: number;
  cost_basis: number | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
}

interface InvestmentsHoldingsGetResponse {
  accounts: PlaidAccount[];
  holdings: PlaidHolding[];
  securities: PlaidSecurity[];
  request_id: string;
}

// ── Liability types ──────────────────────────────────────────────────

export interface PlaidCreditLiability {
  account_id: string;
  aprs: Array<{
    apr_percentage: number;
    apr_type: string;
    balance_subject_to_apr: number | null;
    interest_charge_amount: number | null;
  }>;
  is_overdue: boolean | null;
  last_payment_amount: number | null;
  last_payment_date: string | null;
  last_statement_balance: number | null;
  last_statement_issue_date: string | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
}

export interface PlaidStudentLoanLiability {
  account_id: string;
  account_number: string | null;
  disbursement_dates: string[] | null;
  expected_payoff_date: string | null;
  interest_rate_percentage: number;
  is_overdue: boolean | null;
  last_payment_amount: number | null;
  last_payment_date: string | null;
  loan_name: string | null;
  loan_status: { type: string | null; end_date: string | null } | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
  origination_date: string | null;
  origination_principal_amount: number | null;
  outstanding_interest_amount: number | null;
  repayment_plan: { type: string | null; description: string | null } | null;
}

export interface PlaidMortgageLiability {
  account_id: string;
  account_number: string | null;
  current_late_fee: number | null;
  escrow_balance: number | null;
  has_pmi: boolean | null;
  interest_rate: { percentage: number | null; type: string | null } | null;
  last_payment_amount: number | null;
  last_payment_date: string | null;
  loan_term: string | null;
  maturity_date: string | null;
  next_monthly_payment: number | null;
  next_payment_due_date: string | null;
  origination_date: string | null;
  origination_principal_amount: number | null;
  past_due_amount: number | null;
  ytd_interest_paid: number | null;
  ytd_principal_paid: number | null;
}

interface LiabilitiesGetResponse {
  accounts: PlaidAccount[];
  liabilities: {
    credit: PlaidCreditLiability[] | null;
    mortgage: PlaidMortgageLiability[] | null;
    student: PlaidStudentLoanLiability[] | null;
  };
  request_id: string;
}

export interface PlaidStatementsListResponse {
  accounts: Array<{
    account_id: string;
    statements: PlaidStatementMetadata[];
  }>;
  institution_id: string;
  institution_name: string;
  item_id: string;
  request_id: string;
}

export interface PlaidStatementsRefreshResponse {
  request_id: string;
}

interface TransactionsSyncResponse {
  added: PlaidSyncTransaction[];
  modified: PlaidSyncTransaction[];
  removed: Array<{
    transaction_id: string;
  }>;
  next_cursor: string;
  has_more: boolean;
  request_id: string;
}

const PLAID_BASE_URLS: Record<PlaidEnvironment, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

function getPlaidConfig(): PlaidConfig {
  const clientId = getRequiredSecret("PLAID_CLIENT_ID");
  const secret = getRequiredSecret("PLAID_SECRET");
  const envRaw = process.env.PLAID_ENV?.trim().toLowerCase();
  if (envRaw !== "production" && envRaw !== "development" && envRaw !== "sandbox") {
    throw new Error(
      `Invalid or missing PLAID_ENV: "${process.env.PLAID_ENV ?? "(unset)"}". Must be "sandbox", "development", or "production".`,
    );
  }
  const env: PlaidEnvironment = envRaw;

  return {
    clientId,
    secret,
    env,
  };
}

function plaidBaseUrl(config: PlaidConfig): string {
  return PLAID_BASE_URLS[config.env];
}

export class PlaidClient {
  private readonly config: PlaidConfig;

  constructor(config?: PlaidConfig) {
    assertNoAiFinancialConnectorAccess("/financial_connectors/plaidClient.ts");
    this.config = config ?? getPlaidConfig();
  }

  async createLinkToken(input: {
    userId: string;
    clientName?: string;
    countryCodes?: string[];
    language?: string;
    products?: string[];
    additionalConsentedProducts?: string[];
    accessToken?: string;
    accountSelectionEnabled?: boolean;
    webhook?: string;
    redirectUri?: string;
  }): Promise<{
    linkToken: string;
    expiration: string;
    requestId: string;
  }> {
    const payload: Record<string, unknown> = {
      user: {
        client_user_id: input.userId,
      },
      client_name: input.clientName ?? "Calico",
      language: input.language ?? "en",
      country_codes: input.countryCodes ?? ["US"],
    };

    // Update mode: pass access_token instead of products
    if (input.accessToken) {
      payload.access_token = input.accessToken;
      if (input.accountSelectionEnabled) {
        payload.update = { account_selection_enabled: true };
      }
    } else {
      payload.products = input.products ?? ["auth", "transactions"];
    }

    if (input.additionalConsentedProducts?.length) {
      payload.additional_consented_products = input.additionalConsentedProducts;
    }
    if (input.webhook) {
      payload.webhook = input.webhook;
    }
    if (input.redirectUri) {
      payload.redirect_uri = input.redirectUri;
    }

    const response = await this.request<LinkTokenCreateResponse>(
      "/link/token/create",
      payload,
    );

    return {
      linkToken: response.link_token,
      expiration: response.expiration,
      requestId: response.request_id,
    };
  }

  async exchangePublicToken(publicToken: string): Promise<{
    accessToken: string;
    itemId: string;
    requestId: string;
  }> {
    const response = await this.request<PublicTokenExchangeResponse>(
      "/item/public_token/exchange",
      { public_token: publicToken },
    );

    return {
      accessToken: response.access_token,
      itemId: response.item_id,
      requestId: response.request_id,
    };
  }

  async getAccounts(accessToken: string): Promise<{
    accounts: PlaidAccount[];
    institutionId: string | null;
    requestId: string;
  }> {
    const response = await this.request<AccountsGetResponse>("/accounts/get", {
      access_token: accessToken,
    });

    return {
      accounts: response.accounts,
      institutionId: response.item.institution_id,
      requestId: response.request_id,
    };
  }

  async getBalances(accessToken: string, options?: {
    accountIds?: string[];
  }): Promise<{
    accounts: PlaidAccount[];
    requestId: string;
  }> {
    const payload: Record<string, unknown> = {
      access_token: accessToken,
    };
    if (options?.accountIds?.length) {
      payload.options = { account_ids: options.accountIds };
    }

    const response = await this.request<AccountsGetResponse>(
      "/accounts/balance/get",
      payload,
    );

    return {
      accounts: response.accounts,
      requestId: response.request_id,
    };
  }

  async getInstitutionById(institutionId: string): Promise<{
    institutionId: string;
    name: string;
    requestId: string;
  }> {
    const response = await this.request<InstitutionGetByIdResponse>(
      "/institutions/get_by_id",
      {
        institution_id: institutionId,
        country_codes: ["US"],
      },
    );

    return {
      institutionId: response.institution.institution_id,
      name: response.institution.name,
      requestId: response.request_id,
    };
  }

  async syncTransactions(input: {
    accessToken: string;
    cursor?: string | null;
    count?: number;
  }): Promise<{
    added: PlaidSyncTransaction[];
    modified: PlaidSyncTransaction[];
    removed: Array<{ transaction_id: string }>;
    nextCursor: string;
    hasMore: boolean;
    requestId: string;
  }> {
    const response = await this.request<TransactionsSyncResponse>(
      "/transactions/sync",
      {
        access_token: input.accessToken,
        cursor: input.cursor ?? undefined,
        count: input.count ?? 100,
      },
    );

    return {
      added: response.added,
      modified: response.modified,
      removed: response.removed,
      nextCursor: response.next_cursor,
      hasMore: response.has_more,
      requestId: response.request_id,
    };
  }

  // ── Item removal ────────────────────────────────────────────────────

  async removeItem(accessToken: string): Promise<{
    requestId: string;
  }> {
    const response = await this.request<{ request_id: string }>(
      "/item/remove",
      { access_token: accessToken },
    );

    return {
      requestId: response.request_id,
    };
  }

  // ── Investments ──────────────────────────────────────────────────────

  async getInvestmentHoldings(accessToken: string, options?: {
    accountIds?: string[];
  }): Promise<{
    accounts: PlaidAccount[];
    holdings: PlaidHolding[];
    securities: PlaidSecurity[];
    requestId: string;
  }> {
    const payload: Record<string, unknown> = {
      access_token: accessToken,
    };
    if (options?.accountIds?.length) {
      payload.options = { account_ids: options.accountIds };
    }

    const response = await this.request<InvestmentsHoldingsGetResponse>(
      "/investments/holdings/get",
      payload,
    );

    return {
      accounts: response.accounts,
      holdings: response.holdings,
      securities: response.securities,
      requestId: response.request_id,
    };
  }

  // ── Liabilities ─────────────────────────────────────────────────────

  async getLiabilities(accessToken: string, options?: {
    accountIds?: string[];
  }): Promise<{
    accounts: PlaidAccount[];
    liabilities: {
      credit: PlaidCreditLiability[] | null;
      mortgage: PlaidMortgageLiability[] | null;
      student: PlaidStudentLoanLiability[] | null;
    };
    requestId: string;
  }> {
    const payload: Record<string, unknown> = {
      access_token: accessToken,
    };
    if (options?.accountIds?.length) {
      payload.options = { account_ids: options.accountIds };
    }

    const response = await this.request<LiabilitiesGetResponse>(
      "/liabilities/get",
      payload,
    );

    return {
      accounts: response.accounts,
      liabilities: response.liabilities,
      requestId: response.request_id,
    };
  }

  /** List statements available for a Plaid item */
  async listStatements(
    accessToken: string,
    startDate: string,
    endDate: string,
  ): Promise<PlaidStatementsListResponse> {
    return this.request<PlaidStatementsListResponse>("/statements/list", {
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
    });
  }

  /** Download a statement PDF */
  async getStatementPdf(
    accessToken: string,
    statementId: string,
  ): Promise<Buffer> {
    return this.requestBinary("/statements/download", {
      access_token: accessToken,
      statement_id: statementId,
    });
  }

  /** Refresh statements for an item (triggers async generation) */
  async refreshStatements(
    accessToken: string,
    startDate: string,
    endDate: string,
  ): Promise<PlaidStatementsRefreshResponse> {
    return this.request<PlaidStatementsRefreshResponse>("/statements/refresh", {
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
    });
  }

  private async requestBinary(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<Buffer> {
    const body = {
      client_id: this.config.clientId,
      secret: this.config.secret,
      ...payload,
    };

    const response = await fetch(`${plaidBaseUrl(this.config)}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/pdf",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      // Attempt to parse JSON error body from Plaid
      const parsed = (await response.json().catch(() => null)) as
        | PlaidApiErrorResponse
        | null;
      if (parsed?.error_code || parsed?.error_message) {
        throw new PlaidApiError(parsed, response.status);
      }
      throw new Error(`Plaid API binary request failed (${response.status}).`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async request<T extends object>(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const body = {
      client_id: this.config.clientId,
      secret: this.config.secret,
      ...payload,
    };

    const response = await fetch(`${plaidBaseUrl(this.config)}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const parsed = (await response.json().catch(() => null)) as
      | (T & PlaidApiErrorResponse)
      | null;
    if (!response.ok || !parsed) {
      if (parsed?.error_code || parsed?.error_message) {
        throw new PlaidApiError(parsed, response.status);
      }
      throw new Error(`Plaid API request failed (${response.status}).`);
    }

    return parsed as T;
  }
}

let singleton: PlaidClient | null = null;

export function getPlaidClient(): PlaidClient {
  assertNoAiFinancialConnectorAccess("/financial_connectors/plaidClient.ts");
  if (singleton) return singleton;
  singleton = new PlaidClient();
  return singleton;
}
