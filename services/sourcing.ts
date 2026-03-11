import type { SourcingTaskStatus } from '@/lib/sourcing/schemas';

export interface SourcingTaskPreview {
  id: string;
  status: SourcingTaskStatus;
  intent: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  summary: string | null;
  sheetUrl: string | null;
  shortlistCount: number;
  shortlistPreview: Array<{
    fullName: string;
    currentTitle: string;
    location: string;
    score: number;
    sourceUrl: string;
  }>;
}

export interface SourcingTasksResponse {
  summary: Record<SourcingTaskStatus, number>;
  records: SourcingTaskPreview[];
  generatedAt: string;
}

function readError(payload: { error?: string; errorCode?: string }): string {
  if (payload.errorCode && payload.error) return `${payload.errorCode}: ${payload.error}`;
  return payload.error || 'Request failed';
}

export async function fetchSourcingTasks(limit = 25): Promise<SourcingTasksResponse> {
  const response = await fetch(`/api/sourcing/tasks?limit=${encodeURIComponent(String(limit))}`, {
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    summary?: Record<SourcingTaskStatus, number>;
    records?: SourcingTaskPreview[];
    generatedAt?: string;
    error?: string;
    errorCode?: string;
  } | null;

  if (!response.ok || !payload?.ok || !payload.summary || !Array.isArray(payload.records) || !payload.generatedAt) {
    throw new Error(readError(payload || {}));
  }

  return {
    summary: payload.summary,
    records: payload.records,
    generatedAt: payload.generatedAt,
  };
}

export async function fetchSourcingTaskDetail(taskId: string): Promise<{
  task: unknown;
  logs: unknown[];
}> {
  const response = await fetch(`/api/sourcing/tasks/${encodeURIComponent(taskId)}`, {
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    task?: unknown;
    logs?: unknown[];
    error?: string;
    errorCode?: string;
  } | null;

  if (!response.ok || !payload?.ok || !payload.task || !Array.isArray(payload.logs)) {
    throw new Error(readError(payload || {}));
  }

  return {
    task: payload.task,
    logs: payload.logs,
  };
}

export async function retrySourcingTask(taskId: string): Promise<void> {
  const response = await fetch('/api/sourcing/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'retry',
      taskId,
    }),
  });

  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    error?: string;
    errorCode?: string;
  } | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(readError(payload || {}));
  }
}
