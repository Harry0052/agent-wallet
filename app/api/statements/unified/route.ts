import { NextRequest, NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import { parseStatementQueryParams } from "@/statements/statementService";
import { getUnifiedStatement } from "@/statements/unifiedStatement";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "statements" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const parsed = parseStatementQueryParams(req.nextUrl.searchParams);
    const statement = await getUnifiedStatement({
      userId,
      filters: parsed.filters,
      pagination: parsed.pagination,
    });

    return NextResponse.json({
      ok: true,
      statement,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }

    const message =
      error instanceof Error ? error.message : "Failed to load unified statement.";
    const status = message.toLowerCase().includes("invalid ") ? 400 : 500;
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "statements.unified.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
