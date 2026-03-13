import { randomUUID } from 'node:crypto';
import { query } from '@/lib/server/db';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'canceled';

type TaskRow = {
  id: string;
  user_id: string;
  prompt: string;
  tinyfish_run_id: string | null;
  tinyfish_run_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export interface TaskRecord {
  id: string;
  userId: string;
  prompt: string;
  tinyfishRunId: string | null;
  tinyfishRunUrl: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

function normalizeTaskStatus(value: string | null | undefined): TaskStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'success' || normalized === 'succeeded') {
    return 'completed';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'failed';
  }
  if (normalized === 'canceled' || normalized === 'cancelled') {
    return 'canceled';
  }
  return 'running';
}

function rowToTaskRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    userId: row.user_id,
    prompt: row.prompt,
    tinyfishRunId: row.tinyfish_run_id,
    tinyfishRunUrl: row.tinyfish_run_url,
    status: normalizeTaskStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createTask(input: {
  userId: string;
  prompt: string;
  tinyfishRunId: string;
  tinyfishRunUrl?: string | null;
  status?: TaskStatus;
}): Promise<TaskRecord> {
  const result = await query<TaskRow>(
    `
      INSERT INTO tasks (
        id,
        user_id,
        prompt,
        tinyfish_run_id,
        tinyfish_run_url,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        user_id,
        prompt,
        tinyfish_run_id,
        tinyfish_run_url,
        status,
        created_at::text,
        updated_at::text
    `,
    [
      randomUUID(),
      input.userId,
      input.prompt.trim(),
      input.tinyfishRunId.trim(),
      input.tinyfishRunUrl?.trim() || null,
      input.status || 'running',
    ],
  );

  return rowToTaskRecord(result.rows[0]);
}

export async function listTasksForUser(input: {
  userId: string;
  limit?: number;
}): Promise<TaskRecord[]> {
  const limit = Number.isFinite(input.limit) && (input.limit as number) > 0
    ? Math.min(Math.floor(input.limit as number), 250)
    : 100;

  const result = await query<TaskRow>(
    `
      SELECT
        id,
        user_id,
        prompt,
        tinyfish_run_id,
        tinyfish_run_url,
        status,
        created_at::text,
        updated_at::text
      FROM tasks
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [input.userId, limit],
  );

  return result.rows.map(rowToTaskRecord);
}

export async function listTasksByRunIds(input: {
  userId: string;
  runIds: string[];
}): Promise<TaskRecord[]> {
  const normalizedRunIds = Array.from(new Set(input.runIds.map((item) => item.trim()).filter(Boolean)));
  if (normalizedRunIds.length === 0) return [];

  const result = await query<TaskRow>(
    `
      SELECT
        id,
        user_id,
        prompt,
        tinyfish_run_id,
        tinyfish_run_url,
        status,
        created_at::text,
        updated_at::text
      FROM tasks
      WHERE user_id = $1
        AND tinyfish_run_id = ANY($2::text[])
      ORDER BY created_at DESC
    `,
    [input.userId, normalizedRunIds],
  );

  return result.rows.map(rowToTaskRecord);
}

export async function updateTaskRunStatus(input: {
  userId: string;
  runId: string;
  status: string;
  tinyfishRunUrl?: string | null;
}): Promise<TaskRecord | null> {
  const runId = input.runId.trim();
  if (!runId) return null;

  const normalizedStatus = normalizeTaskStatus(input.status);

  const result = await query<TaskRow>(
    `
      UPDATE tasks
      SET
        status = $3,
        tinyfish_run_url = COALESCE($4, tinyfish_run_url),
        updated_at = NOW()
      WHERE user_id = $1
        AND tinyfish_run_id = $2
      RETURNING
        id,
        user_id,
        prompt,
        tinyfish_run_id,
        tinyfish_run_url,
        status,
        created_at::text,
        updated_at::text
    `,
    [
      input.userId,
      runId,
      normalizedStatus,
      input.tinyfishRunUrl?.trim() || null,
    ],
  );

  if (!result.rows[0]) return null;
  return rowToTaskRecord(result.rows[0]);
}
