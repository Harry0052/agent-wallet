import "server-only";

import { getOptionalSecret } from "@/security/secretsManager";
import { logServerEvent } from "@/lib/server/observability";

export interface PlaidConfigStatus {
  ready: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Validates that all required Plaid configuration is present and well-formed.
 * Does NOT throw — returns a diagnostic status object.
 * Call at startup or before the first Plaid operation to surface issues early.
 */
export function checkPlaidConfig(): PlaidConfigStatus {
  const missing: string[] = [];
  const warnings: string[] = [];

  const clientId = getOptionalSecret("PLAID_CLIENT_ID", { allowUnsafeCaller: true });
  if (!clientId) {
    missing.push("PLAID_CLIENT_ID");
  }

  const secret = getOptionalSecret("PLAID_SECRET", { allowUnsafeCaller: true });
  if (!secret) {
    missing.push("PLAID_SECRET");
  }

  const env = process.env.PLAID_ENV?.trim().toLowerCase();
  if (!env) {
    missing.push("PLAID_ENV");
  } else if (env !== "sandbox" && env !== "development" && env !== "production") {
    warnings.push(`PLAID_ENV is "${env}" — must be "sandbox", "development", or "production".`);
  }

  // Production-specific checks
  if (env === "production") {
    const redirectUri = process.env.PLAID_REDIRECT_URI?.trim();
    if (!redirectUri) {
      warnings.push(
        "PLAID_REDIRECT_URI is not set. OAuth-based institutions (Chase, Capital One, etc.) will fail in production. " +
        "Set this to your app's Plaid OAuth callback URL and register it in the Plaid dashboard.",
      );
    }

    const webhookUrl = process.env.PLAID_WEBHOOK_URL?.trim();
    if (!webhookUrl) {
      warnings.push(
        "PLAID_WEBHOOK_URL is not set. Transaction and item webhooks will not fire. " +
        "Set this to your public webhook endpoint (e.g. https://your-domain.com/api/connect/transactions/webhook).",
      );
    }
  }

  const ready = missing.length === 0 && warnings.filter((w) => !w.startsWith("PLAID_WEBHOOK_URL")).length === 0;

  if (missing.length > 0 || warnings.length > 0) {
    logServerEvent("warn", "plaid.config_check", {
      ready,
      missing: missing.length > 0 ? missing.join(", ") : undefined,
      warningCount: warnings.length,
    });
  }

  return { ready, missing, warnings };
}
