import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  logServerEvent,
} from "@/lib/server/observability";
import { PlaidApiError } from "@/financial_connectors/plaidClient";
import { createUserLinkToken } from "@/financial_connectors/linkService";
import { checkPlaidConfig } from "@/lib/server/plaidConfigCheck";
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
export const maxDuration = 30;

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
    // Fail fast with a clear diagnostic if Plaid env is misconfigured
    const plaidStatus = checkPlaidConfig();
    if (!plaidStatus.ready) {
      logServerEvent("error", "connect.create_link_token.config_check_failed", {
        missing: plaidStatus.missing,
        warnings: plaidStatus.warnings,
      });
      return NextResponse.json(
        apiError("UNKNOWN_FAILURE", "Account linking is not available. Please contact support.", false),
        { status: 503 },
      );
    }

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

    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => issue.message).join("; ");
      logServerEvent("error", "connect.create_link_token.failed", {
        status: 400,
        errorCode: "VALIDATION_ERROR",
        message,
      });
      return NextResponse.json(apiError("VALIDATION_ERROR", message, true), { status: 400 });
    }

    if (error instanceof PlaidApiError) {
      logServerEvent("error", "connect.create_link_token.failed", {
        status: 502,
        plaidErrorCode: error.errorCode,
        plaidErrorType: error.errorType,
        plaidRequestId: error.requestId,
        internalMessage: error.message,
      });

      // Map known Plaid error codes to safe, user-friendly messages
      let userMessage = error.displayMessage;
      if (!userMessage) {
        switch (error.errorCode) {
          case "INVALID_API_KEYS":
            userMessage = "Account linking is temporarily unavailable. Please contact support.";
            break;
          case "INVALID_FIELD":
          case "MISSING_FIELDS":
            userMessage = "Account linking configuration error. Please contact support.";
            break;
          case "INSTITUTION_NOT_FOUND":
          case "INSTITUTION_NOT_RESPONDING":
          case "INSTITUTION_DOWN":
            userMessage = "This bank is temporarily unavailable. Please try again later.";
            break;
          default:
            userMessage = "Unable to start account linking. Please try again.";
        }
      }

      const recoverable = error.errorCode !== "INVALID_API_KEYS";
      return NextResponse.json(
        { ...apiError("UNKNOWN_FAILURE", userMessage, recoverable), plaidErrorCode: error.errorCode },
        { status: 502 },
      );
    }

    const rawMessage = error instanceof Error ? error.message : "Failed to create link token.";
    const isConfigError = /missing required secret|invalid or missing plaid_env/i.test(rawMessage);
    const message = isConfigError
      ? "Account linking is not available. Please contact support."
      : rawMessage;
    const status = isConfigError ? 503 : 500;

    logServerEvent("error", "connect.create_link_token.failed", {
      status,
      errorCode: "UNKNOWN_FAILURE",
      internalMessage: rawMessage,
    });

    return NextResponse.json(apiError("UNKNOWN_FAILURE", message, !isConfigError), { status });
  }
}
