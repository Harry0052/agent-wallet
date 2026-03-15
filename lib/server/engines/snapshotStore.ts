import 'server-only';

import { randomUUID } from 'node:crypto';
import { query } from '@/lib/server/db';
import { ENGINE_VERSION, RULES_VERSION } from '@/lib/server/engines/contracts';

interface HealthSnapshotRow {
  id: string;
  user_id: string;
  overall_score: string;
  spending_score: string | null;
  savings_score: string | null;
  debt_score: string | null;
  coverage_confidence: string;
  contributing_factors: string;
  source_transaction_ids: string[];
  dedup_key: string;
  engine_version: string;
  rules_version: string;
  generated_at: string;
  created_at: string;
}

interface CashFlowSnapshotRow {
  id: string;
  user_id: string;
  prediction: string;
  coverage_confidence: string;
  source_transaction_ids: string[];
  dedup_key: string;
  engine_version: string;
  rules_version: string;
  generated_at: string;
  created_at: string;
}

export interface HealthSnapshotInput {
  overallScore: number;
  spendingScore?: number;
  savingsScore?: number;
  debtScore?: number;
  coverageConfidence: number;
  contributingFactors: Array<{ factor: string; weight: number; value: string }>;
  sourceTransactionIds: string[];
  dedupKey: string;
}

export interface HealthSnapshot {
  id: string;
  userId: string;
  overallScore: number;
  spendingScore: number | null;
  savingsScore: number | null;
  debtScore: number | null;
  coverageConfidence: number;
  contributingFactors: Array<{ factor: string; weight: number; value: string }>;
  sourceTransactionIds: string[];
  dedupKey: string;
  engineVersion: string;
  rulesVersion: string;
  generatedAt: string;
}

export interface CashFlowPredictionInput {
  prediction: Record<string, unknown>;
  coverageConfidence: number;
  sourceTransactionIds: string[];
  dedupKey: string;
}

export interface CashFlowSnapshot {
  id: string;
  userId: string;
  prediction: Record<string, unknown>;
  coverageConfidence: number;
  sourceTransactionIds: string[];
  dedupKey: string;
  engineVersion: string;
  rulesVersion: string;
  generatedAt: string;
}

export interface InsightRunStats {
  insightsGenerated: number;
  insightsSuppressed: number;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

export interface TaskRunStats {
  tasksGenerated: number;
  tasksSuppressed: number;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

function toHealthSnapshot(row: HealthSnapshotRow): HealthSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    overallScore: Number(row.overall_score),
    spendingScore: row.spending_score != null ? Number(row.spending_score) : null,
    savingsScore: row.savings_score != null ? Number(row.savings_score) : null,
    debtScore: row.debt_score != null ? Number(row.debt_score) : null,
    coverageConfidence: Number(row.coverage_confidence),
    contributingFactors:
      typeof row.contributing_factors === 'string'
        ? JSON.parse(row.contributing_factors)
        : row.contributing_factors,
    sourceTransactionIds: row.source_transaction_ids,
    dedupKey: row.dedup_key,
    engineVersion: row.engine_version,
    rulesVersion: row.rules_version,
    generatedAt: row.generated_at,
  };
}

function toCashFlowSnapshot(row: CashFlowSnapshotRow): CashFlowSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    prediction:
      typeof row.prediction === 'string'
        ? JSON.parse(row.prediction)
        : (row.prediction as unknown as Record<string, unknown>),
    coverageConfidence: Number(row.coverage_confidence),
    sourceTransactionIds: row.source_transaction_ids,
    dedupKey: row.dedup_key,
    engineVersion: row.engine_version,
    rulesVersion: row.rules_version,
    generatedAt: row.generated_at,
  };
}

