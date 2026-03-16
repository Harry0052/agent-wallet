import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { apiError, classifyTaskError, logServerEvent } from "@/lib/server/observability";
import {
  dismissFinancialOsNotification,
  getFinancialOsNotifications,
} from "@/lib/server/financialOs/dashboard";
import { isAuthError } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const patchSchema = z.object({
  notificationId: z.string().trim().min(1),
  action: z.literal("dismiss"),
});

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "financial_os_notifications" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const parsed = querySchema.parse({
      limit: req.nextUrl.searchParams.get("limit") || undefined,
    });
    const notifications = await getFinancialOsNotifications({
      userId: auth.auth.walletUserId,
      limit: parsed.limit,
    });
    return NextResponse.json({
      ok: true,
      notifications,
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
    const message = error instanceof Error ? error.message : "Failed to load financial notifications.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "financial_os.notifications.get.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "financial_os_notifications" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const parsed = patchSchema.parse(await req.json());
    const dismissed = await dismissFinancialOsNotification({
      userId: auth.auth.walletUserId,
      notificationId: parsed.notificationId,
    });
    return NextResponse.json({
      ok: true,
      dismissed,
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
    const message = error instanceof Error ? error.message : "Failed to update financial notification.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "financial_os.notifications.patch.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
