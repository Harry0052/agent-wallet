import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { apiError, classifyTaskError, logServerEvent } from "@/lib/server/observability";
import {
  createFinancialDocumentStorageHook,
  getFinancialDocumentStorageHooks,
} from "@/lib/server/financialOs/dashboard";
import { isAuthError } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const postSchema = z.object({
  documentType: z.enum(["statement", "bill", "receipt", "confirmation"]),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(120),
  sourceHash: z.string().trim().max(240).optional(),
  storageProvider: z.string().trim().max(120).optional(),
  storageReference: z.string().trim().max(2000).optional(),
  metadata: z.record(z.any()).optional(),
});

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "financial_os_documents" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const parsed = querySchema.parse({
      limit: req.nextUrl.searchParams.get("limit") || undefined,
    });
    const payload = await getFinancialDocumentStorageHooks({
      userId: auth.auth.walletUserId,
      limit: parsed.limit,
    });
    return NextResponse.json({
      ok: true,
      ...payload,
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
    const message = error instanceof Error ? error.message : "Failed to load document hooks.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "financial_os.documents.get.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "financial_os_documents" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const parsed = postSchema.parse(await req.json());
    const document = await createFinancialDocumentStorageHook({
      userId: auth.auth.walletUserId,
      documentType: parsed.documentType,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      sourceHash: parsed.sourceHash,
      storageProvider: parsed.storageProvider,
      storageReference: parsed.storageReference,
      metadata: parsed.metadata,
    });

    return NextResponse.json({
      ok: true,
      document,
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
    const message = error instanceof Error ? error.message : "Failed to create document hook.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "financial_os.documents.post.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
