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
    accessToken?: string;
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
    } else {
      payload.products = input.products ?? ["auth", "transactions"];
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
