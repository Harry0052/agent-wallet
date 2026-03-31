import { NextRequest, NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import {
  listLiabilityDetails,
  syncLiabilitiesForUser,
} from "@/financial_connectors/liabilityService";
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
    const liabilities = await listLiabilityDetails(userId);

    logServerEvent("info", "connect.liabilities.list.success", {
      userId,
      count: liabilities.length,
    });

    return NextResponse.json({
      ok: true,
      liabilities,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }
    const message = error instanceof Error ? error.message : "Failed to list liabilities.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.liabilities.list.failed", { errorCode, message });
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
    const syncResults = await syncLiabilitiesForUser(userId);
    const liabilities = await listLiabilityDetails(userId);

    logServerEvent("info", "connect.liabilities.sync.completed", {
      userId,
      itemCount: syncResults.length,
      totalLiabilities: liabilities.length,
    });

    return NextResponse.json({
      ok: true,
      sync: syncResults,
      liabilities,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }
    const message = error instanceof Error ? error.message : "Failed to sync liabilities.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.liabilities.sync.route_failed", { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
