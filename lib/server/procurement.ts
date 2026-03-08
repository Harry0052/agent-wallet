import { randomUUID } from 'node:crypto';
import type { ProcurementFinding, ProcurementPlan, ProcurementTaskRecord } from '@/lib/types';
import { query } from '@/lib/server/db';

type ProcurementTaskRow = {
  id: string;
  user_id: string;
  task_type: string;
  status: ProcurementTaskRecord['status'];
  goal: string;
  budget_limit: string | null;
  category: string | null;
  target_vendors: unknown;
  comparison_criteria: unknown;
  must_have_features: unknown;
  findings: Record<string, unknown> | null;
  recommendation: Record<string, unknown> | null;
  planning_output: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type ProcurementFindingRow = {
  id: string;
  task_id: string;
  user_id: string;
  vendor_name: string;
  pricing_page_url: string;
  plan_name: string;
  monthly_price: string | null;
  annual_price: string | null;
  billing_frequency: string;
  content_availability: string | null;
  notes: string | null;
  notable_features: unknown;
  extraction_timestamp: string;
  created_at: string;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function toProcurementPlan(value: unknown): ProcurementPlan {
  const fallback: ProcurementPlan = {
    normalizedGoal: '',
    category: 'general',
    targetVendorCandidates: [],
    budgetConstraint: {
      amount: null,
      currency: 'USD',
      period: 'unknown',
      rawText: '',
    },
    mustHaveFeatures: [],
    comparisonCriteria: [],
    clarificationNeeded: true,
    followUpQuestions: [],
  };

  if (!value || typeof value !== 'object') return fallback;

  const raw = value as Partial<ProcurementPlan>;
  return {
    normalizedGoal: typeof raw.normalizedGoal === 'string' ? raw.normalizedGoal : fallback.normalizedGoal,
    category: typeof raw.category === 'string' ? raw.category : fallback.category,
    targetVendorCandidates: toStringArray(raw.targetVendorCandidates),
    budgetConstraint: {
      amount: typeof raw.budgetConstraint?.amount === 'number' ? raw.budgetConstraint.amount : null,
      currency: 'USD',
      period: raw.budgetConstraint?.period || 'unknown',
      rawText: typeof raw.budgetConstraint?.rawText === 'string' ? raw.budgetConstraint.rawText : '',
    },
    mustHaveFeatures: toStringArray(raw.mustHaveFeatures),
    comparisonCriteria: toStringArray(raw.comparisonCriteria),
    clarificationNeeded: Boolean(raw.clarificationNeeded),
    followUpQuestions: toStringArray(raw.followUpQuestions),
  };
}

function rowToRecord(row: ProcurementTaskRow): ProcurementTaskRecord {
  return {
    id: row.id,
    userId: row.user_id,
    taskType: row.task_type,
    status: row.status,
    goal: row.goal,
    budgetLimit: row.budget_limit !== null ? Number(row.budget_limit) : null,
    category: row.category,
    targetVendors: toStringArray(row.target_vendors),
    comparisonCriteria: toStringArray(row.comparison_criteria),
    mustHaveFeatures: toStringArray(row.must_have_features),
    findings: row.findings,
    recommendation: row.recommendation,
    planningOutput: toProcurementPlan(row.planning_output),
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToFinding(row: ProcurementFindingRow): ProcurementFinding {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    vendorName: row.vendor_name,
    pricingPageUrl: row.pricing_page_url,
    planName: row.plan_name,
    monthlyPrice: row.monthly_price !== null ? Number(row.monthly_price) : null,
    annualPrice: row.annual_price !== null ? Number(row.annual_price) : null,
    billingFrequency: row.billing_frequency,
    contentAvailability: row.content_availability || null,
    notes: row.notes || null,
    notableFeatures: toStringArray(row.notable_features),
    extractionTimestamp: row.extraction_timestamp,
    createdAt: row.created_at,
  };
}

export async function createProcurementTask(params: {
  userId: string;
  goal: string;
  taskType?: string;
  taskId?: string;
  planningOutputSeed?: Record<string, unknown>;
}): Promise<string> {
  const id = params.taskId || randomUUID();

  await query(
    `
      INSERT INTO procurement_tasks (
        id, user_id, task_type, status, goal,
        target_vendors, comparison_criteria, must_have_features,
        findings, recommendation, planning_output, error
      )
      VALUES (
        $1, $2, $3, 'planning', $4,
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        NULL, NULL, $5::jsonb, NULL
      )
    `,
    [
      id,
      params.userId,
      params.taskType || 'procurement_plan',
      params.goal,
      JSON.stringify(params.planningOutputSeed || { request: params.goal }),
    ],
  );

  return id;
}

export async function updateProcurementTask(params: {
  taskId: string;
  userId: string;
  status: ProcurementTaskRecord['status'];
  goal: string;
  budgetLimit: number | null;
  category: string | null;
  targetVendors: string[];
  comparisonCriteria: string[];
  mustHaveFeatures: string[];
  planningOutput: ProcurementPlan;
  findings?: Record<string, unknown> | null;
  recommendation?: Record<string, unknown> | null;
  error?: string;
}): Promise<ProcurementTaskRecord> {
  const result = await query<ProcurementTaskRow>(
    `
      UPDATE procurement_tasks
      SET
        status = $3,
        goal = $4,
        budget_limit = $5,
        category = $6,
        target_vendors = $7::jsonb,
        comparison_criteria = $8::jsonb,
        must_have_features = $9::jsonb,
        findings = $10::jsonb,
        recommendation = $11::jsonb,
        planning_output = $12::jsonb,
        error = $13,
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING
        id, user_id, task_type, status, goal,
        budget_limit::text, category, target_vendors,
        comparison_criteria, must_have_features,
        findings, recommendation, planning_output,
        error, created_at::text, updated_at::text
    `,
    [
      params.taskId,
      params.userId,
      params.status,
      params.goal,
      params.budgetLimit,
      params.category,
      JSON.stringify(params.targetVendors),
      JSON.stringify(params.comparisonCriteria),
      JSON.stringify(params.mustHaveFeatures),
      params.findings ? JSON.stringify(params.findings) : null,
      params.recommendation ? JSON.stringify(params.recommendation) : null,
      JSON.stringify(params.planningOutput),
      params.error || null,
    ],
  );

  if (!result.rows[0]) {
    throw new Error('Failed to update procurement task');
  }

  return rowToRecord(result.rows[0]);
}

export async function getProcurementTask(params: {
  taskId: string;
  userId: string;
}): Promise<ProcurementTaskRecord | null> {
  const result = await query<ProcurementTaskRow>(
    `
      SELECT
        id, user_id, task_type, status, goal,
        budget_limit::text, category, target_vendors,
        comparison_criteria, must_have_features,
        findings, recommendation, planning_output,
        error, created_at::text, updated_at::text
      FROM procurement_tasks
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [params.taskId, params.userId],
  );

  if (!result.rows[0]) return null;
  return rowToRecord(result.rows[0]);
}

export async function listProcurementFindings(params: {
  taskId: string;
  userId: string;
}): Promise<ProcurementFinding[]> {
  const result = await query<ProcurementFindingRow>(
    `
      SELECT
        id, task_id, user_id, vendor_name, pricing_page_url, plan_name,
        monthly_price::text, annual_price::text, billing_frequency, content_availability, notes, notable_features,
        extraction_timestamp::text, created_at::text
      FROM procurement_findings
      WHERE task_id = $1 AND user_id = $2
      ORDER BY extraction_timestamp ASC, created_at ASC
    `,
    [params.taskId, params.userId],
  );

  return result.rows.map(rowToFinding);
}

export async function createProcurementFinding(params: {
  taskId: string;
  userId: string;
  vendorName: string;
  pricingPageUrl: string;
  planName: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  billingFrequency: string;
  contentAvailability?: string | null;
  notes?: string | null;
  notableFeatures: string[];
  extractionTimestamp: string;
  raw?: Record<string, unknown>;
}): Promise<ProcurementFinding> {
  const result = await query<ProcurementFindingRow>(
    `
      INSERT INTO procurement_findings (
        id, task_id, user_id, vendor_name, pricing_page_url,
        plan_name, monthly_price, annual_price, billing_frequency, content_availability, notes,
        notable_features, extraction_timestamp, raw
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12::jsonb, $13::timestamptz, $14::jsonb
      )
      RETURNING
        id, task_id, user_id, vendor_name, pricing_page_url,
        plan_name, monthly_price::text, annual_price::text, billing_frequency, content_availability, notes,
        notable_features, extraction_timestamp::text, created_at::text
    `,
    [
      randomUUID(),
      params.taskId,
      params.userId,
      params.vendorName,
      params.pricingPageUrl,
      params.planName,
      params.monthlyPrice,
      params.annualPrice,
      params.billingFrequency,
      params.contentAvailability || null,
      params.notes || null,
      JSON.stringify(params.notableFeatures),
      params.extractionTimestamp,
      params.raw ? JSON.stringify(params.raw) : null,
    ],
  );

  return rowToFinding(result.rows[0]);
}
