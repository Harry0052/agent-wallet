import { NextRequest, NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import { listNormalizedTransactions } from "@/transactions/transactionRepository";
import { syncPlaidTransactionsForUser } from "@/transactions/transactionSync";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "transactions" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const transactions = await listNormalizedTransactions({ userId, limit: 250 });
    return NextResponse.json({
      ok: true,
      transactions,
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
        : "Failed to list normalized statement transactions.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.transactions.list.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "transactions" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const sync = await syncPlaidTransactionsForUser(userId);
    const transactions = await listNormalizedTransactions({ userId, limit: 250 });

    return NextResponse.json({
      ok: true,
      sync,
      transactions,
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
        : "Failed to sync normalized statement transactions.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.transactions.sync.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
