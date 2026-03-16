import 'server-only';

import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { query } from '@/lib/server/db';
import type {
  AutomationActionStatus,
  AutomationActionSummary,
  AutomationPolicyMode,
} from '@/lib/types';
import type {
  AutomationActionEvent,
  AutomationActionRecord,
  AutomationDetectionCandidate,
  AutomationStoreActionRow,
} from '@/lib/server/automation/types';

interface AutomationEventRow extends QueryResultRow {
  id: string;
  user_id: string;
  action_id: string;
  event_type: AutomationActionEvent['eventType'];
  from_status: AutomationActionStatus | null;
  to_status: AutomationActionStatus | null;
  reason: string | null;
  idempotency_key: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toAction(row: AutomationStoreActionRow): AutomationActionRecord {
  const explainability = toObject(row.explainability);
  const factorsRaw = explainability.factors;
  const factors = Array.isArray(factorsRaw)
    ? factorsRaw.map((item) => String(item)).filter(Boolean)
    : [];

  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    actionType: row.action_type,
    policy: row.policy_mode,
    status: row.status,
    title: row.title,
    summary: row.summary,
    dedupKey: row.dedup_key,
    confidence: Number(row.confidence),
    coverageConfidence: Number(row.coverage_confidence),
    explainability: {
      summary: typeof explainability.summary === 'string' ? explainability.summary : row.summary,
      factors,
      confidence: Number(explainability.confidence ?? row.confidence),
      coverageConfidence: Number(explainability.coverageConfidence ?? row.coverage_confidence),
    },
    payload: toObject(row.payload),
    amount: row.amount !== null ? Number(row.amount) : null,
    currency: row.currency,
    requiresExplicitConfirmation: row.requires_explicit_confirmation,
    cooldownUntil: row.cooldown_until,
    snoozedUntil: row.snoozed_until,
    lastError: row.last_error,
    attemptedAt: row.attempted_at,
    completedAt: row.completed_at,
    dismissedAt: row.dismissed_at,
    detectedAt: row.detected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: AutomationEventRow): AutomationActionEvent {
  return {
    id: row.id,
    userId: row.user_id,
    actionId: row.action_id,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export async function createAutomationActionFromCandidate(input: {
  userId: string;
  taskId: string;
  candidate: AutomationDetectionCandidate;
  policyMode: AutomationPolicyMode;
  requiresExplicitConfirmation: boolean;
  initialStatus: AutomationActionStatus;
  cooldownUntil?: string | null;
}): Promise<AutomationActionRecord> {
  const id = randomUUID();
  const result = await query<AutomationStoreActionRow>(
    `
      INSERT INTO automation_actions (
        id,
        user_id,
        task_id,
        action_type,
        policy_mode,
        status,
        title,
        summary,
        dedup_key,
        confidence,
        coverage_confidence,
        explainability,
        payload,
        amount,
        currency,
        requires_explicit_confirmation,
        cooldown_until,
        snoozed_until,
        last_error,
        attempted_at,
        completed_at,
        dismissed_at,
        detected_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb,
        $13::jsonb,
        $14,
        $15,
        $16,
        $17::timestamptz,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        $18::timestamptz
      )
      RETURNING
        id,
        user_id,
        task_id,
        action_type,
        policy_mode,
        status,
        title,
        summary,
        dedup_key,
        confidence::text,
        coverage_confidence::text,
        explainability,
        payload,
        amount::text,
        currency,
        requires_explicit_confirmation,
        cooldown_until::text,
        snoozed_until::text,
        last_error,
        attempted_at::text,
        completed_at::text,
        dismissed_at::text,
        detected_at::text,
        created_at::text,
        updated_at::text
    `,
    [
      id,
      input.userId,
      input.taskId,
      input.candidate.actionType,
      input.policyMode,
      input.initialStatus,
      input.candidate.title,
      input.candidate.summary,
      input.candidate.dedupKey,
      input.candidate.confidence,
      input.candidate.coverageConfidence,
      JSON.stringify(input.candidate.explainability),
      JSON.stringify(input.candidate.payload),
      input.candidate.amount,
      input.candidate.currency,
      input.requiresExplicitConfirmation,
      input.cooldownUntil || null,
      input.candidate.detectedAt,
    ],
  );

  return toAction(result.rows[0]);
}

export async function findActiveAutomationActionByDedup(input: {
  userId: string;
  dedupKey: string;
}): Promise<AutomationActionRecord | null> {
  const result = await query<AutomationStoreActionRow>(
    `
      SELECT
        id,
        user_id,
        task_id,
        action_type,
        policy_mode,
        status,
        title,
        summary,
        dedup_key,
        confidence::text,
        coverage_confidence::text,
        explainability,
        payload,
        amount::text,
        currency,
        requires_explicit_confirmation,
        cooldown_until::text,
        snoozed_until::text,
        last_error,
        attempted_at::text,
        completed_at::text,
        dismissed_at::text,
        detected_at::text,
        created_at::text,
        updated_at::text
      FROM automation_actions
      WHERE user_id = $1
        AND dedup_key = $2
        AND status IN ('detected', 'suggested', 'pending_confirm', 'attempted', 'failed', 'snoozed')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.userId, input.dedupKey],
  );

  if (!result.rows[0]) return null;
  return toAction(result.rows[0]);
}

export async function findRecentSuppressionByDedup(input: {
  userId: string;
  dedupKey: string;
  nowIso: string;
}): Promise<{ cooldownUntil: string } | null> {
  const result = await query<{ cooldown_until: string }>(
    `
      SELECT cooldown_until::text
      FROM automation_actions
      WHERE user_id = $1
        AND dedup_key = $2
        AND cooldown_until IS NOT NULL
        AND cooldown_until > $3::timestamptz
      ORDER BY cooldown_until DESC
      LIMIT 1
    `,
    [input.userId, input.dedupKey, input.nowIso],
  );

  if (!result.rows[0]) return null;
  return { cooldownUntil: result.rows[0].cooldown_until };
}

export async function getAutomationAction(input: {
  userId: string;
  actionId: string;
}): Promise<AutomationActionRecord | null> {
  const result = await query<AutomationStoreActionRow>(
    `
      SELECT
        id,
        user_id,
        task_id,
        action_type,
        policy_mode,
        status,
        title,
        summary,
        dedup_key,
        confidence::text,
        coverage_confidence::text,
        explainability,
        payload,
        amount::text,
        currency,
        requires_explicit_confirmation,
        cooldown_until::text,
        snoozed_until::text,
        last_error,
        attempted_at::text,
        completed_at::text,
        dismissed_at::text,
        detected_at::text,
        created_at::text,
        updated_at::text
      FROM automation_actions
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [input.actionId, input.userId],
  );

  if (!result.rows[0]) return null;
  return toAction(result.rows[0]);
}

export async function listAutomationActions(input: {
  userId: string;
  limit?: number;
}): Promise<AutomationActionRecord[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 80, 300));
  const result = await query<AutomationStoreActionRow>(
    `
      SELECT
        id,
        user_id,
        task_id,
        action_type,
        policy_mode,
        status,
        title,
        summary,
        dedup_key,
        confidence::text,
        coverage_confidence::text,
        explainability,
        payload,
        amount::text,
        currency,
        requires_explicit_confirmation,
        cooldown_until::text,
        snoozed_until::text,
        last_error,
        attempted_at::text,
        completed_at::text,
        dismissed_at::text,
        detected_at::text,
        created_at::text,
        updated_at::text
      FROM automation_actions
      WHERE user_id = $1
      ORDER BY
        CASE status
          WHEN 'pending_confirm' THEN 1
          WHEN 'suggested' THEN 2
          WHEN 'attempted' THEN 3
          WHEN 'failed' THEN 4
          WHEN 'detected' THEN 5
          WHEN 'snoozed' THEN 6
          WHEN 'completed' THEN 7
          WHEN 'dismissed' THEN 8
          ELSE 9
        END,
        updated_at DESC
      LIMIT $2
    `,
    [input.userId, limit],
  );

  return result.rows.map(toAction);
}

export async function updateAutomationActionState(input: {
  userId: string;
  actionId: string;
  toStatus: AutomationActionStatus;
  reason?: string | null;
  snoozedUntil?: string | null;
  cooldownUntil?: string | null;
  lastError?: string | null;
}): Promise<AutomationActionRecord> {
  const result = await query<AutomationStoreActionRow>(
    `
      UPDATE automation_actions
      SET
        status = $3,
        snoozed_until = CASE WHEN $3 = 'snoozed' THEN $4::timestamptz ELSE NULL END,
        cooldown_until = $5::timestamptz,
        last_error = $6,
        attempted_at = CASE WHEN $3 = 'attempted' THEN NOW() ELSE attempted_at END,
        completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END,
        dismissed_at = CASE WHEN $3 = 'dismissed' THEN NOW() ELSE dismissed_at END,
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
      RETURNING
        id,
        user_id,
        task_id,
        action_type,
        policy_mode,
        status,
        title,
        summary,
        dedup_key,
        confidence::text,
        coverage_confidence::text,
        explainability,
        payload,
        amount::text,
        currency,
        requires_explicit_confirmation,
        cooldown_until::text,
        snoozed_until::text,
        last_error,
        attempted_at::text,
        completed_at::text,
        dismissed_at::text,
        detected_at::text,
        created_at::text,
        updated_at::text
    `,
    [
      input.actionId,
      input.userId,
      input.toStatus,
      input.snoozedUntil || null,
      input.cooldownUntil || null,
      input.lastError || null,
    ],
  );

  if (!result.rows[0]) {
    throw new Error('Automation action not found');
  }

  return toAction(result.rows[0]);
}

export async function recordAutomationActionEvent(input: {
  userId: string;
  actionId: string;
  eventType: AutomationActionEvent['eventType'];
  fromStatus: AutomationActionStatus | null;
  toStatus: AutomationActionStatus | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ event: AutomationActionEvent; idempotentReplay: boolean }> {
  if (input.idempotencyKey) {
    const replay = await query<AutomationEventRow>(
      `
        SELECT
          id,
          user_id,
          action_id,
          event_type,
          from_status,
          to_status,
          reason,
          idempotency_key,
          metadata,
          created_at::text
        FROM automation_action_events
        WHERE action_id = $1
          AND event_type = $2
          AND idempotency_key = $3
        LIMIT 1
      `,
      [input.actionId, input.eventType, input.idempotencyKey],
    );

    if (replay.rows[0]) {
      return {
        event: toEvent(replay.rows[0]),
        idempotentReplay: true,
      };
    }
  }

  const result = await query<AutomationEventRow>(
    `
      INSERT INTO automation_action_events (
        id,
        user_id,
        action_id,
        event_type,
        from_status,
        to_status,
        reason,
        idempotency_key,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::jsonb
      )
      RETURNING
        id,
        user_id,
        action_id,
        event_type,
        from_status,
        to_status,
        reason,
        idempotency_key,
        metadata,
        created_at::text
    `,
    [
      randomUUID(),
      input.userId,
      input.actionId,
      input.eventType,
      input.fromStatus,
      input.toStatus,
      input.reason || null,
      input.idempotencyKey || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );

  return {
    event: toEvent(result.rows[0]),
    idempotentReplay: false,
  };
}

export async function listAutomationActionEvents(input: {
  userId: string;
  actionId?: string;
  limit?: number;
}): Promise<AutomationActionEvent[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 120, 500));

  const result = input.actionId
    ? await query<AutomationEventRow>(
      `
        SELECT
          id,
          user_id,
          action_id,
          event_type,
          from_status,
          to_status,
          reason,
          idempotency_key,
          metadata,
          created_at::text
        FROM automation_action_events
        WHERE user_id = $1
          AND action_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      `,
      [input.userId, input.actionId, limit],
    )
    : await query<AutomationEventRow>(
      `
        SELECT
          id,
          user_id,
          action_id,
          event_type,
          from_status,
          to_status,
          reason,
          idempotency_key,
          metadata,
          created_at::text
        FROM automation_action_events
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [input.userId, limit],
    );

  return result.rows.map(toEvent);
}

interface SummaryRow extends QueryResultRow {
  suggested_count: string;
  pending_confirm_count: string;
  active_count: string;
  completed_7d_count: string;
  failed_7d_count: string;
  dismissed_7d_count: string;
}

export async function getAutomationSummary(input: {
  userId: string;
  policyMode: AutomationPolicyMode;
}): Promise<AutomationActionSummary> {
  const counts = await query<SummaryRow>(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'suggested')::text AS suggested_count,
        COUNT(*) FILTER (WHERE status = 'pending_confirm')::text AS pending_confirm_count,
        COUNT(*) FILTER (WHERE status IN ('detected', 'suggested', 'pending_confirm', 'attempted', 'failed', 'snoozed'))::text AS active_count,
        COUNT(*) FILTER (WHERE status = 'completed' AND updated_at >= NOW() - INTERVAL '7 days')::text AS completed_7d_count,
        COUNT(*) FILTER (WHERE status = 'failed' AND updated_at >= NOW() - INTERVAL '7 days')::text AS failed_7d_count,
        COUNT(*) FILTER (WHERE status = 'dismissed' AND updated_at >= NOW() - INTERVAL '7 days')::text AS dismissed_7d_count
      FROM automation_actions
      WHERE user_id = $1
    `,
    [input.userId],
  );

  const topResult = await query<AutomationStoreActionRow>(
    `
      SELECT
        id,
        user_id,
        task_id,
        action_type,
        policy_mode,
        status,
        title,
        summary,
        dedup_key,
        confidence::text,
        coverage_confidence::text,
        explainability,
        payload,
        amount::text,
        currency,
        requires_explicit_confirmation,
        cooldown_until::text,
        snoozed_until::text,
        last_error,
        attempted_at::text,
        completed_at::text,
        dismissed_at::text,
        detected_at::text,
        created_at::text,
        updated_at::text
      FROM automation_actions
      WHERE user_id = $1
      ORDER BY confidence DESC, updated_at DESC
      LIMIT 4
    `,
    [input.userId],
  );

  const row = counts.rows[0];
  const topActions = topResult.rows.map(toAction).map((action) => ({
    id: action.id,
    title: action.title,
    actionType: action.actionType,
    status: action.status,
    confidence: action.confidence,
  }));

  return {
    generatedAt: new Date().toISOString(),
    policyMode: input.policyMode,
    suggestedCount: Number(row?.suggested_count || 0),
    pendingConfirmCount: Number(row?.pending_confirm_count || 0),
    activeCount: Number(row?.active_count || 0),
    completed7dCount: Number(row?.completed_7d_count || 0),
    failed7dCount: Number(row?.failed_7d_count || 0),
    dismissed7dCount: Number(row?.dismissed_7d_count || 0),
    topActions,
  };
}
