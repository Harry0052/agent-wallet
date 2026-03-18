import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import {
  handlePlaidTransactionWebhook,
  type PlaidWebhookPayload,
} from "@/transactions/transactionWebhook";
import { getOptionalSecret } from "@/security/secretsManager";

export const runtime = "nodejs";

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

// TODO: Upgrade to Plaid's official JWT-based webhook verification using the
// `Plaid-Verification` header and JWK from /webhook_verification_key/get.
// The current shared-secret approach is a temporary hardening measure.
function verifyWebhookSecret(req: NextRequest): boolean {
  const expected = getOptionalSecret("PLAID_WEBHOOK_SHARED_SECRET");
  if (!expected) {
    // In production, refuse to process webhooks without verification configured.
    const plaidEnv = process.env.PLAID_ENV?.trim().toLowerCase();
    if (plaidEnv === "production") return false;
    // Allow unverified webhooks in sandbox/development for testing convenience.
    return true;
  }
  const provided = req.headers.get("x-plaid-webhook-secret")?.trim();
  return Boolean(provided && secureEqual(provided, expected));
}

export async function POST(req: NextRequest) {
  try {
    if (!verifyWebhookSecret(req)) {
      return NextResponse.json(
        apiError("VALIDATION_ERROR", "Invalid webhook secret.", false),
        { status: 401 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as PlaidWebhookPayload;
    const result = await handlePlaidTransactionWebhook(body);

    logServerEvent("info", "connect.transactions.webhook", {
      webhookType: body.webhook_type || null,
      webhookCode: body.webhook_code || null,
      itemId: body.item_id || null,
      handled: result.handled,
      syncedItems: result.synced_items,
      syncedUsers: result.synced_users,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to process Plaid transactions webhook.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "connect.transactions.webhook.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
