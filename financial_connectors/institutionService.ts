import "server-only";
import { assertNoAiFinancialConnectorAccess } from "@/security/secretsGuard";

import {
  listStoredConnectedAccounts,
  listStoredConnectedInstitutions,
  type ConnectedAccount,
  type ConnectedInstitution,
} from "@/financial_connectors/tokenVault";

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
