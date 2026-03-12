import { NextRequest, NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import {
  listConnectedAccounts,
  listConnectedInstitutions,
} from "@/financial_connectors/institutionService";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "connect" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const [accounts, institutions] = await Promise.all([
      listConnectedAccounts(userId),
      listConnectedInstitutions(userId),
    ]);

    return NextResponse.json({
      ok: true,
      accounts,
      institutions,
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
        : "Failed to load connected bank and card accounts.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.accounts.failed", { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
