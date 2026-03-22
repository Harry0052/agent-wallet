import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  logServerEvent,
} from "@/lib/server/observability";
import { PlaidApiError } from "@/financial_connectors/plaidClient";
import { exchangePublicTokenForAccounts } from "@/financial_connectors/linkService";
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

const BodySchema = z.object({
  public_token: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "connect" });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(req),
      path: req.nextUrl.pathname,
      reason: 'connect_exchange_token_rate_limited',
    });
    return rateLimited;
  }

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await validateJsonBody(req, BodySchema);
    const userId = auth.auth.walletUserId;
    const ip = resolveClientIp(req);

    const exchanged = await exchangePublicTokenForAccounts({
      userId,
      publicToken: body.public_token,
    });
    monitorAccountLinkAttempt({
      userId,
      ip,
      success: true,
      phase: 'exchange_token',
    });
    logServerEvent("info", "smart.telemetry.connect.connection_success", {
      userId,
      sourceType: "connected_account",
      accountCount: exchanged.accounts.length,
      institutionCount: exchanged.institutions.length,
    });

    logServerEvent("info", "connect.exchange_token.success", {
      userId,
      accountCount: exchanged.accounts.length,
      institutionCount: exchanged.institutions.length,
    });

    return NextResponse.json({
      ok: true,
      accounts: exchanged.accounts,
      institutions: exchanged.institutions,
    });
  } catch (error) {
    if (auth.ok) {
      monitorAccountLinkAttempt({
        userId: auth.auth.walletUserId,
        ip: resolveClientIp(req),
        success: false,
        phase: 'exchange_token',
      });
      logServerEvent("info", "smart.telemetry.connect.connection_failure", {
        userId: auth.auth.walletUserId,
        sourceType: "connected_account",
      });
    }

    if (error instanceof RequestValidationError) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), { status: error.status });
    }
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }

    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => issue.message).join("; ");
      logServerEvent("error", "connect.exchange_token.failed", {
        status: 400,
        errorCode: "VALIDATION_ERROR",
        message,
      });
      return NextResponse.json(apiError("VALIDATION_ERROR", message, true), { status: 400 });
    }

    if (error instanceof PlaidApiError) {
      const userMessage = error.displayMessage || "Account linking failed. Please try again.";
      logServerEvent("error", "connect.exchange_token.failed", {
        status: 502,
        plaidErrorCode: error.errorCode,
        plaidErrorType: error.errorType,
        plaidRequestId: error.requestId,
        internalMessage: error.message,
      });
      return NextResponse.json(
        { ...apiError("UNKNOWN_FAILURE", userMessage, true), plaidErrorCode: error.errorCode },
        { status: 502 },
      );
    }

    const rawMessage = error instanceof Error ? error.message : "Failed to exchange token.";
    const isConfigError = /missing required secret/i.test(rawMessage);
    const message = isConfigError
      ? "Account linking is not available. Please contact support."
      : rawMessage;
    const status = isConfigError ? 503 : 500;

    logServerEvent("error", "connect.exchange_token.failed", {
      status,
      errorCode: "UNKNOWN_FAILURE",
      internalMessage: rawMessage,
    });

    return NextResponse.json(apiError("UNKNOWN_FAILURE", message, !isConfigError), { status });
  }
}
