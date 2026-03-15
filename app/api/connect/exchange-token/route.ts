import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
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

    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join("; ")
        : error instanceof Error
          ? error.message
          : "Failed to exchange Plaid public token.";
    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent("error", "connect.exchange_token.failed", {
      status,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
