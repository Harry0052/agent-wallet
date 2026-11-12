import type { SavedPaymentMethod } from "@/lib/types";
import type { RecordSourceType } from "@/lib/manualMode";
import { normalizeRecordSourceType } from "@/lib/sourceType";
import { safeJson } from "@/services/safeFetch";

export type SourceState = "Synced" | "Imported" | "Inferred" | "Manual";

export interface ConnectedAccountRecord {
  id: string;
  user_id: string;
  plaid_item_id?: string;
  institution_name: string;
  account_type: "credit" | "checking" | "savings" | "cash" | "loan" | "investment" | "other";
  subtype?: string | null;
  mask: string;
  nickname: string;
  official_name?: string | null;
  last_synced_at: string | null;
  balance?: number;
  balance_available?: number | null;
  balance_current?: number | null;
  balance_limit?: number | null;
  balance_currency?: string;
  balance_refreshed_at?: string | null;
  item_status?: "good" | "error" | "relink_required";
  item_error_code?: string | null;
  new_accounts_available?: boolean;
  sourceType?: RecordSourceType;
}

export interface ConnectedInstitutionRecord {
  institution_name: string;
  account_count: number;
}

export interface ConnectedAppRecord {
  key: string;
  name: string;
  status: "not_connected" | "connected" | "reauth_required";
  sourceState: "Synced" | "Manual";
  sourceType?: RecordSourceType;
  lastSyncedAt: string | null;
  authType: "oauth" | "api_key";
}

export interface TrackedRecurringRecord {
  id: string;
  merchant: string;
  estimated_monthly_cost: number;
  recurrence_interval: string;
  confidence: number;
  last_seen: string;
  status: string;
}

export interface ConnectedAccountLinkToken {
  linkToken: string;
  expiration: string;
}

export interface ConnectedAccountExchangeResult {
  accounts: ConnectedAccountRecord[];
  institutions: ConnectedInstitutionRecord[];
}

export interface ConnectedTransactionsSyncResult {
  sync: Array<{
    user_id: string;
    plaid_item_id: string;
    added_count: number;
    modified_count: number;
    removed_count: number;
    pages: number;
    cursor: string | null;
  }>;
  transactions: Array<Record<string, unknown>>;
}

interface PlaidLinkHandler {
  open: () => void;
  destroy?: () => void;
}

interface PlaidLinkError {
  error_message?: string;
  error_code?: string;
  error_type?: string;
  display_message?: string;
}

interface PlaidExitMetadata {
  institution?: { name?: string; institution_id?: string };
  link_session_id?: string;
  request_id?: string;
  status?: string;
}

interface PlaidCreateConfig {
  token: string;
  receivedRedirectUri?: string;
  onSuccess: (publicToken: string) => void;
  onExit: (error: PlaidLinkError | null, metadata: PlaidExitMetadata) => void;
}

interface PlaidRuntime {
  create: (config: PlaidCreateConfig) => PlaidLinkHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidRuntime;
  }
}

const PLAID_LINK_SCRIPT_URL = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
let plaidScriptPromise: Promise<void> | null = null;

export class ConnectApiError extends Error {
  readonly errorCode: string;
  readonly plaidErrorCode: string | null;

  constructor(payload: { error?: string; errorCode?: string; plaidErrorCode?: string }) {
    const code = payload.errorCode || "UNKNOWN_FAILURE";
    const isDbError = /^DB_/i.test(code) || /maxclient|pool|connection/i.test(payload.error || "");
    super(isDbError ? "Agent Wallet is temporarily busy. Please try again in a moment." : (payload.error || "Request failed"));
    this.name = "ConnectApiError";
    this.errorCode = code;
    this.plaidErrorCode = payload.plaidErrorCode || null;
  }
}

function toError(payload: { error?: string; errorCode?: string; plaidErrorCode?: string }): ConnectApiError {
  return new ConnectApiError(payload);
}

function normalizeSourceState(value: unknown): SourceState {
  if (typeof value !== "string") return "Synced";
  const normalized = value.trim().toLowerCase();
  if (normalized === "manual") return "Manual";
  if (normalized === "imported") return "Imported";
  if (normalized === "inferred") return "Inferred";
  return "Synced";
}

async function ensurePlaidScriptLoaded(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Plaid Link can only run in a browser session.");
  }
  if (window.Plaid?.create) return;
  if (plaidScriptPromise) return plaidScriptPromise;

  plaidScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLAID_LINK_SCRIPT_URL}"]`);
    if (existing) {
      if (window.Plaid?.create) {
        resolve();
        return;
      }
      if (existing.dataset.awPlaidLoaded === "1") {
        reject(new Error("Plaid Link script loaded but provider runtime is unavailable."));
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Plaid Link script.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = PLAID_LINK_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      script.dataset.awPlaidLoaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Plaid Link script."));
    document.head.appendChild(script);
  }).finally(() => {
    if (!window.Plaid?.create) {
      plaidScriptPromise = null;
    }
  });

  return plaidScriptPromise;
}

