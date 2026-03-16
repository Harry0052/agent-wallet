import type {
  AutomationActionRecord,
  AutomationActionSummary,
  AutomationActionType,
  AutomationPolicyMode,
} from '@/lib/types';

export interface AutomationTaskCenterEvent {
  id: string;
  userId: string;
  actionId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AutomationPolicyConfig {
  defaultMode: AutomationPolicyMode;
  perActionMode: Partial<Record<AutomationActionType, AutomationPolicyMode>>;
  autopilotEnabledActions: Partial<Record<AutomationActionType, boolean>>;
  explicitConfirmEnabledActions: Partial<Record<AutomationActionType, boolean>>;
}

export interface TaskCenterSnapshot {
  actions: AutomationActionRecord[];
  summary: AutomationActionSummary;
  events: AutomationTaskCenterEvent[];
  policy: AutomationPolicyConfig;
}

function toError(payload: { error?: string; errorCode?: string }): Error {
  if (payload.errorCode && payload.error) return new Error(`${payload.errorCode}: ${payload.error}`);
  return new Error(payload.error || 'Task center request failed');
}

export async function fetchTaskCenterSnapshot(): Promise<TaskCenterSnapshot> {
  const response = await fetch('/api/tasks/center', {
    method: 'GET',
    cache: 'no-store',
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    snapshot?: TaskCenterSnapshot;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !payload.ok || !payload.snapshot) {
    throw toError(payload);
  }

  return payload.snapshot;
}

function randomIdempotencyKey(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

async function postCommand<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/tasks/center', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    error?: string;
    errorCode?: string;
  } & T;

  if (!response.ok || !payload.ok) {
    throw toError(payload);
  }

  return payload;
}

export async function detectTaskCenterActions(): Promise<{
  result: {
    detected: number;
    suppressed: number;
  };
}> {
  return postCommand({
    command: 'detect',
  });
}

export async function confirmTaskCenterAction(actionId: string): Promise<void> {
  await postCommand({
    command: 'confirm',
    actionId,
    idempotencyKey: randomIdempotencyKey('confirm'),
  });
}

export async function attemptTaskCenterAction(actionId: string): Promise<{
  result: {
    status: 'attempted' | 'completed' | 'failed' | 'blocked';
    message: string;
    provider: string;
  };
}> {
  return postCommand({
    command: 'attempt',
    actionId,
    idempotencyKey: randomIdempotencyKey('attempt'),
  });
}

export async function dismissTaskCenterAction(actionId: string): Promise<void> {
  await postCommand({
    command: 'dismiss',
    actionId,
    idempotencyKey: randomIdempotencyKey('dismiss'),
  });
}

export async function snoozeTaskCenterAction(actionId: string, snoozeDays = 3): Promise<void> {
  await postCommand({
    command: 'snooze',
    actionId,
    snoozeDays,
    idempotencyKey: randomIdempotencyKey('snooze'),
  });
}

export async function reopenTaskCenterAction(actionId: string): Promise<void> {
  await postCommand({
    command: 'reopen',
    actionId,
    idempotencyKey: randomIdempotencyKey('reopen'),
  });
}

export async function updateTaskCenterPolicy(input: {
  defaultMode?: AutomationPolicyMode;
  autopilotEnabledActions?: Partial<Record<AutomationActionType, boolean>>;
  explicitConfirmEnabledActions?: Partial<Record<AutomationActionType, boolean>>;
}): Promise<{ policy: AutomationPolicyConfig }> {
  return postCommand({
    command: 'policy_update',
    idempotencyKey: randomIdempotencyKey('policy'),
    patch: {
      ...(input.defaultMode ? { defaultMode: input.defaultMode } : {}),
      ...(input.autopilotEnabledActions ? { autopilotEnabledActions: input.autopilotEnabledActions } : {}),
      ...(input.explicitConfirmEnabledActions ? { explicitConfirmEnabledActions: input.explicitConfirmEnabledActions } : {}),
    },
  });
}
