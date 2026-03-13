export type TaskStatus = 'running' | 'completed' | 'failed' | 'canceled';

export interface TinyFishTaskRecord {
  id: string;
  userId: string;
  prompt: string;
  tinyfishRunId: string | null;
  tinyfishRunUrl: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

interface TasksListResponse {
  ok: true;
  tasks: TinyFishTaskRecord[];
}

interface TasksStatusResponse {
  ok: true;
  tasks: TinyFishTaskRecord[];
  runUpdates: Array<{
    runId: string;
    status: TaskStatus;
    runUrl: string | null;
  }>;
}

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || `Request failed (${response.status})`;
}

export async function fetchTasksList(): Promise<TinyFishTaskRecord[]> {
  const response = await fetch('/api/tasks/list', {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const body = (await response.json()) as TasksListResponse;
  if (!body?.ok || !Array.isArray(body.tasks)) {
    throw new Error('Tasks list response was invalid.');
  }

  return body.tasks;
}

export async function fetchTasksStatus(runIds?: string[]): Promise<TasksStatusResponse> {
  const response = await fetch('/api/tasks/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runIds: runIds && runIds.length > 0 ? runIds : undefined }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const body = (await response.json()) as TasksStatusResponse;
  if (!body?.ok || !Array.isArray(body.tasks) || !Array.isArray(body.runUpdates)) {
    throw new Error('Tasks status response was invalid.');
  }

  return body;
}
