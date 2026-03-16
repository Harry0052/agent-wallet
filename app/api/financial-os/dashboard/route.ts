import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { apiError, classifyTaskError, logServerEvent } from "@/lib/server/observability";
import { buildUnifiedFinancialAccountDashboard } from "@/lib/server/financialOs/dashboard";
import { isAuthError } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  sync: z.enum(["0", "1"]).optional(),
});

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "financial_os_dashboard" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const parsed = querySchema.parse({
      sync: req.nextUrl.searchParams.get("sync") || undefined,
    });
    const payload = await buildUnifiedFinancialAccountDashboard({
      userId: auth.auth.walletUserId,
      attemptRealtimeSync: parsed.sync === "1",
    });
    return NextResponse.json({
      ok: true,
      dashboard: payload,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.issues.map((issue) => issue.message).join("; "), true), {
        status: 400,
      });
    }
    const message = error instanceof Error ? error.message : "Failed to build financial OS dashboard.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "financial_os.dashboard.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
