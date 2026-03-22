import { NextRequest, NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import { refreshBalancesForUser } from "@/financial_connectors/balanceService";
import { listConnectedAccounts } from "@/financial_connectors/institutionService";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "connect" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const refreshResults = await refreshBalancesForUser(userId);
    const accounts = await listConnectedAccounts(userId);

    logServerEvent("info", "connect.balances.refresh.completed", {
      userId,
      itemCount: refreshResults.length,
      totalUpdated: refreshResults.reduce((sum, r) => sum + r.accounts_updated, 0),
    });

    return NextResponse.json({
      ok: true,
      refresh: refreshResults,
      accounts,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }
    const message =
      error instanceof Error
        ? error.message
        : "Failed to refresh account balances.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.balances.refresh.route_failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
