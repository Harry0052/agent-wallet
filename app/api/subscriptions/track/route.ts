import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import {
  listRecurringIntelligence,
  updateRecurringSubscriptionStatus,
  upsertManualRecurringSubscription,
} from "@/subscription_intelligence/subscriptionService";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_status"),
    subscriptionId: z.string().trim().min(1),
    status: z.enum(["confirmed", "ignored", "inactive"]),
  }),
  z.object({
    action: z.literal("manual_add"),
    merchant: z.string().trim().min(1),
    estimatedMonthlyCost: z.number().positive(),
    recurrenceInterval: z.string().trim().optional(),
  }),
]);

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "subscriptions" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  let action: "set_status" | "manual_add" | undefined;
  try {
    const body = BodySchema.parse(await req.json());
    action = body.action;
    const userId = auth.auth.walletUserId;
    let resultMeta: {
      action: "set_status" | "manual_add";
      status?: "confirmed" | "ignored" | "inactive";
      subscriptionId?: string;
      merchant?: string;
    };

    if (body.action === "set_status") {
      await updateRecurringSubscriptionStatus({
        userId,
        subscriptionId: body.subscriptionId,
        status: body.status,
      });
      resultMeta = {
        action: "set_status",
        status: body.status,
        subscriptionId: body.subscriptionId,
      };
      logServerEvent("info", "smart.telemetry.statements.recurring_action", {
        userId,
        action: body.status,
        source: "subscriptions.track",
        outcome: "success",
        subscriptionId: body.subscriptionId,
      });
    } else {
      await upsertManualRecurringSubscription({
        userId,
        merchant: body.merchant,
        estimatedMonthlyCost: body.estimatedMonthlyCost,
        ...(body.recurrenceInterval ? { recurrenceInterval: body.recurrenceInterval } : {}),
      });
      resultMeta = {
        action: "manual_add",
        merchant: body.merchant,
      };
      logServerEvent("info", "smart.telemetry.statements.recurring_action", {
        userId,
        action: "manual_add",
        source: "subscriptions.track",
        outcome: "success",
        merchant: body.merchant,
      });
    }

    const subscriptions = await listRecurringIntelligence({ userId });
    return NextResponse.json({
      ok: true,
      result: resultMeta,
      subscriptions,
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
          : "Failed to update recurring intelligence.";
    const status = error instanceof z.ZodError
      ? 400
      : message.toLowerCase().includes("not found")
        ? 404
        : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent("info", "smart.telemetry.statements.recurring_action", {
      userId: auth.auth.walletUserId,
      source: "subscriptions.track",
      outcome: "failure",
      ...(action ? { action } : {}),
    });
    logServerEvent("error", "subscriptions.track.failed", {
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