async function openPlaidProviderFlow(
  linkToken: string,
  receivedRedirectUri?: string,
): Promise<string> {
  await ensurePlaidScriptLoaded();

  const plaid = window.Plaid;
  if (!plaid?.create) {
    throw new Error("Plaid Link is unavailable in this browser.");
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let handler: PlaidLinkHandler;

    const config: PlaidCreateConfig = {
      token: linkToken,
      onSuccess: (publicToken: string) => {
        if (settled) return;
        settled = true;
        resolve(publicToken);
        try { handler.destroy?.(); } catch { /* best-effort */ }
      },
      onExit: (error, metadata) => {
        if (settled) return;
        settled = true;

        if (!error) {
          reject(new ConnectApiError({
            error: "Account linking was canceled.",
            errorCode: "USER_CANCELED",
          }));
        } else {
          const userMessage = error.display_message
            || error.error_message
            || "Account linking failed.";

          if (typeof console !== "undefined") {
            console.warn("[Plaid Link onExit]", {
              errorCode: error.error_code,
              errorType: error.error_type,
              message: error.error_message,
              institution: metadata?.institution?.name,
              linkSessionId: metadata?.link_session_id,
              status: metadata?.status,
            });
          }

          reject(new ConnectApiError({
            error: userMessage,
            errorCode: error.error_type || "PLAID_LINK_ERROR",
            plaidErrorCode: error.error_code,
          }));
        }

        try { handler.destroy?.(); } catch { /* best-effort */ }
      },
    };

    if (receivedRedirectUri) {
      config.receivedRedirectUri = receivedRedirectUri;
    }

    handler = plaid.create(config);
    handler.open();
  });
}

export async function fetchConnectedAccountsBundle(): Promise<{
  accounts: ConnectedAccountRecord[];
  institutions: ConnectedInstitutionRecord[];
}> {
  const response = await fetch("/api/connect/accounts", {
    method: "GET",
    cache: "no-store",
  });

  const payload = await safeJson<{
    ok?: boolean;
    accounts?: ConnectedAccountRecord[];
    institutions?: ConnectedInstitutionRecord[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok) {
    throw toError(payload);
  }

  return {
    accounts: Array.isArray(payload.accounts)
      ? payload.accounts.map((account) => ({
        ...account,
        // Derive balance from Plaid balance fields for consistent display
        balance: account.balance ?? account.balance_current ?? account.balance_available ?? undefined,
        sourceType: normalizeRecordSourceType(account.sourceType, "connected"),
      }))
      : [],
    institutions: Array.isArray(payload.institutions) ? payload.institutions : [],
  };
}

export async function createConnectedAccountLinkToken(): Promise<ConnectedAccountLinkToken> {
  const response = await fetch("/api/connect/create-link-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const payload = await safeJson<{
    ok?: boolean;
    link_token?: string;
    expiration?: string;
    error?: string;
    errorCode?: string;
    plaidErrorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok || !payload.link_token || !payload.expiration) {
    throw toError(payload);
  }

  return {
    linkToken: payload.link_token,
    expiration: payload.expiration,
  };
}

export async function exchangeConnectedAccountPublicToken(
  publicToken: string,
): Promise<ConnectedAccountExchangeResult> {
  const response = await fetch("/api/connect/exchange-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      public_token: publicToken,
    }),
  });

  const payload = await safeJson<{
    ok?: boolean;
    accounts?: ConnectedAccountRecord[];
    institutions?: ConnectedInstitutionRecord[];
    error?: string;
    errorCode?: string;
    plaidErrorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok) {
    throw toError(payload);
  }

  return {
    accounts: Array.isArray(payload.accounts) ? payload.accounts : [],
    institutions: Array.isArray(payload.institutions) ? payload.institutions : [],
  };
}

export function consumePlaidOAuthStateId(): string | null {
  if (typeof window === "undefined") return null;
  const stateId = sessionStorage.getItem("plaid_oauth_state_id");
  if (stateId) {
    sessionStorage.removeItem("plaid_oauth_state_id");
  }
  return stateId;
}

