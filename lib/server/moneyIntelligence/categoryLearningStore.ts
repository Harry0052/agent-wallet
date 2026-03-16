import 'server-only';

import { randomUUID } from 'node:crypto';
import { query } from '@/lib/server/db';
import type { MoneyCategoryRule } from '@/lib/server/moneyIntelligence/types';

export interface CorrectionRow {
  id: string;
  user_id: string;
  transaction_id: string | null;
  normalized_merchant: string;
  original_category: string;
  corrected_category: string;
  created_at: string;
}

interface RuleAggRow {
  normalized_merchant: string;
  corrected_category: string;
  support_count: string;
  total_corrections: string;
  last_corrected_at: string;
}

declare global {
  var __moneyIntelligenceCategorySchemaInitPromise: Promise<void> | undefined;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export async function ensureMoneyCategoryLearningSchema(): Promise<void> {
  if (globalThis.__moneyIntelligenceCategorySchemaInitPromise) {
    return globalThis.__moneyIntelligenceCategorySchemaInitPromise;
  }

  globalThis.__moneyIntelligenceCategorySchemaInitPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS statement_category_corrections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        transaction_id TEXT,
        normalized_merchant TEXT NOT NULL,
        original_category TEXT NOT NULL,
        corrected_category TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_statement_category_corrections_user_merchant
      ON statement_category_corrections (user_id, normalized_merchant, created_at DESC);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_statement_category_corrections_user_created
      ON statement_category_corrections (user_id, created_at DESC);
    `);
  })();

  return globalThis.__moneyIntelligenceCategorySchemaInitPromise;
}

export async function recordCategoryCorrection(input: {
  userId: string;
  normalizedMerchant: string;
  originalCategory: string;
  correctedCategory: string;
  transactionId?: string;
}): Promise<{ recorded: boolean }> {
  await ensureMoneyCategoryLearningSchema();

  const normalizedMerchant = normalizeText(input.normalizedMerchant);
  const originalCategory = normalizeText(input.originalCategory);
  const correctedCategory = normalizeText(input.correctedCategory);
  if (!normalizedMerchant || !correctedCategory) {
    throw new Error('normalizedMerchant and correctedCategory are required.');
  }
  if (originalCategory === correctedCategory) {
    return { recorded: false };
  }

  const result = await query<{ id: string }>(
    `
      INSERT INTO statement_category_corrections (
        id,
        user_id,
        transaction_id,
        normalized_merchant,
        original_category,
        corrected_category
      )
      SELECT
        $1,
        $2,
        $3,
        $4,
        $5,
        $6
      WHERE NOT EXISTS (
        SELECT 1
        FROM statement_category_corrections
        WHERE user_id = $2
          AND COALESCE(transaction_id, '') = COALESCE($3, '')
          AND normalized_merchant = $4
          AND original_category = $5
          AND corrected_category = $6
          AND created_at >= (NOW() - INTERVAL '24 hours')
      )
      RETURNING id
    `,
    [
      randomUUID(),
      input.userId,
      input.transactionId || null,
      normalizedMerchant,
      originalCategory || 'uncategorized',
      correctedCategory,
    ],
  );

  return { recorded: result.rows.length > 0 };
}

function toRule(row: RuleAggRow): MoneyCategoryRule {
  const supportCount = Number.parseInt(row.support_count, 10) || 0;
  const totalCorrections = Number.parseInt(row.total_corrections, 10) || 0;
  const dominanceRatio = totalCorrections > 0 ? supportCount / totalCorrections : 0;

  const base = 0.45 + Math.min(supportCount, 8) * 0.05;
  const dominanceBoost = Math.max(0, dominanceRatio - 0.75) * 0.5;
  const confidence = Math.min(0.95, base + dominanceBoost);
  const status = supportCount >= 2 && dominanceRatio >= 0.75 ? 'active' : 'pending';

  return {
    normalizedMerchant: row.normalized_merchant,
    learnedCategory: row.corrected_category,
    supportCount,
    totalCorrections,
    dominanceRatio: Math.round(dominanceRatio * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    lastCorrectedAt: row.last_corrected_at,
    status,
  };
}

export async function listCategoryLearningRules(
  userId: string,
): Promise<MoneyCategoryRule[]> {
  await ensureMoneyCategoryLearningSchema();

  const result = await query<RuleAggRow>(
    `
      WITH grouped AS (
        SELECT
          normalized_merchant,
          corrected_category,
          COUNT(*)::text AS support_count,
          MAX(created_at)::text AS last_corrected_at
        FROM statement_category_corrections
        WHERE user_id = $1
        GROUP BY normalized_merchant, corrected_category
      ),
      totals AS (
        SELECT
          normalized_merchant,
          COUNT(*)::text AS total_corrections
        FROM statement_category_corrections
        WHERE user_id = $1
        GROUP BY normalized_merchant
      ),
      ranked AS (
        SELECT
          g.normalized_merchant,
          g.corrected_category,
          g.support_count,
          t.total_corrections,
          g.last_corrected_at,
          ROW_NUMBER() OVER (
            PARTITION BY g.normalized_merchant
            ORDER BY (g.support_count)::int DESC, g.last_corrected_at DESC
          ) AS rn
        FROM grouped g
        JOIN totals t
          ON t.normalized_merchant = g.normalized_merchant
      )
      SELECT
        normalized_merchant,
        corrected_category,
        support_count,
        total_corrections,
        last_corrected_at
      FROM ranked
      WHERE rn = 1
      ORDER BY normalized_merchant ASC
      LIMIT 200
    `,
    [userId],
  );

  return result.rows.map(toRule);
}

export async function listRecentCategoryCorrections(
  userId: string,
  limit = 50,
): Promise<CorrectionRow[]> {
  await ensureMoneyCategoryLearningSchema();
  const bounded = Math.max(1, Math.min(limit, 200));

  const result = await query<CorrectionRow>(
    `
      SELECT
        id,
        user_id,
        transaction_id,
        normalized_merchant,
        original_category,
        corrected_category,
        created_at::text
      FROM statement_category_corrections
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, bounded],
  );

  return result.rows;
}
