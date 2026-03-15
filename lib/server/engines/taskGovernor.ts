import 'server-only';

import { query } from '@/lib/server/db';

export interface GovernorDecision {
  allowed: boolean;
  reason: 'ok' | 'duplicate' | 'cooldown' | 'snoozed' | 'storage_cap' | 'low_confidence';
}

export type TaskType =
  | 'cancel_subscription'
  | 'review_charge'
  | 'reduce_spending'
  | 'move_to_savings'
  | 'reconnect_account';

const COOLDOWN_DAYS: Record<TaskType, number> = {
  cancel_subscription: 30,
  review_charge: 14,
  reduce_spending: 7,
  move_to_savings: 14,
  reconnect_account: 7,
};

const MAX_PENDING_TASKS = 10;
const MIN_CONFIDENCE = 0.6;
const MAX_SURFACED_TASKS = 5;
const MAX_HIGH_PRIORITY_SURFACED = 1;

interface TaskRow {
  id: string;
  user_id: string;
  task_type: string;
  intent: string;
  status: string;
  input: string;
  result: string | null;
  error: string | null;
  snoozed_until: string | null;
  engine_version: string | null;
  rules_version: string | null;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  count: string;
}

interface DismissedRow {
  updated_at: string;
}

function parseInputJson(input: string | null): Record<string, unknown> {
  if (!input) return {};
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function evaluateGovernor(input: {
  userId: string;
  taskType: string;
  relatedEntityId?: string;
  confidence?: number;
}): Promise<GovernorDecision> {
  // 1. Confidence gate
  const confidence = input.confidence ?? 1;
  if (confidence < MIN_CONFIDENCE) {
    return { allowed: false, reason: 'low_confidence' };
  }

  // 2. Dedup: check for existing pending/in_progress task of same type and entity
  if (input.relatedEntityId) {
    const dupResult = await query<TaskRow>(
      `SELECT id, input
       FROM agent_tasks
       WHERE user_id = $1
         AND task_type = $2
         AND status IN ('pending', 'in_progress')
       LIMIT 20`,
      [input.userId, input.taskType],
    );

    for (const row of dupResult.rows) {
      const parsed = parseInputJson(row.input);
      if (parsed.relatedEntityId === input.relatedEntityId) {
        return { allowed: false, reason: 'duplicate' };
      }
    }
  } else {
    const dupResult = await query<CountRow>(
      `SELECT COUNT(*)::text AS count
       FROM agent_tasks
       WHERE user_id = $1
         AND task_type = $2
         AND status IN ('pending', 'in_progress')`,
      [input.userId, input.taskType],
    );

    if (Number(dupResult.rows[0]?.count ?? 0) > 0) {
      return { allowed: false, reason: 'duplicate' };
    }
  }

  // 3. Cooldown: check last dismissed task of this type
  const cooldownDays = COOLDOWN_DAYS[input.taskType as TaskType];
  if (cooldownDays) {
    const dismissedResult = await query<DismissedRow>(
      `SELECT updated_at::text
       FROM agent_tasks
       WHERE user_id = $1
         AND task_type = $2
         AND status = 'dismissed'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [input.userId, input.taskType],
    );

    if (dismissedResult.rows.length > 0) {
      const dismissedAt = Date.parse(dismissedResult.rows[0].updated_at);
      const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
      if (Number.isFinite(dismissedAt) && Date.now() - dismissedAt < cooldownMs) {
        return { allowed: false, reason: 'cooldown' };
      }
    }
  }

  // 4. Snooze: check if task type is snoozed for this user
  const snoozedResult = await query<CountRow>(
    `SELECT COUNT(*)::text AS count
     FROM agent_tasks
     WHERE user_id = $1
       AND task_type = $2
       AND snoozed_until IS NOT NULL
       AND snoozed_until > NOW()`,
    [input.userId, input.taskType],
  );

  if (Number(snoozedResult.rows[0]?.count ?? 0) > 0) {
    return { allowed: false, reason: 'snoozed' };
  }

  // 5. Storage cap: max pending tasks per user
  const pendingResult = await query<CountRow>(
    `SELECT COUNT(*)::text AS count
     FROM agent_tasks
     WHERE user_id = $1
       AND status = 'pending'`,
    [input.userId],
  );

  if (Number(pendingResult.rows[0]?.count ?? 0) >= MAX_PENDING_TASKS) {
    return { allowed: false, reason: 'storage_cap' };
  }

  return { allowed: true, reason: 'ok' };
}

export interface SurfacedTask {
  id: string;
  userId: string;
  taskType: string;
  intent: string;
  input: Record<string, unknown>;
  priority: number;
  confidence: number;
  createdAt: string;
}

export async function listSurfacedTasks(userId: string): Promise<SurfacedTask[]> {
  const result = await query<TaskRow>(
    `SELECT id, user_id, task_type, intent, status, input,
            result, error, snoozed_until::text,
            engine_version, rules_version,
            created_at::text, updated_at::text
     FROM agent_tasks
     WHERE user_id = $1
       AND status = 'pending'
       AND (snoozed_until IS NULL OR snoozed_until <= NOW())
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, MAX_SURFACED_TASKS * 2],
  );

  const tasks: SurfacedTask[] = result.rows.map((row) => {
    const parsed = parseInputJson(row.input);
    return {
      id: row.id,
      userId: row.user_id,
      taskType: row.task_type,
      intent: row.intent,
      input: parsed,
      priority: typeof parsed.priority === 'number' ? parsed.priority : 0,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 1,
      createdAt: row.created_at,
    };
  });

  // Sort by priority descending (higher = more important)
  tasks.sort((a, b) => b.priority - a.priority);

  // Enforce max 1 high priority task (priority >= 8)
  let highPriorityCount = 0;
  const filtered: SurfacedTask[] = [];

  for (const task of tasks) {
    if (filtered.length >= MAX_SURFACED_TASKS) break;

    if (task.priority >= 8) {
      if (highPriorityCount >= MAX_HIGH_PRIORITY_SURFACED) continue;
      highPriorityCount += 1;
    }

    filtered.push(task);
  }

  return filtered;
}