export async function connectAccountsViaSupportedFlow(): Promise<ConnectedAccountExchangeResult> {
  const oauthStateId = consumePlaidOAuthStateId();
  const token = await createConnectedAccountLinkToken();

  // If resuming after an OAuth redirect, pass the current page URL so Plaid
  // Link can match it against the registered redirect URI.
  const redirectUri = oauthStateId ? window.location.href : undefined;
  const publicToken = await openPlaidProviderFlow(token.linkToken, redirectUri);
  return exchangeConnectedAccountPublicToken(publicToken);
}

export async function syncConnectedTransactions(): Promise<ConnectedTransactionsSyncResult> {
  const response = await fetch("/api/connect/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const payload = await safeJson<{
    ok?: boolean;
    sync?: ConnectedTransactionsSyncResult["sync"];
    transactions?: ConnectedTransactionsSyncResult["transactions"];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok || !Array.isArray(payload.sync) || !Array.isArray(payload.transactions)) {
    throw toError(payload);
  }

  return {
    sync: payload.sync,
    transactions: payload.transactions,
  };
}

export interface BalanceRefreshResult {
  refresh: Array<{
    user_id: string;
    plaid_item_id: string;
    accounts_updated: number;
    status: "completed" | "failed" | "relink_required";
    error_message?: string;
  }>;
  accounts: ConnectedAccountRecord[];
}

export async function refreshConnectedBalances(): Promise<BalanceRefreshResult> {
  const response = await fetch("/api/connect/balances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const payload = await safeJson<{
    ok?: boolean;
    refresh?: BalanceRefreshResult["refresh"];
    accounts?: ConnectedAccountRecord[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok) {
    throw toError(payload);
  }

  return {
    refresh: Array.isArray(payload.refresh) ? payload.refresh : [],
    accounts: Array.isArray(payload.accounts)
      ? payload.accounts.map((account) => ({
        ...account,
        sourceType: normalizeRecordSourceType(account.sourceType, "connected"),
      }))
      : [],
  };
}

export async function createRelinkToken(plaidItemId: string): Promise<{
  linkToken: string;
  expiration: string;
}> {
  const response = await fetch("/api/connect/relink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plaid_item_id: plaidItemId, action: "create_token" }),
  });

  const payload = await safeJson<{
    ok?: boolean;
    link_token?: string;
    expiration?: string;
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok || !payload.link_token) {
    throw toError(payload);
  }

  return {
    linkToken: payload.link_token,
    expiration: payload.expiration || "",
  };
}

export async function completeRelink(plaidItemId: string): Promise<ConnectedAccountExchangeResult> {
  const response = await fetch("/api/connect/relink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plaid_item_id: plaidItemId, action: "complete" }),
  });

  const payload = await safeJson<{
    ok?: boolean;
    accounts?: ConnectedAccountRecord[];
    institutions?: ConnectedInstitutionRecord[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok) {
    throw toError(payload);
  }

  return {
    accounts: Array.isArray(payload.accounts) ? payload.accounts : [],
    institutions: Array.isArray(payload.institutions) ? payload.institutions : [],
  };
}

/**
 * Full relink flow: create update-mode link token → open Plaid Link → complete relink.
 */
export async function relinkAccount(plaidItemId: string): Promise<ConnectedAccountExchangeResult> {
  const token = await createRelinkToken(plaidItemId);
  await openPlaidProviderFlow(token.linkToken);
  return completeRelink(plaidItemId);
}

/**
 * Full new-accounts review flow: create update-mode token with account selection
 * → open Plaid Link → complete review (clears flag, refreshes accounts).
 */
export async function reviewNewAccounts(plaidItemId: string): Promise<ConnectedAccountExchangeResult> {
  const response = await fetch("/api/connect/relink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plaid_item_id: plaidItemId, action: "new_accounts" }),
  });

  const payload = await safeJson<{
    ok?: boolean;
    link_token?: string;
    expiration?: string;
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok || !payload.link_token) {
    throw toError(payload);
  }

  await openPlaidProviderFlow(payload.link_token);

  // Complete: clear new_accounts_available flag and refresh accounts
  const completeResponse = await fetch("/api/connect/relink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plaid_item_id: plaidItemId, action: "complete_new_accounts" }),
  });

  const completePayload = await safeJson<{
    ok?: boolean;
    accounts?: ConnectedAccountRecord[];
    institutions?: ConnectedInstitutionRecord[];
    error?: string;
    errorCode?: string;
  }>(completeResponse);

  if (!completeResponse.ok || !completePayload.ok) {
    throw toError(completePayload);
  }

  return {
    accounts: Array.isArray(completePayload.accounts) ? completePayload.accounts : [],
    institutions: Array.isArray(completePayload.institutions) ? completePayload.institutions : [],
  };
}

