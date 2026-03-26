import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { listConnectorItemSecretsForUser } from "@/financial_connectors/tokenVault";
import { runStatementPipeline } from "@/statements/statementSync";
import { reconcileAllForUser } from "@/statements/statementReconciler";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  item_id: z.string().trim().min(1, "item_id is required"),
});

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "connect" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const body = BodySchema.parse(await req.json());

    // Look up the item to get the decrypted access token
    const secrets = await listConnectorItemSecretsForUser(userId);
    const item = secrets.find((s) => s.plaid_item_id === body.item_id);

    if (!item) {
      return NextResponse.json(
        apiError("NOT_FOUND", "Connected item not found.", true),
        { status: 404 },
      );
    }

    // Run the statement pipeline: metadata sync + download + parse
    const pipelineResult = await runStatementPipeline({
      userId,
      itemId: item.plaid_item_id,
      plaidItemId: item.plaid_item_id,
      accessToken: item.plaid_access_token,
      institutionId: null,
      institutionName: null,
    });

    // Reconcile extracted transactions against live data
    const reconcileResult = await reconcileAllForUser(userId);

    logServerEvent("info", "connect.statements.sync.completed", {
      userId,
      itemId: body.item_id,
      metadataSynced: pipelineResult.metadataSynced,
      downloaded: pipelineResult.downloaded,
      documentsReconciled: reconcileResult.documentsProcessed,
    });

    return NextResponse.json({
      ok: true,
      pipeline: pipelineResult,
      reconciliation: reconcileResult,
    });
  } catch (error) {
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
          : "Failed to sync statements.";
    const status = message.toLowerCase().includes("not found")
      ? 404
      : message.toLowerCase().includes("invalid ")
        ? 400
        : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent("error", "connect.statements.sync.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
