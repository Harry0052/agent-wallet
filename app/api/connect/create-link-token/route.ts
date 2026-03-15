import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import { createUserLinkToken } from "@/financial_connectors/linkService";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { RequestValidationError, validateJsonBody } from "@/security/requestValidator";
import {
  enforceSecurityIpBlock,
  monitorAccountLinkAttempt,
  monitorApiAbuse,
  resolveClientIp,
} from "@/security/securityMonitor";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    countryCodes: z.array(z.string().trim().min(2)).optional(),
  })
  .optional();

export async function POST(req: NextRequest) {
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "connect" });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(req),
      path: req.nextUrl.pathname,
      reason: 'connect_create_link_token_rate_limited',
    });
    return rateLimited;
  }

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await validateJsonBody(req, BodySchema, { allowEmptyBody: true });
    const userId = auth.auth.walletUserId;
    const ip = resolveClientIp(req);

    const token = await createUserLinkToken(userId);
    monitorAccountLinkAttempt({
      userId,
      ip,
      success: true,
      phase: 'create_link_token',
    });
    logServerEvent("info", "smart.telemetry.source.reconnect_attempt", {
      userId,
      sourceType: "connected_account",
      phase: "create_link_token",
      outcome: "success",
    });

    logServerEvent("info", "connect.create_link_token.success", {
      userId,
      countryCodeCount: body?.countryCodes?.length || 0,
    });

    return NextResponse.json({
      ok: true,
      link_token: token.linkToken,
      expiration: token.expiration,
    });
  } catch (error) {
    if (auth.ok) {
      monitorAccountLinkAttempt({
        userId: auth.auth.walletUserId,
        ip: resolveClientIp(req),
        success: false,
        phase: 'create_link_token',
      });
      logServerEvent("info", "smart.telemetry.source.reconnect_attempt", {
        userId: auth.auth.walletUserId,
        sourceType: "connected_account",
        phase: "create_link_token",
        outcome: "failure",
      });
    }

    if (error instanceof RequestValidationError) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }

    const rawMessage = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Failed to create Plaid link token.";

    // Do not leak secret/config details to the client
    const isConfigError = /missing required secret|plaid_client_id|plaid_secret/i.test(rawMessage);
    const message = isConfigError
      ? "Account linking is not available. Please contact support."
      : rawMessage;
    const status = error instanceof z.ZodError ? 400 : isConfigError ? 503 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent("error", "connect.create_link_token.failed", {
      status,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