export async function removeConnectedAccount(accountId: string): Promise<{
  removed: boolean;
  removedItem: boolean;
}> {
  const response = await fetch(`/api/connect/accounts/${encodeURIComponent(accountId)}/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const payload = await safeJson<{
    ok?: boolean;
    removed?: boolean;
    removedItem?: boolean;
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok) {
    throw toError(payload);
  }

  return {
    removed: Boolean(payload.removed),
    removedItem: Boolean(payload.removedItem),
  };
}

export async function fetchConnectedApps(): Promise<ConnectedAppRecord[]> {
  const response = await fetch("/api/connect/apps", {
    method: "GET",
    cache: "no-store",
  });

  const payload = await safeJson<{
    ok?: boolean;
    apps?: ConnectedAppRecord[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok || !Array.isArray(payload.apps)) {
    throw toError(payload);
  }

  return payload.apps.map((app) => {
    const sourceState = normalizeSourceState(app.sourceState);
    return {
      ...app,
      sourceState: sourceState === "Manual" ? "Manual" : "Synced",
      sourceType: normalizeRecordSourceType(sourceState, "connected"),
    };
  });
}

export async function fetchTrackedRecurring(): Promise<TrackedRecurringRecord[]> {
  const response = await fetch("/api/subscriptions/suspected", {
    method: "GET",
    cache: "no-store",
  });

  const payload = await safeJson<{
    ok?: boolean;
    subscriptions?: TrackedRecurringRecord[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok || !Array.isArray(payload.subscriptions)) {
    throw toError(payload);
  }

  return payload.subscriptions;
}

// ── Investment holdings ────────────────────────────────────────────────

export interface InvestmentHoldingRecord {
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
  security_name?: string | null;
  ticker_symbol?: string | null;
  security_type?: string | null;
}

export async function fetchInvestmentHoldings(): Promise<InvestmentHoldingRecord[]> {
  const response = await fetch("/api/connect/investments", {
    method: "GET",
    cache: "no-store",
  });

  const payload = await safeJson<{
    ok?: boolean;
    holdings?: InvestmentHoldingRecord[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok || !Array.isArray(payload.holdings)) {
    throw toError(payload);
  }

  return payload.holdings;
}

export async function syncInvestmentHoldings(): Promise<{
  sync: Array<{ user_id: string; plaid_item_id: string; holdings_synced: number; status: string }>;
  holdings: InvestmentHoldingRecord[];
}> {
  const response = await fetch("/api/connect/investments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const payload = await safeJson<{
    ok?: boolean;
    sync?: Array<{ user_id: string; plaid_item_id: string; holdings_synced: number; status: string }>;
    holdings?: InvestmentHoldingRecord[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok) {
    throw toError(payload);
  }

  return {
    sync: Array.isArray(payload.sync) ? payload.sync : [],
    holdings: Array.isArray(payload.holdings) ? payload.holdings : [],
  };
}

// ── Liability details ─────────────────────────────────────────────────

export interface LiabilityDetailRecord {
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
  updated_at: string;
}

export async function fetchLiabilityDetails(): Promise<LiabilityDetailRecord[]> {
  const response = await fetch("/api/connect/liabilities", {
    method: "GET",
    cache: "no-store",
  });

  const payload = await safeJson<{
    ok?: boolean;
    liabilities?: LiabilityDetailRecord[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok || !Array.isArray(payload.liabilities)) {
    throw toError(payload);
  }

  return payload.liabilities;
}

export async function syncLiabilityDetails(): Promise<{
  sync: Array<{ user_id: string; plaid_item_id: string; liabilities_synced: number; status: string }>;
  liabilities: LiabilityDetailRecord[];
}> {
  const response = await fetch("/api/connect/liabilities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const payload = await safeJson<{
    ok?: boolean;
    sync?: Array<{ user_id: string; plaid_item_id: string; liabilities_synced: number; status: string }>;
    liabilities?: LiabilityDetailRecord[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok) {
    throw toError(payload);
  }

  return {
    sync: Array.isArray(payload.sync) ? payload.sync : [],
    liabilities: Array.isArray(payload.liabilities) ? payload.liabilities : [],
  };
}

export async function fetchFundingMethods(): Promise<SavedPaymentMethod[]> {
  const response = await fetch("/api/funding/payment-methods", {
    method: "GET",
    cache: "no-store",
  });

  const payload = await safeJson<{
    ok?: boolean;
    methods?: SavedPaymentMethod[];
    error?: string;
    errorCode?: string;
  }>(response);

  if (!response.ok || !payload.ok || !Array.isArray(payload.methods)) {
    throw toError(payload);
  }

  return payload.methods;
}
