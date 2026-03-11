import 'server-only';
import { query } from '@/lib/server/db';
import { recordWebAction } from '@/lib/server/ledger';
import type { SourcingTaskResult, SourcingTaskStatus } from '@/lib/sourcing/schemas';

type AgentTaskRow = {
  id: string;
  user_id: string;
  task_type: string;
  intent: string;
  status: string;
  input: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type WebLogRow = {
  id: string;
  task_id: string | null;
  action_type: string;
  url: string | null;
  status: 'running' | 'done' | 'error';
  details: Record<string, unknown> | null;
  created_at: string;
};

export interface CandidateSourcingTaskRecord {
  id: string;
  userId: string;
  taskType: string;
  intent: string;
  status: SourcingTaskStatus;
  input: Record<string, unknown> | null;
  result: SourcingTaskResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateSourcingTaskLog {
  id: string;
  taskId: string;
  actionType: string;
  status: 'running' | 'done' | 'error';
  url: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

function parseStatus(value: string): SourcingTaskStatus {
  const allowed: SourcingTaskStatus[] = [
    'queued',
    'running',
    'parsing',
    'scoring',
    'exporting',
    'completed',
    'failed',
    'partial_success',
  ];

  if ((allowed as string[]).includes(value)) return value as SourcingTaskStatus;

  if (value === 'ready') return 'queued';
  if (value === 'superseded') return 'failed';
  return 'queued';
}

function parseResult(value: Record<string, unknown> | null): SourcingTaskResult | null {
  if (!value || typeof value !== 'object') return null;
  return value as unknown as SourcingTaskResult;
}

function toRecord(row: AgentTaskRow): CandidateSourcingTaskRecord {
  return {
    id: row.id,
    userId: row.user_id,
    taskType: row.task_type,
    intent: row.intent,
    status: parseStatus(row.status),
    input: row.input || null,
    result: parseResult(row.result),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCandidateSourcingTaskById(params: {
  userId: string;
  taskId: string;
}): Promise<CandidateSourcingTaskRecord | null> {
  const result = await query<AgentTaskRow>(
    `
      SELECT id, user_id, task_type, intent, status, input, result, error, created_at::text, updated_at::text
      FROM agent_tasks
      WHERE user_id = $1
        AND id = $2
        AND task_type = 'candidate_sourcing_task'
      LIMIT 1
    `,
    [params.userId, params.taskId],
  );

  if (!result.rows[0]) return null;
  return toRecord(result.rows[0]);
}

export async function listCandidateSourcingTasks(params: {
  userId: string;
  limit?: number;
}): Promise<CandidateSourcingTaskRecord[]> {
  const limit = Number.isFinite(params.limit) && (params.limit || 0) > 0
    ? Math.min(Math.round(params.limit || 20), 200)
    : 20;

  const result = await query<AgentTaskRow>(
    `
      SELECT id, user_id, task_type, intent, status, input, result, error, created_at::text, updated_at::text
      FROM agent_tasks
      WHERE user_id = $1
        AND task_type = 'candidate_sourcing_task'
      ORDER BY updated_at DESC
      LIMIT $2
    `,
    [params.userId, limit],
  );

  return result.rows.map(toRecord);
}

export async function updateCandidateSourcingTask(params: {
  userId: string;
  taskId: string;
  status: SourcingTaskStatus;
  resultPatch?: Record<string, unknown>;
  error?: string | null;
}): Promise<void> {
  await query(
    `
      UPDATE agent_tasks
      SET
        status = $3,
        result = COALESCE(result, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb),
        error = $5,
        updated_at = NOW()
      WHERE user_id = $1
        AND id = $2
        AND task_type = 'candidate_sourcing_task'
    `,
    [
      params.userId,
      params.taskId,
      params.status,
      params.resultPatch ? JSON.stringify(params.resultPatch) : null,
      params.error || null,
    ],
  );
}

export async function logCandidateSourcingAction(params: {
  userId: string;
  taskId: string;
  actionType: string;
  status: 'running' | 'done' | 'error';
  message: string;
  details?: Record<string, unknown>;
  url?: string;
}): Promise<void> {
  await recordWebAction({
    userId: params.userId,
    taskId: params.taskId,
    actionType: `sourcing_${params.actionType}`,
    status: params.status,
    url: params.url,
    details: {
      message: params.message,
      ...(params.details || {}),
    },
  });
}

export async function listCandidateSourcingLogs(params: {
  userId: string;
  taskId: string;
  limit?: number;
}): Promise<CandidateSourcingTaskLog[]> {
  const limit = Number.isFinite(params.limit) && (params.limit || 0) > 0
    ? Math.min(Math.round(params.limit || 120), 500)
    : 120;

  const result = await query<WebLogRow>(
    `
      SELECT id, task_id, action_type, url, status, details, created_at::text
      FROM web_action_logs
      WHERE user_id = $1
        AND task_id = $2
        AND action_type LIKE 'sourcing_%'
      ORDER BY created_at ASC
      LIMIT $3
    `,
    [params.userId, params.taskId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    taskId: row.task_id || params.taskId,
    actionType: row.action_type,
    status: row.status,
    url: row.url,
    details: row.details || null,
    createdAt: row.created_at,
  }));
}
