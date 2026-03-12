import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/server/db";
import { isAuthError } from "@/lib/server/auth";
import { getWalletUserId } from "@/lib/server/ledger";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import {
  analyzeSpending,
} from "@/ai_spend_intelligence/spendAnalyzer";
import { adviseOnSubscriptions } from "@/ai_spend_intelligence/subscriptionAdvisor";
import { detectAnomalies } from "@/ai_spend_intelligence/anomalyDetector";
import { detectAndPersistRecurringSubscriptions } from "@/subscription_intelligence/subscriptionService";
import { ensureTransactionSchema } from "@/transactions/transactionRepository";
import { buildSafeSpendingDataset } from "@/security/aiSanitizer";
import { runInAiExecutionContext } from "@/security/secretsGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TransactionRow {
  id: string;
  linked_account_id: string;
  provider_transaction_id: string;
  merchant_name: string;
  normalized_merchant: string;
  amount: string;
  category: string;
  pending: boolean;
  occurred_at: string;
}

const BodySchema = z
  .object({
    date_from: z.string().trim().optional(),
    date_to: z.string().trim().optional(),
    include_pending: z.boolean().optional(),
    top_merchants_limit: z.number().int().min(1).max(20).optional(),
    max_transactions: z.number().int().min(10).max(2000).optional(),
  })
  .optional();

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid date value: "${value}"`);
  }
  return new Date(parsed).toISOString();
}

async function loadNormalizedTransactions(input: {
  userId: string;
  dateFrom: string | null;
  dateTo: string | null;
  includePending: boolean;
  maxTransactions: number;
}): Promise<Array<Record<string, unknown>>> {
  await ensureTransactionSchema();

  const clauses: string[] = ["user_id = $1"];
  const params: unknown[] = [input.userId];
  let idx = 2;

  if (input.dateFrom) {
    clauses.push(`occurred_at >= $${idx}::timestamptz`);
    params.push(input.dateFrom);
    idx += 1;
  }
  if (input.dateTo) {
    clauses.push(`occurred_at <= $${idx}::timestamptz`);
    params.push(input.dateTo);
    idx += 1;
  }
  if (!input.includePending) {
    clauses.push("pending = FALSE");
  }

  params.push(input.maxTransactions);
  const limitParam = `$${params.length}`;

  const result = await query<TransactionRow>(
    `
      SELECT
        id,
        linked_account_id,
        provider_transaction_id,
        merchant_name,
        normalized_merchant,
        amount::text,
        category,
        pending,
        occurred_at::text
      FROM transactions
      WHERE ${clauses.join(" AND ")}
      ORDER BY occurred_at DESC
      LIMIT ${limitParam}
    `,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    linked_account_id: row.linked_account_id,
    provider_transaction_id: row.provider_transaction_id,
    merchant_name: row.merchant_name,
    normalized_merchant: row.normalized_merchant,
    amount: Number(row.amount),
    category: row.category,
    pending: row.pending,
    occurred_at: row.occurred_at,
  }));
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getWalletUserId();
    const body = BodySchema.parse(await req.json().catch(() => ({})));

    const dateFrom = normalizeDate(body?.date_from);
    const dateTo = normalizeDate(body?.date_to);
    const includePending = body?.include_pending ?? false;
    const topMerchantLimit = body?.top_merchants_limit ?? 5;
    const maxTransactions = body?.max_transactions ?? 1000;

    const rawTransactions = await loadNormalizedTransactions({
      userId,
      dateFrom,
      dateTo,
      includePending,
      maxTransactions,
    });
    const safeDataset = buildSafeSpendingDataset(rawTransactions);

    const analysis = await runInAiExecutionContext(async () => {
      const subscriptions = await detectAndPersistRecurringSubscriptions(userId);
      const spending = analyzeSpending(safeDataset.normalizedTransactions, {
        topMerchantLimit,
      });
      const subscriptionAdvice = adviseOnSubscriptions({
        subscriptions,
        transactions: safeDataset.normalizedTransactions,
      });
      const anomalies = detectAnomalies(safeDataset.normalizedTransactions);

      return {
        spending,
        subscription_advice: subscriptionAdvice,
        anomalies,
      };
    });

    return NextResponse.json({
      ok: true,
      analysis,
      transaction_summary: {
        transaction_count: safeDataset.normalizedTransactions.length,
        date_from: dateFrom,
        date_to: dateTo,
        include_pending: includePending,
        merchant_count: safeDataset.merchantNames.length,
        aggregated_category_count: safeDataset.aggregatedSpendCategories.length,
      },
      generated_at: new Date().toISOString(),
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
          : "Failed to generate spending analysis.";
    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent("error", "ai.spending_analysis.failed", {
      status,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
