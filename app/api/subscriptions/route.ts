import { NextRequest, NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import {
  detectAndPersistRecurringSubscriptions,
  listSubscriptions,
} from "@/subscription_intelligence/subscriptionService";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "subscriptions" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    await detectAndPersistRecurringSubscriptions(userId);
    const subscriptions = await listSubscriptions({ userId });

    return NextResponse.json({
      ok: true,
      subscriptions,
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
        : "Failed to detect recurring subscriptions.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "subscriptions.detect.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