export async function saveHealthSnapshot(
  userId: string,
  snapshot: HealthSnapshotInput,
): Promise<string> {
  const id = randomUUID();

  await query(
    `INSERT INTO health_score_snapshots (
      id, user_id, overall_score, spending_score, savings_score, debt_score,
      coverage_confidence, contributing_factors, source_transaction_ids,
      dedup_key, engine_version, rules_version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
    [
      id,
      userId,
      snapshot.overallScore,
      snapshot.spendingScore ?? null,
      snapshot.savingsScore ?? null,
      snapshot.debtScore ?? null,
      snapshot.coverageConfidence,
      JSON.stringify(snapshot.contributingFactors),
      snapshot.sourceTransactionIds,
      snapshot.dedupKey,
      ENGINE_VERSION,
      RULES_VERSION,
    ],
  );

  return id;
}

export async function getHealthHistory(
  userId: string,
  limit = 30,
): Promise<HealthSnapshot[]> {
  const result = await query<HealthSnapshotRow>(
    `SELECT id, user_id, overall_score::text, spending_score::text,
            savings_score::text, debt_score::text, coverage_confidence::text,
            contributing_factors::text, source_transaction_ids,
            dedup_key, engine_version, rules_version,
            generated_at::text, created_at::text
     FROM health_score_snapshots
     WHERE user_id = $1
     ORDER BY generated_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  return result.rows.map(toHealthSnapshot);
}

export async function getHealthSnapshotAt(
  userId: string,
  date: string,
): Promise<HealthSnapshot | null> {
  const result = await query<HealthSnapshotRow>(
    `SELECT id, user_id, overall_score::text, spending_score::text,
            savings_score::text, debt_score::text, coverage_confidence::text,
            contributing_factors::text, source_transaction_ids,
            dedup_key, engine_version, rules_version,
            generated_at::text, created_at::text
     FROM health_score_snapshots
     WHERE user_id = $1
     ORDER BY ABS(EXTRACT(EPOCH FROM (generated_at - $2::timestamptz)))
     LIMIT 1`,
    [userId, date],
  );

  if (result.rows.length === 0) return null;
  return toHealthSnapshot(result.rows[0]);
}

export async function saveCashFlowSnapshot(
  userId: string,
  prediction: CashFlowPredictionInput,
): Promise<string> {
  const id = randomUUID();

  await query(
    `INSERT INTO cashflow_snapshots (
      id, user_id, prediction, coverage_confidence,
      source_transaction_ids, dedup_key, engine_version, rules_version
    ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)`,
    [
      id,
      userId,
      JSON.stringify(prediction.prediction),
      prediction.coverageConfidence,
      prediction.sourceTransactionIds,
      prediction.dedupKey,
      ENGINE_VERSION,
      RULES_VERSION,
    ],
  );

  return id;
}

export async function getCashFlowHistory(
  userId: string,
  limit = 30,
): Promise<CashFlowSnapshot[]> {
  const result = await query<CashFlowSnapshotRow>(
    `SELECT id, user_id, prediction::text, coverage_confidence::text,
            source_transaction_ids, dedup_key, engine_version, rules_version,
            generated_at::text, created_at::text
     FROM cashflow_snapshots
     WHERE user_id = $1
     ORDER BY generated_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  return result.rows.map(toCashFlowSnapshot);
}

export async function logInsightRun(
  userId: string,
  stats: InsightRunStats,
): Promise<string> {
  const id = randomUUID();

  await query(
    `INSERT INTO insight_generation_log (
      id, user_id, insights_generated, insights_suppressed,
      latency_ms, engine_version, rules_version, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      id,
      userId,
      stats.insightsGenerated,
      stats.insightsSuppressed,
      stats.latencyMs,
      ENGINE_VERSION,
      RULES_VERSION,
      JSON.stringify(stats.metadata ?? {}),
    ],
  );

  return id;
}

export async function logTaskRun(
  userId: string,
  stats: TaskRunStats,
): Promise<string> {
  const id = randomUUID();

  await query(
    `INSERT INTO task_generation_log (
      id, user_id, tasks_generated, tasks_suppressed,
      latency_ms, engine_version, rules_version, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      id,
      userId,
      stats.tasksGenerated,
      stats.tasksSuppressed,
      stats.latencyMs,
      ENGINE_VERSION,
      RULES_VERSION,
      JSON.stringify(stats.metadata ?? {}),
    ],
  );

  return id;
}
