import "server-only";
import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";

import {
  listStoredConnectedAccounts,
  listStoredConnectedInstitutions,
  listConnectorItemSecretsForUser,
  removeStoredConnectedAccount,
  type ConnectedAccount,
  type ConnectedInstitution,
} from "@/financial_connectors/tokenVault";
import { getPlaidClient } from "@/financial_connectors/plaidClient";
import { logServerEvent } from "@/lib/server/observability";

assertNoAiFinancialConnectorAccess("/financial_connectors/institutionService.ts");

export async function listConnectedInstitutions(
  userId: string,
): Promise<ConnectedInstitution[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/institutionService.ts");
  return listStoredConnectedInstitutions(userId);
}

export async function listConnectedAccounts(
  userId: string,
): Promise<ConnectedAccount[]> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/institutionService.ts");
  return listStoredConnectedAccounts(userId);
}

export async function removeConnectedAccount(input: {
  userId: string;
  accountId: string;
}): Promise<{
  removed: boolean;
  removedItem: boolean;
  transactionsRemoved: number;
}> {
  assertNoAiFinancialConnectorAccess("/financial_connectors/institutionService.ts");

  // Snapshot access tokens BEFORE removal — the DB rows will be gone after.
  let tokensByItemId = new Map<string, string>();
  try {
    const secrets = await listConnectorItemSecretsForUser(input.userId);
    tokensByItemId = new Map(secrets.map((s) => [s.plaid_item_id, s.plaid_access_token]));
  } catch {
    // Non-fatal: local cleanup proceeds even if we can't call Plaid
  }

  const result = await removeStoredConnectedAccount(input);

  // If the entire Item was removed locally, also remove it from Plaid
  if (result.removedItem && result.removedPlaidItemId) {
    const accessToken = tokensByItemId.get(result.removedPlaidItemId);
    if (accessToken) {
      try {
        const plaid = getPlaidClient();
        const removal = await plaid.removeItem(accessToken);
        logServerEvent("info", "connect.item_remove.success", {
          userId: input.userId,
          plaidItemId: result.removedPlaidItemId,
          requestId: removal.requestId,
        });
      } catch (error) {
        // Log but don't fail — local cleanup already succeeded.
        // The item may already be removed on Plaid's side (INVALID_ACCESS_TOKEN).
        const message = error instanceof Error ? error.message : "unknown";
        logServerEvent("warn", "connect.item_remove.failed", {
          userId: input.userId,
          plaidItemId: result.removedPlaidItemId,
          message,
        });
      }
    }
  }

  return {
    removed: result.removed,
    removedItem: result.removedItem,
    transactionsRemoved: result.transactionsRemoved,
  };
}
