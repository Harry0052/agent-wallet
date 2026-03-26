import "server-only";
import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";

import { getPlaidClient, type PlaidAccount } from "@/financial_connectors/plaidClient";
import {
  upsertConnectedItem,
  updateAccountBalances,
  updateItemStatus,
  listConnectorItemSecretsForUser,
  type ConnectedAccount,
  type ConnectedAccountType,
} from "@/financial_connectors/tokenVault";
import { listConnectedAccounts, listConnectedInstitutions } from "@/financial_connectors/institutionService";
import { logServerEvent } from "@/lib/server/observability";

assertNoAiFinancialConnectorAccess("/financial_connectors/linkService.ts");

interface NormalizedConnectedAccount {
  plaidAccountId: string;
  accountType: ConnectedAccountType;
  subtype: string | null;
  mask: string;
  nickname: string;
  officialName: string | null;
}

function mapPlaidAccountType(account: PlaidAccount): ConnectedAccountType | null {
  const type = account.type.toLowerCase();
  const subtype = (account.subtype || "").toLowerCase();

  if (type === "credit") {
    return "credit";
  }

  if (type === "depository") {
    if (subtype.includes("checking") || subtype.includes("prepaid")) return "checking";
    if (subtype.includes("savings") || subtype.includes("money market") || subtype.includes("cd")) return "savings";
    // Default depository accounts to checking
    return "checking";
  }

  if (type === "loan") {
    return "loan";
  }

  if (type === "investment") {
    return "investment";
  }

  // Catch-all for brokerage, other, etc.
  if (type === "brokerage") {
    return "investment";
  }

  return "other";
}

function normalizeMask(mask: string | null): string {
  const trimmed = (mask || "").trim();
  if (!trimmed) return "****";
  return trimmed.slice(-4);
}

function normalizeNickname(account: PlaidAccount, mask: string): string {
  const preferred = account.official_name || account.name;
  if (preferred && preferred.trim()) {
    return preferred.trim();
  }
  return `Account ••••${mask}`;
}

function normalizeConnectedAccounts(
  accounts: PlaidAccount[],
): NormalizedConnectedAccount[] {
  return accounts
    .map((account) => {
      const accountType = mapPlaidAccountType(account);
      if (!accountType) return null;
      const mask = normalizeMask(account.mask);
      const nickname = normalizeNickname(account, mask);
      return {
        plaidAccountId: account.account_id,
        accountType,
        subtype: account.subtype || null,
        mask,
        nickname,
        officialName: account.official_name || null,
      };
    })
    .filter((account): account is NormalizedConnectedAccount => account !== null);
}

export async function createUserLinkToken(userId: string): Promise<{
  linkToken: string;
  expiration: string;
}> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/linkService.ts");
  const plaid = getPlaidClient();
  const webhookUrl = process.env.PLAID_WEBHOOK_URL?.trim() || undefined;
  const redirectUri = process.env.PLAID_REDIRECT_URI?.trim() || undefined;
  const created = await plaid.createLinkToken({
    userId,
    clientName: "Calico",
    products: ["auth", "transactions", "statements"],
    webhook: webhookUrl,
    redirectUri,
  });

  return {
    linkToken: created.linkToken,
    expiration: created.expiration,
  };
}

export async function exchangePublicTokenForAccounts(input: {
  userId: string;
  publicToken: string;
}): Promise<{
  accounts: ConnectedAccount[];
  institutions: Array<{ institution_name: string; account_count: number }>;
}> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/linkService.ts");
  const publicToken = input.publicToken.trim();
  if (!publicToken) {
    throw new Error("public_token is required.");
  }

  const plaid = getPlaidClient();
  const exchanged = await plaid.exchangePublicToken(publicToken);
  const accountsSnapshot = await plaid.getAccounts(exchanged.accessToken);

  const normalizedAccounts = normalizeConnectedAccounts(accountsSnapshot.accounts);
  if (normalizedAccounts.length === 0) {
    throw new Error("No supported accounts were found at this institution.");
  }

  let institutionName = "Connected Institution";
  if (accountsSnapshot.institutionId) {
    try {
      const institution = await plaid.getInstitutionById(
        accountsSnapshot.institutionId,
      );
      institutionName = institution.name;
    } catch {
      institutionName = "Connected Institution";
    }
  }

  await upsertConnectedItem({
    userId: input.userId,
    plaidItemId: exchanged.itemId,
    plaidAccessToken: exchanged.accessToken,
    institutionId: accountsSnapshot.institutionId,
    institutionName,
    accounts: normalizedAccounts,
  });

  // Fetch and persist initial balances immediately after linking.
  // The /accounts/get response already contains balance data, so use it directly.
  try {
    const balanceUpdates = accountsSnapshot.accounts
      .filter((a) => a.balances)
      .map((a) => ({
        plaidAccountId: a.account_id,
        balanceAvailable: a.balances?.available ?? null,
        balanceCurrent: a.balances?.current ?? null,
        balanceLimit: a.balances?.limit ?? null,
        balanceCurrency: (
          a.balances?.iso_currency_code
          || a.balances?.unofficial_currency_code
          || "USD"
        ).toUpperCase().slice(0, 3),
      }));

    if (balanceUpdates.length > 0) {
      await updateAccountBalances({
        userId: input.userId,
        balances: balanceUpdates,
      });
    }

    logServerEvent("info", "connect.exchange.initial_balances", {
      userId: input.userId,
      plaidItemId: exchanged.itemId,
      accountCount: balanceUpdates.length,
    });
  } catch (balanceError) {
    // Non-fatal: account linking succeeded even if initial balance write fails
    logServerEvent("warn", "connect.exchange.initial_balances_failed", {
      userId: input.userId,
      plaidItemId: exchanged.itemId,
      message: balanceError instanceof Error ? balanceError.message : "unknown",
    });
  }

  const [accounts, institutions] = await Promise.all([
    listConnectedAccounts(input.userId),
    listConnectedInstitutions(input.userId),
  ]);

  return {
    accounts,
    institutions,
  };
}

