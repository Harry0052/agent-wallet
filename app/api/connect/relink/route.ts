import { NextRequest, NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import { createRelinkToken, completeRelink, createNewAccountsToken, completeNewAccountsReview } from "@/financial_connectors/linkService";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST: Create a link token in update mode for relinking */
export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "connect" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      plaid_item_id?: string;
      action?: "create_token" | "complete" | "new_accounts" | "complete_new_accounts";
    };

    const plaidItemId = body.plaid_item_id?.trim();
    if (!plaidItemId) {
      return NextResponse.json(
        apiError("VALIDATION_ERROR", "plaid_item_id is required.", true),
        { status: 400 },
      );
    }

    const userId = auth.auth.walletUserId;
    const action = body.action || "create_token";

    if (action === "complete") {
      const result = await completeRelink({ userId, plaidItemId });

      logServerEvent("info", "connect.relink.route.completed", {
        userId,
        plaidItemId,
      });

      return NextResponse.json({
        ok: true,
        action: "completed",
        accounts: result.accounts,
        institutions: result.institutions,
      });
    }

    // New accounts: create update-mode token with account_selection_enabled
    if (action === "new_accounts") {
      const token = await createNewAccountsToken({ userId, plaidItemId });

      logServerEvent("info", "connect.relink.route.new_accounts_token_created", {
        userId,
        plaidItemId,
      });

      return NextResponse.json({
        ok: true,
        action: "new_accounts_token_created",
        link_token: token.linkToken,
        expiration: token.expiration,
      });
    }

    // Complete new accounts review: clear flag and refresh accounts
    if (action === "complete_new_accounts") {
      const result = await completeNewAccountsReview({ userId, plaidItemId });

      logServerEvent("info", "connect.relink.route.new_accounts_completed", {
        userId,
        plaidItemId,
      });

      return NextResponse.json({
        ok: true,
        action: "new_accounts_completed",
        accounts: result.accounts,
        institutions: result.institutions,
      });
    }

    // Default: create a relink token
    const token = await createRelinkToken({ userId, plaidItemId });

    logServerEvent("info", "connect.relink.route.token_created", {
      userId,
      plaidItemId,
    });

    return NextResponse.json({
      ok: true,
      action: "token_created",
      link_token: token.linkToken,
      expiration: token.expiration,
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
        : "Failed to process relink request.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.relink.route.failed", { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
