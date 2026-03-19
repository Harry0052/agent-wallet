import type { SavedPaymentMethod } from "@/lib/types";
import type { RecordSourceType } from "@/lib/manualMode";
import { normalizeRecordSourceType } from "@/lib/sourceType";
import { safeJson } from "@/services/safeFetch";

export type SourceState = "Synced" | "Imported" | "Inferred" | "Manual";

export interface ConnectedAccountRecord {
  id: string;
  user_id: string;
  institution_name: string;
  account_type: "credit" | "checking" | "savings" | "cash" | "loan";
  mask: string;
  nickname: string;
  last_synced_at: string | null;
  balance?: number;
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

interface PlaidCreateConfig {
  token: string;
  onSuccess: (publicToken: string) => void;
  onExit: (error: { error_message?: string; error_code?: string } | null) => void;
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

function toError(payload: { error?: string; errorCode?: string }): Error {
  if (payload.errorCode && payload.error) return new Error(`${payload.errorCode}: ${payload.error}`);
  return new Error(payload.error || "Request failed");
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

async function openPlaidProviderFlow(linkToken: string): Promise<string> {
  await ensurePlaidScriptLoaded();

  const plaid = window.Plaid;
  if (!plaid?.create) {
    throw new Error("Plaid Link is unavailable in this browser.");
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const handler = plaid.create({
      token: linkToken,
      onSuccess: (publicToken: string) => {
        if (settled) return;
        settled = true;
        resolve(publicToken);
        try {
          handler.destroy?.();
        } catch {
          // Best-effort cleanup only.
        }
      },
      onExit: (error) => {
        if (settled) return;
        settled = true;
        const message = error?.error_message || error?.error_code || "Account linking was canceled.";
        reject(new Error(message));
        try {
          handler.destroy?.();
        } catch {
          // Best-effort cleanup only.
        }
      },
    });

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
  }>(response);

  if (!response.ok || !payload.ok) {
    throw toError(payload);
  }

  return {
    accounts: Array.isArray(payload.accounts) ? payload.accounts : [],
    institutions: Array.isArray(payload.institutions) ? payload.institutions : [],
  };
}

export async function connectAccountsViaSupportedFlow(): Promise<ConnectedAccountExchangeResult> {
  const token = await createConnectedAccountLinkToken();
  const publicToken = await openPlaidProviderFlow(token.linkToken);
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
