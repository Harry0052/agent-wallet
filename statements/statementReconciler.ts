import "server-only";

import { query } from "@/lib/server/db";
import { logServerEvent } from "@/lib/server/observability";

/* ─── Types ──────────────────────────────────────────────────────── */

export interface ReconciliationResult {
  totalExtracted: number;
  exactMatches: number;
  likelyMatches: number;
  noMatches: number;
  ambiguous: number;
  newUnifiedEntries: number;
}

interface ExtractedTransactionRow {
  id: string;
  user_id: string;
  plaid_account_id: string | null;
  posted_date: string;
  description_raw: string;
  description_normalized: string;
  amount: string;
  currency: string;
}

interface CandidateRow {
  id: string;
  linked_account_id: string;
  merchant_name: string;
  normalized_merchant: string;
  amount: string;
  occurred_at: string;
}

type MatchQuality = "exact_match" | "likely_match" | "no_match" | "ambiguous";

/* ─── Description similarity ─────────────────────────────────────── */

function normalizeForComparison(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): Set<string> {
  const normalized = normalizeForComparison(s);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter(Boolean));
}

/**
 * Jaccard-style token overlap: |intersection| / |union|.
 * Returns 0-1 score.
 */
export function descriptionSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersectionSize++;
  }

  const unionSize = new Set([...tokensA, ...tokensB]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

/* ─── Single-transaction matching ────────────────────────────────── */

function daysDifference(dateA: string, dateB: string): number {
  const msA = new Date(dateA).getTime();
  const msB = new Date(dateB).getTime();
  return Math.abs(msA - msB) / (1000 * 60 * 60 * 24);
}

function amountMatches(extractedAmt: number, candidateAmt: number): boolean {
  return Math.abs(Math.abs(extractedAmt) - Math.abs(candidateAmt)) <= 0.01;
}

function scoreCandidate(
  extracted: ExtractedTransactionRow,
  candidate: CandidateRow,
): MatchQuality {
  const extractedAmount = Number(extracted.amount);
  const candidateAmount = Number(candidate.amount);

  if (!amountMatches(extractedAmount, candidateAmount)) {
    return "no_match";
  }

  const days = daysDifference(extracted.posted_date, candidate.occurred_at);
  const similarity = descriptionSimilarity(
    extracted.description_normalized || extracted.description_raw,
    candidate.normalized_merchant || candidate.merchant_name,
  );

  // Exact: same amount + same date + description similarity > 0.8
  if (days === 0 && similarity > 0.8) return "exact_match";

  // Likely: same amount + date within 2 days + description similarity > 0.5
  if (days <= 2 && similarity > 0.5) return "likely_match";

  // Ambiguous: same amount but date > 2 days or low description similarity
  if (days <= 3) return "ambiguous";

  return "ambiguous";
}

/* ─── Core reconciliation ────────────────────────────────────────── */

async function matchExtractedTransaction(
  extracted: ExtractedTransactionRow,
): Promise<{ quality: MatchQuality; matchedLiveId: string | null }> {
  // Search for candidate live transactions: same user, overlapping account,
  // date within +/-3 days, same absolute amount (within $0.01).
  const postedDate = extracted.posted_date;
  const absAmount = Math.abs(Number(extracted.amount));

  const accountClause = extracted.plaid_account_id
    ? "AND t.linked_account_id = $2"
    : "";
  const dateParamIdx = extracted.plaid_account_id ? 3 : 2;

  const params: unknown[] = [extracted.user_id];
  if (extracted.plaid_account_id) {
    params.push(extracted.plaid_account_id);
  }
  params.push(postedDate); // dateParamIdx
  params.push(absAmount);  // dateParamIdx + 1

  const candidates = await query<CandidateRow>(
    `
      SELECT
        t.id,
        t.linked_account_id,
        t.merchant_name,
        t.normalized_merchant,
        t.amount::text,
        t.occurred_at::text
      FROM transactions t
      WHERE t.user_id = $1
        ${accountClause}
        AND t.occurred_at >= ($${dateParamIdx}::date - INTERVAL '3 days')
        AND t.occurred_at < ($${dateParamIdx}::date + INTERVAL '4 days')
        AND ABS(t.amount) BETWEEN ($${dateParamIdx + 1}::numeric - 0.01)
                                AND ($${dateParamIdx + 1}::numeric + 0.01)
      ORDER BY t.occurred_at DESC
      LIMIT 10
    `,
    params,
  );

  if (candidates.rows.length === 0) {
    return { quality: "no_match", matchedLiveId: null };
  }

  // Score each candidate and pick the best
  let bestQuality: MatchQuality = "no_match";
  let bestCandidateId: string | null = null;
  const qualityRank: Record<MatchQuality, number> = {
    exact_match: 3,
    likely_match: 2,
    ambiguous: 1,
    no_match: 0,
  };

  for (const candidate of candidates.rows) {
    const quality = scoreCandidate(extracted, candidate);
    if (qualityRank[quality] > qualityRank[bestQuality]) {
      bestQuality = quality;
      bestCandidateId = candidate.id;
    }
  }

  return { quality: bestQuality, matchedLiveId: bestCandidateId };
}

/* ─── Public API ─────────────────────────────────────────────────── */

/**
 * Reconcile all extracted transactions from a statement document
 * against live Plaid transactions to prevent double-counting.
 */
export async function reconcileStatementDocument(params: {
  userId: string;
  statementDocumentId: string;
}): Promise<ReconciliationResult> {
  const { userId, statementDocumentId } = params;

  logServerEvent("info", "reconciliation_started", {
    userId,
    statementDocumentId,
  });

  // 1. Load all extracted transactions for this document
  const extractedResult = await query<ExtractedTransactionRow>(
    `
      SELECT
        id,
        user_id,
        plaid_account_id,
        posted_date::text,
        description_raw,
        description_normalized,
        amount::text,
        currency
      FROM statement_extracted_transactions
      WHERE user_id = $1
        AND statement_document_id = $2
    `,
    [userId, statementDocumentId],
  );

  const extracted = extractedResult.rows;
  const result: ReconciliationResult = {
    totalExtracted: extracted.length,
    exactMatches: 0,
    likelyMatches: 0,
    noMatches: 0,
    ambiguous: 0,
    newUnifiedEntries: 0,
  };

  if (extracted.length === 0) {
    await updateDocumentReconcileStatus(statementDocumentId, "reconciled");
    return result;
  }

  // 2. Match each extracted transaction against live transactions
  for (const row of extracted) {
    const match = await matchExtractedTransaction(row);

    switch (match.quality) {
      case "exact_match":
        result.exactMatches++;
        // Live transaction takes priority -- hide the statement-derived one
        await updateExtractedMatch(row.id, match.matchedLiveId, "exact_match", false);
        break;

      case "likely_match":
        result.likelyMatches++;
        // Live transaction takes priority
        await updateExtractedMatch(row.id, match.matchedLiveId, "likely_match", false);
        break;

      case "ambiguous":
        result.ambiguous++;
        // Keep visible but mark as ambiguous
        await updateExtractedMatch(row.id, match.matchedLiveId, "ambiguous", true);
        result.newUnifiedEntries++;
        break;

      case "no_match":
        result.noMatches++;
        // Statement-only historical data -- keep visible
        await updateExtractedMatch(row.id, null, "no_match", true);
        result.newUnifiedEntries++;
        break;
    }
  }

  // 3. Update document reconcile_status
  const status =
    result.ambiguous > 0 ? "partially_reconciled" : "reconciled";
  await updateDocumentReconcileStatus(statementDocumentId, status);

  logServerEvent("info", "reconciliation_completed", {
    userId,
    statementDocumentId,
    ...result,
  });

  return result;
}

/**
 * Run reconciliation for all unreconciled statement documents for a user.
 */
export async function reconcileAllForUser(userId: string): Promise<{
  documentsProcessed: number;
  totalResult: ReconciliationResult;
}> {
  const pendingDocs = await query<{ id: string }>(
    `
      SELECT id
      FROM statement_documents
      WHERE user_id = $1
        AND reconcile_status = 'pending'
        AND parse_status = 'parsed'
      ORDER BY year, month
    `,
    [userId],
  );

  const totalResult: ReconciliationResult = {
    totalExtracted: 0,
    exactMatches: 0,
    likelyMatches: 0,
    noMatches: 0,
    ambiguous: 0,
    newUnifiedEntries: 0,
  };

  for (const doc of pendingDocs.rows) {
    try {
      const docResult = await reconcileStatementDocument({
        userId,
        statementDocumentId: doc.id,
      });
      totalResult.totalExtracted += docResult.totalExtracted;
      totalResult.exactMatches += docResult.exactMatches;
      totalResult.likelyMatches += docResult.likelyMatches;
      totalResult.noMatches += docResult.noMatches;
      totalResult.ambiguous += docResult.ambiguous;
      totalResult.newUnifiedEntries += docResult.newUnifiedEntries;
    } catch (err) {
      logServerEvent("error", "reconciliation_document_failed", {
        userId,
        statementDocumentId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await updateDocumentReconcileStatus(doc.id, "failed");
    }
  }

  return {
    documentsProcessed: pendingDocs.rows.length,
    totalResult,
  };
}

/* ─── Internal helpers ───────────────────────────────────────────── */

async function updateExtractedMatch(
  extractedId: string,
  matchedLiveId: string | null,
  matchQuality: MatchQuality,
  visibleInUnified: boolean,
): Promise<void> {
  await query(
    `
      UPDATE statement_extracted_transactions
      SET matched_live_transaction_id = $1,
          match_quality = $2,
          visible_in_unified = $3,
          updated_at = NOW()
      WHERE id = $4
    `,
    [matchedLiveId, matchQuality, visibleInUnified, extractedId],
  );
}

async function updateDocumentReconcileStatus(
  documentId: string,
  status: "pending" | "reconciled" | "partially_reconciled" | "failed",
): Promise<void> {
  await query(
    `
      UPDATE statement_documents
      SET reconcile_status = $1,
          updated_at = NOW()
      WHERE id = $2
    `,
    [status, documentId],
  );
}