/**
 * Create a link token in update mode for relinking an existing Plaid item.
 * This is used when an item requires re-authentication (ITEM_LOGIN_REQUIRED,
 * PENDING_EXPIRATION, PENDING_DISCONNECT).
 */
export async function createRelinkToken(input: {
  userId: string;
  plaidItemId: string;
}): Promise<{
  linkToken: string;
  expiration: string;
}> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/linkService.ts");
  const plaid = getPlaidClient();

  // Find the access token for this item
  const items = await listConnectorItemSecretsForUser(input.userId);
  const item = items.find((i) => i.plaid_item_id === input.plaidItemId);
  if (!item) {
    throw new Error("Item not found or not owned by this user.");
  }

  const webhookUrl = process.env.PLAID_WEBHOOK_URL?.trim() || undefined;
  const redirectUri = process.env.PLAID_REDIRECT_URI?.trim() || undefined;

  const created = await plaid.createLinkToken({
    userId: input.userId,
    clientName: "Calico",
    accessToken: item.plaid_access_token,
    webhook: webhookUrl,
    redirectUri,
  });

  logServerEvent("info", "connect.relink.token_created", {
    userId: input.userId,
    plaidItemId: input.plaidItemId,
  });

  return {
    linkToken: created.linkToken,
    expiration: created.expiration,
  };
}

/**
 * After a successful relink, clear the error state on the item and
 * refresh balances + accounts.
 */
export async function completeRelink(input: {
  userId: string;
  plaidItemId: string;
}): Promise<{
  accounts: ConnectedAccount[];
  institutions: Array<{ institution_name: string; account_count: number }>;
}> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/linkService.ts");

  await updateItemStatus({
    userId: input.userId,
    plaidItemId: input.plaidItemId,
    status: "good",
  });

  logServerEvent("info", "connect.relink.completed", {
    userId: input.userId,
    plaidItemId: input.plaidItemId,
  });

  const [accounts, institutions] = await Promise.all([
    listConnectedAccounts(input.userId),
    listConnectedInstitutions(input.userId),
  ]);

  return { accounts, institutions };
}

/**
 * Create a link token in update mode to add the "statements" product
 * to an existing Plaid item that was linked without it.
 */
export async function upgradeExistingItemForStatements(
  userId: string,
  plaidItemId: string,
): Promise<{ linkToken: string; expiration: string }> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/linkService.ts");
  const plaid = getPlaidClient();

  // Find the access token for this item
  const items = await listConnectorItemSecretsForUser(userId);
  const item = items.find((i) => i.plaid_item_id === plaidItemId);
  if (!item) {
    throw new Error("Item not found or not owned by this user.");
  }

  const webhookUrl = process.env.PLAID_WEBHOOK_URL?.trim() || undefined;
  const redirectUri = process.env.PLAID_REDIRECT_URI?.trim() || undefined;

  const created = await plaid.createLinkToken({
    userId,
    clientName: "Calico",
    accessToken: item.plaid_access_token,
    additionalConsentedProducts: ["statements"],
    webhook: webhookUrl,
    redirectUri,
  });

  logServerEvent("info", "connect.upgrade_statements.token_created", {
    userId,
    plaidItemId,
  });

  return {
    linkToken: created.linkToken,
    expiration: created.expiration,
  };
}
