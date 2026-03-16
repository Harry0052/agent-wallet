import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, classifyTaskError, logServerEvent } from "@/lib/server/observability";
import {
  listCategoryLearningRules,
  listRecentCategoryCorrections,
  recordCategoryCorrection,
} from "@/lib/server/moneyIntelligence/categoryLearningStore";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const BodySchema = z.object({
  transactionId: z.string().trim().min(1).max(128).optional(),
  normalizedMerchant: z.string().trim().min(1).max(160),
  originalCategory: z.string().trim().min(1).max(80),
  correctedCategory: z.string().trim().min(1).max(80),
});

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, {
    profile: "general",
    scope: "statement_category_corrections",
  });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const parsed = QuerySchema.parse({
      limit: req.nextUrl.searchParams.get("limit") ?? undefined,
    });
    const limit = parsed.limit ?? 30;
    const [rules, corrections] = await Promise.all([
      listCategoryLearningRules(auth.auth.walletUserId),
      listRecentCategoryCorrections(auth.auth.walletUserId, limit),
    ]);

    return NextResponse.json({
      ok: true,
      rules,
      corrections: corrections.map((item) => ({
        id: item.id,
        transaction_id: item.transaction_id,
        normalized_merchant: item.normalized_merchant,
        original_category: item.original_category,
        corrected_category: item.corrected_category,
        created_at: item.created_at,
      })),
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Failed to load category corrections.";
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent("error", "statements.category_corrections.get.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, {
    profile: "general",
    scope: "statement_category_corrections",
  });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = BodySchema.parse(await req.json());
    const normalizedMerchant = body.normalizedMerchant.trim().toLowerCase();
    const originalCategory = body.originalCategory.trim().toLowerCase();
    const correctedCategory = body.correctedCategory.trim().toLowerCase();

    const correction = await recordCategoryCorrection({
      userId: auth.auth.walletUserId,
      transactionId: body.transactionId,
      normalizedMerchant,
      originalCategory,
      correctedCategory,
    });
    const rules = await listCategoryLearningRules(auth.auth.walletUserId);
    const matchedRule = rules.find((rule) => rule.normalizedMerchant === normalizedMerchant) || null;

    return NextResponse.json({
      ok: true,
      recorded: correction.recorded,
      ruleStatus: matchedRule?.status ?? "pending",
      rule: matchedRule,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Failed to save category correction.";
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent("error", "statements.category_corrections.post.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}
