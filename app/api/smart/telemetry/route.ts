import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { apiError, classifyTaskError, logServerEvent } from "@/lib/server/observability";
import { pushSmartTelemetryEvent } from "@/lib/server/smartTelemetryBuffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EventNameSchema = z.enum([
  "home.card_impression",
  "home.card_click",
  "surface.quick_intent_used",
  "surface.prompt_submitted",
  "statements.recurring_action",
  "source.removal",
  "source.reconnect_attempt",
  "connect.connection_success",
  "connect.connection_failure",
  "smart.low_data_exposed",
  "smart.drill_in_home_to_statements",
]);

const BodySchema = z.object({
  event: EventNameSchema,
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "smart_telemetry" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = BodySchema.parse(await req.json());

    logServerEvent("info", `smart.telemetry.${body.event}`, {
      userId: auth.auth.walletUserId,
      ...(body.context || {}),
    });
    pushSmartTelemetryEvent({
      userId: auth.auth.walletUserId,
      event: body.event,
      ...(body.context ? { context: body.context } : {}),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Failed to record Calico telemetry.";
    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent("error", "smart.telemetry.failed", { errorCode, message });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
