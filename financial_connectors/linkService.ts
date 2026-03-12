import "server-only";
import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";

import { getPlaidClient, type PlaidAccount } from "@/financial_connectors/plaidClient";
import {
  upsertConnectedItem,
  type ConnectedAccount,
  type ConnectedAccountType,
} from "@/financial_connectors/tokenVault";
import { listConnectedAccounts, listConnectedInstitutions } from "@/financial_connectors/institutionService";

assertNoAiFinancialConnectorAccess("/financial_connectors/linkService.ts");

interface NormalizedConnectedAccount {
  plaidAccountId: string;
  accountType: ConnectedAccountType;
  mask: string;
  nickname: string;
}

function mapPlaidAccountType(account: PlaidAccount): ConnectedAccountType | null {
  const type = account.type.toLowerCase();
  const subtype = (account.subtype || "").toLowerCase();

  if (type === "credit") {
    return "credit";
  }

  if (type === "depository" && subtype.includes("checking")) {
    return "checking";
  }

  if (type === "depository" && subtype.includes("savings")) {
    return "savings";
  }

  return null;
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
        mask,
        nickname,
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
  const created = await plaid.createLinkToken({
    userId,
    clientName: "Agent Wallet",
    products: ["auth"],
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
    throw new Error("No eligible checking, savings, or credit accounts were found.");
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

  const [accounts, institutions] = await Promise.all([
    listConnectedAccounts(input.userId),
    listConnectedInstitutions(input.userId),
  ]);

  return {
    accounts,
    institutions,
  };
}
