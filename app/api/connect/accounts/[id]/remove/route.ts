import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { removeConnectedAccount } from "@/financial_connectors/institutionService";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { enforceSecurityIpBlock } from "@/security/securityMonitor";
import { apiError, classifyTaskError, logServerEvent } from "@/lib/server/observability";

const ParamsSchema = z.object({
  id: z.string().trim().min(1, "Account ID is required"),
});

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "connect" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const params = ParamsSchema.parse(await context.params);
    const result = await removeConnectedAccount({
      userId: auth.auth.walletUserId,
      accountId: params.id,
    });

    logServerEvent("info", "connect.accounts.remove.success", {
      userId: auth.auth.walletUserId,
      accountId: params.id,
      removed: result.removed,
      removedItem: result.removedItem,
    });
    logServerEvent("info", "smart.telemetry.source.removal", {
      userId: auth.auth.walletUserId,
      sourceType: "connected_account",
      accountId: params.id,
      outcome: "success",
    });

    return NextResponse.json({
      ok: true,
      removed: result.removed,
      removedItem: result.removedItem,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Failed to remove connected account";
    const errorCode = classifyTaskError({ message: rawMessage });
    logServerEvent("info", "smart.telemetry.source.removal", {
      userId: auth.auth.walletUserId,
      sourceType: "connected_account",
      outcome: "failure",
    });
    logServerEvent("error", "connect.accounts.remove.failed", { errorCode, message: rawMessage });
    const clientMessage = /database|pool|connection|timeout|internal/i.test(rawMessage)
      ? "Service temporarily unavailable. Please try again."
      : "Failed to remove connected account. Please try again.";
    return NextResponse.json(apiError(errorCode, clientMessage, true), { status: 500 });
  }
}
