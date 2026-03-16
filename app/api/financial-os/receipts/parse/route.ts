import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { apiError, classifyTaskError, logServerEvent } from "@/lib/server/observability";
import { parseReceiptText } from "@/lib/server/financialOs/receiptParser";
import { isAuthError } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  rawText: z.string().trim().min(1).max(20000),
  enableFallback: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "financial_os_receipts" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const parsed = bodySchema.parse(await req.json());
    const receipt = await parseReceiptText({
      rawText: parsed.rawText,
      enableFallback: parsed.enableFallback,
    });

    return NextResponse.json({
      ok: true,
      receipt,
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
    const message = error instanceof Error ? error.message : "Receipt parsing failed.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "financial_os.receipts.parse.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
