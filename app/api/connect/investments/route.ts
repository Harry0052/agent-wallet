import { NextRequest, NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import {
  listInvestmentHoldings,
  syncInvestmentsForUser,
} from "@/financial_connectors/investmentService";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "connect" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const holdings = await listInvestmentHoldings(userId);

    logServerEvent("info", "connect.investments.list.success", {
      userId,
      count: holdings.length,
    });

    return NextResponse.json({
      ok: true,
      holdings,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }
    const message = error instanceof Error ? error.message : "Failed to list investment holdings.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.investments.list.failed", { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "connect" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const syncResults = await syncInvestmentsForUser(userId);
    const holdings = await listInvestmentHoldings(userId);

    logServerEvent("info", "connect.investments.sync.completed", {
      userId,
      itemCount: syncResults.length,
      totalHoldings: holdings.length,
    });

    return NextResponse.json({
      ok: true,
      sync: syncResults,
      holdings,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }
    const message = error instanceof Error ? error.message : "Failed to sync investment holdings.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.investments.sync.route_failed", { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
