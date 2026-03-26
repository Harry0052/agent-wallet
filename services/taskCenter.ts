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
  /** Window in minutes for duplicate action detection. Defaults to 30. */
  duplicateWindowMinutes?: number;
}

export interface TaskCenterSnapshot {
  actions: AutomationActionRecord[];
  summary: AutomationActionSummary;
  events: AutomationTaskCenterEvent[];
  policy: AutomationPolicyConfig;
}

import { toUserFriendlyError } from './apiErrorMessage';

function toError(payload: { error?: string; errorCode?: string }): Error {
  return toUserFriendlyError(payload);
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

// ── Action Journal ──────────────────────────────────────────────────────────

export interface ActionJournalEntry {
  eventId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown> | null;
  renderedGoal: string | null;
  tinyFishResult: Record<string, unknown> | null;
  eventCreatedAt: string;
  actionId: string;
  actionType: string;
  actionTitle: string;
  actionSummary: string;
  actionStatus: string;
  actionAmount: number | null;
  actionCurrency: string | null;
  actionCreatedAt: string;
  rollbackPossible: boolean;
  rollbackNotes: string | null;
}

export async function fetchActionJournal(
  limit = 20,
  offset = 0,
): Promise<{
  journal: ActionJournalEntry[];
  pagination: { limit: number; offset: number; count: number };
}> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  const response = await fetch(`/api/tasks/journal?${params.toString()}`, {
    method: 'GET',
    cache: 'no-store',
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    journal?: ActionJournalEntry[];
    pagination?: { limit: number; offset: number; count: number };
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !payload.ok || !payload.journal) {
    throw toError(payload);
  }

  return {
    journal: payload.journal,
    pagination: payload.pagination ?? { limit, offset, count: payload.journal.length },
  };
}

// ── Action Execution Streaming ──────────────────────────────────────────────

export function streamActionExecution(actionId: string): EventSource {
  const params = new URLSearchParams({ actionId });
  return new EventSource(`/api/tasks/stream?${params.toString()}`);
}
