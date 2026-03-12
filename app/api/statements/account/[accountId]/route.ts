import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import { parseStatementQueryParams } from "@/statements/statementService";
import { getAccountStatement } from "@/statements/accountStatement";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  accountId: z.string().trim().min(1),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ accountId: string }> },
) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "statements" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  const routeParams = await context.params;

  try {
    const userId = auth.auth.walletUserId;
    const params = ParamsSchema.parse(routeParams);
    const parsed = parseStatementQueryParams(req.nextUrl.searchParams);

    const statement = await getAccountStatement({
      userId,
      accountId: params.accountId,
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
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join("; ")
        : error instanceof Error
          ? error.message
          : "Failed to load account statement.";
    const lower = message.toLowerCase();
    const status = lower.includes("not found")
      ? 404
      : lower.includes("invalid ")
        ? 400
        : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent("error", "statements.account.failed", {
      errorCode,
      message,
      accountId: routeParams.accountId,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
