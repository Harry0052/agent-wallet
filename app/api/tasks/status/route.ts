import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError } from '@/lib/server/auth';
import { getWalletUserId } from '@/lib/server/ledger';
import { listTasksForUser, updateTaskRunStatus, type TaskStatus } from '@/lib/server/tasks';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { getRequiredSecret } from '@/security/secretsManager';

export const runtime = 'nodejs';

const BodySchema = z.object({
  runIds: z.array(z.string().trim().min(1)).max(200).optional(),
});

type TinyFishRunUpdate = {
  runId: string;
  status: TaskStatus;
  runUrl: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeTaskStatus(status: string): TaskStatus {
  const lower = status.toLowerCase();
  if (lower.includes('complete') || lower.includes('success')) return 'completed';
  if (lower.includes('fail') || lower.includes('error')) return 'failed';
  if (lower.includes('cancel')) return 'canceled';
  return 'running';
}

function extractRunUpdates(payload: Record<string, unknown>, requestedRunIds: string[]): TinyFishRunUpdate[] {
  const roots: unknown[] = [
    ...asArray(payload.runs),
    ...asArray(payload.data),
    ...asArray(asRecord(payload.data).runs),
    ...asArray(payload.results),
    ...asArray(payload.items),
  ];

  const byRunId = new Map<string, TinyFishRunUpdate>();

  for (const candidate of roots) {
    const row = asRecord(candidate);
    const runId = pickString(row, ['run_id', 'runId', 'id']);
    if (!runId) continue;

    const statusRaw = pickString(row, ['status', 'state', 'result']) || 'running';
    const runUrl = pickString(row, ['run_url', 'runUrl', 'url']);

    byRunId.set(runId, {
      runId,
      status: normalizeTaskStatus(statusRaw),
      runUrl,
    });
  }

  // Fallback when provider omits details but request run IDs are known.
  if (byRunId.size === 0) {
    for (const runId of requestedRunIds) {
      byRunId.set(runId, {
        runId,
        status: 'running',
        runUrl: `https://agent.tinyfish.ai/run/${runId}`,
      });
    }
  }

  return Array.from(byRunId.values());
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getWalletUserId();
    const body = BodySchema.parse(await req.json().catch(() => ({})));

    const requestedRunIds = Array.from(new Set((body.runIds || []).map((id) => id.trim()).filter(Boolean)));

    let runIds = requestedRunIds;
    if (runIds.length === 0) {
      const tasks = await listTasksForUser({ userId, limit: 200 });
      runIds = tasks
        .filter((task) => task.status === 'running' && task.tinyfishRunId)
        .map((task) => task.tinyfishRunId as string);
    }

    if (runIds.length === 0) {
      const tasks = await listTasksForUser({ userId, limit: 200 });
      return NextResponse.json({ ok: true, runUpdates: [], tasks });
    }

    const apiKey = getRequiredSecret('TINYFISH_API_KEY');
    const endpoint = process.env.TINYFISH_RUN_BATCH_URL || 'https://agent.tinyfish.ai/v1/runs/batch';

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ run_ids: runIds }),
      cache: 'no-store',
    });

    const rawText = await upstream.text();
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new Error(`TinyFish returned non-JSON batch status response: ${rawText.slice(0, 240)}`);
    }

    if (!upstream.ok) {
      const errorMessage = pickString(payload, ['error', 'message']) || 'TinyFish batch status failed';
      throw new Error(`${errorMessage} (${upstream.status})`);
    }

    const updates = extractRunUpdates(payload, runIds);

    await Promise.all(
      updates.map((update) => updateTaskRunStatus({
        userId,
        runId: update.runId,
        status: update.status,
        tinyfishRunUrl: update.runUrl,
      })),
    );

    const tasks = await listTasksForUser({ userId, limit: 200 });

    return NextResponse.json({
      ok: true,
      runUpdates: updates,
      tasks,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }

    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to load task statuses';

    const status = error instanceof z.ZodError ? 400 : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'tasks.status.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
