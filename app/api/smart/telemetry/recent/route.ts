import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { apiError, classifyTaskError, logServerEvent } from "@/lib/server/observability";
import { listRecentSmartTelemetryEvents } from "@/lib/server/smartTelemetryBuffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "smart_telemetry_recent" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const query = QuerySchema.parse({
      limit: req.nextUrl.searchParams.get("limit") || undefined,
    });

    const events = listRecentSmartTelemetryEvents({
      userId: auth.auth.walletUserId,
      limit: query.limit,
    });

    return NextResponse.json({
      ok: true,
      events,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Failed to fetch Agent Wallet telemetry debug events.";
    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent("error", "smart.telemetry.recent.failed", { errorCode, message });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
