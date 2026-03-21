import "server-only";

import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";
import { getPlaidClient, type PlaidAccount } from "@/financial_connectors/plaidClient";
import {
  listConnectorItemSecretsForUser,
  updateAccountBalances,
  updateItemStatus,
  type BalanceUpdate,
} from "@/financial_connectors/tokenVault";
import { logServerEvent } from "@/lib/server/observability";

assertNoAiFinancialConnectorAccess("/financial_connectors/balanceService.ts");

export interface BalanceRefreshResult {
  user_id: string;
  plaid_item_id: string;
  accounts_updated: number;
  status: "completed" | "failed" | "relink_required";
  error_message?: string;
  request_id?: string;
}

function plaidAccountToBalanceUpdate(account: PlaidAccount): BalanceUpdate {
  const balances = account.balances;
  return {
    plaidAccountId: account.account_id,
    balanceAvailable: balances?.available ?? null,
    balanceCurrent: balances?.current ?? null,
    balanceLimit: balances?.limit ?? null,
    balanceCurrency: (
      balances?.iso_currency_code
      || balances?.unofficial_currency_code
      || "USD"
    ).toUpperCase().slice(0, 3),
  };
}

function isRelinkError(error: unknown): boolean {
  if (error && typeof error === "object" && "errorCode" in error) {
    const code = (error as { errorCode: string }).errorCode;
    return code === "ITEM_LOGIN_REQUIRED" || code === "ITEM_LOCKED";
  }
  return false;
}

export async function refreshBalancesForConnectorItem(input: {
  userId: string;
  plaidItemId: string;
  accessToken: string;
}): Promise<BalanceRefreshResult> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/balanceService.ts");
  const plaid = getPlaidClient();

  try {
    const response = await plaid.getBalances(input.accessToken);

    logServerEvent("info", "connect.balances.refresh.success", {
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      accountCount: response.accounts.length,
      requestId: response.requestId,
    });

    const balanceUpdates = response.accounts.map(plaidAccountToBalanceUpdate);

    const updated = await updateAccountBalances({
      userId: input.userId,
      balances: balanceUpdates,
    });

    await updateItemStatus({
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      status: "good",
    });

    return {
      user_id: input.userId,
      plaid_item_id: input.plaidItemId,
      accounts_updated: updated,
      status: "completed",
      request_id: response.requestId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Balance refresh failed";
    const requestId = (error as { requestId?: string })?.requestId;

    logServerEvent("error", "connect.balances.refresh.failed", {
      userId: input.userId,
      plaidItemId: input.plaidItemId,
      message,
      requestId,
    });

    if (isRelinkError(error)) {
      await updateItemStatus({
        userId: input.userId,
        plaidItemId: input.plaidItemId,
        status: "relink_required",
        errorCode: (error as { errorCode?: string }).errorCode,
      });

      return {
        user_id: input.userId,
        plaid_item_id: input.plaidItemId,
        accounts_updated: 0,
        status: "relink_required",
        error_message: message,
        request_id: requestId,
      };
    }

    return {
      user_id: input.userId,
      plaid_item_id: input.plaidItemId,
      accounts_updated: 0,
      status: "failed",
      error_message: message,
      request_id: requestId,
    };
  }
}

export async function refreshBalancesForUser(
  userId: string,
): Promise<BalanceRefreshResult[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/balanceService.ts");
  const itemSecrets = await listConnectorItemSecretsForUser(userId);
  const results: BalanceRefreshResult[] = [];

  for (const item of itemSecrets) {
    const result = await refreshBalancesForConnectorItem({
      userId: item.user_id,
      plaidItemId: item.plaid_item_id,
      accessToken: item.plaid_access_token,
    });
    results.push(result);
  }

  return results;
}
