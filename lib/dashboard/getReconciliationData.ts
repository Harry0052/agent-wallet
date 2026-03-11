import 'server-only';
import { getWalletUserId } from '@/lib/server/ledger';
import { query } from '@/lib/server/db';

export type ReconciliationAuthStatus = 'authorized' | 'pending' | 'failed';
export type ReconciliationCaptureStatus = 'captured' | 'pending' | 'not_captured' | 'failed';
export type ReconciliationActivationStatus = 'active' | 'pending' | 'failed' | 'unverified' | 'not_required';
export type ReconciliationRefundStatus =
  | 'not_requested'
  | 'payment_captured'
  | 'service_not_activated'
  | 'refund_requested'
  | 'refund_in_progress'
  | 'refund_completed'
  | 'dispute_prepared'
  | 'dispute_submitted';

export interface ReconciliationTimelineEntry {
  id: string;
  flowId: string;
  timestamp: string;
  source: 'payment' | 'refund';
  title: string;
  detail: string;
  state: string;
}

export interface ReconciliationRecord {
  paymentFlowId: string;
  merchant: string;
  user: string;
  task: string;
  authStatus: ReconciliationAuthStatus;
  captureStatus: ReconciliationCaptureStatus;
  activationStatus: ReconciliationActivationStatus;
  refundStatus: ReconciliationRefundStatus;
  blockerCode: string | null;
  riskScore: number | null;
  lastEvidenceUpdate: string;
  nextRecommendedAction: string;
  amount: number;
  currency: string;
  fundingMode: string;
  paymentFlowStatus: string;
  taskId: string | null;
  taskIntent: string | null;
  taskStatus: string | null;
  refundCaseId: string | null;
  activationFailureReason: string | null;
  timeline: ReconciliationTimelineEntry[];
}

export interface ReconciliationData {
  generatedAt: string;
  records: ReconciliationRecord[];
  stats: {
    total: number;
    actionRequired: number;
    blocked: number;
    refundedOrDisputed: number;
  };
}

type BaseRow = {
  id: string;
  user_id: string;
  task_id: string | null;
  merchant: string;
  amount: string;
  currency: string;
  funding_mode: string;
  status: string;
  requires_activation_verification: boolean;
  metadata: Record<string, unknown> | null;
  activation_verified_at: string | null;
  authorized_at: string | null;
  captured_at: string | null;
  created_at: string;
  updated_at: string;

  task_intent: string | null;
  task_status: string | null;

  refund_case_id: string | null;
  refund_status: string | null;
  activation_failure_reason: string | null;

  last_event_type: string | null;
  last_event_reason: string | null;
  last_event_details: Record<string, unknown> | null;
  last_event_at: string | null;

  last_audit_action: string | null;
  last_audit_message: string | null;
  last_audit_details: Record<string, unknown> | null;
  last_audit_at: string | null;
};

type EventRow = {
  id: string;
  payment_flow_id: string;
  event_type: string;
  reason: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type AuditRow = {
  id: string;
  payment_flow_id: string;
  action: string;
  from_state: string | null;
  to_state: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asNumber(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string') {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    return trimmed;
  }
  return null;
}

function startCase(input: string): string {
  return input
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function deriveAuthStatus(row: BaseRow): ReconciliationAuthStatus {
  if (row.status === 'failed' && !row.authorized_at) return 'failed';
  if (row.authorized_at) return 'authorized';
  if (row.status === 'authorization_pending') return 'pending';
  return 'authorized';
}

function deriveCaptureStatus(row: BaseRow): ReconciliationCaptureStatus {
  if (row.status === 'failed') return 'failed';
  if (row.status === 'captured' || row.status === 'refund_pending' || row.status === 'refunded') {
    return 'captured';
  }
  if (row.status === 'activation_pending' || row.status === 'capture_pending') {
    return 'pending';
  }
  return 'not_captured';
}

function deriveActivationStatus(row: BaseRow): ReconciliationActivationStatus {
  if (!row.requires_activation_verification) return 'not_required';
  if (row.status === 'activated' || row.activation_verified_at) return 'active';
  if (row.status === 'activation_failed') return 'failed';
  if (row.status === 'activation_pending' || row.status === 'capture_pending') return 'pending';
  if (row.status === 'captured' || row.status === 'refund_pending' || row.status === 'refunded') {
    return 'unverified';
  }
  return 'pending';
}

function deriveRefundStatus(row: BaseRow): ReconciliationRefundStatus {
  const status = row.refund_status;
  if (
    status === 'payment_captured'
    || status === 'service_not_activated'
    || status === 'refund_requested'
    || status === 'refund_in_progress'
    || status === 'refund_completed'
    || status === 'dispute_prepared'
    || status === 'dispute_submitted'
  ) {
    return status;
  }

  if (row.status === 'refunded') return 'refund_completed';
  if (row.status === 'refund_pending') return 'refund_in_progress';
  return 'not_requested';
}

function deriveBlockerCode(row: BaseRow, activationStatus: ReconciliationActivationStatus): string | null {
  const metadata = row.metadata || {};
  const lastEventDetails = row.last_event_details || {};
  const lastAuditDetails = row.last_audit_details || {};

  const explicit = pickString(
    metadata.blocker_code,
    metadata.blockerCode,
    metadata.failure_code,
    metadata.failureCode,
    metadata.error_code,
    lastEventDetails.blocker_code,
    lastEventDetails.blockerCode,
    lastEventDetails.failure_code,
    lastEventDetails.failureCode,
    lastAuditDetails.blocker_code,
    lastAuditDetails.blockerCode,
    lastAuditDetails.failure_code,
    lastAuditDetails.failureCode,
  );

  if (explicit) return explicit;
  if (activationStatus === 'failed') return 'payment_captured_activation_failed';
  if (activationStatus === 'unverified') return 'activation_unverified';
  return null;
}

function deriveRiskScore(row: BaseRow): number | null {
  const metadata = row.metadata || {};
  const event = row.last_event_details || {};

  const direct = asNumber(
    metadata.risk_score
    ?? metadata.riskScore
    ?? metadata.pre_charge_risk_score
    ?? metadata.preChargeRiskScore,
  );
  if (direct !== null) return Math.round(direct * 100) / 100;

  const nested = asNumber(
    (metadata.risk as Record<string, unknown> | undefined)?.overallScore
    ?? (event.risk as Record<string, unknown> | undefined)?.overallScore,
  );
  if (nested !== null) return Math.round(nested * 100) / 100;

  return null;
}

function deriveNextRecommendedAction(input: {
  authStatus: ReconciliationAuthStatus;
  captureStatus: ReconciliationCaptureStatus;
  activationStatus: ReconciliationActivationStatus;
  refundStatus: ReconciliationRefundStatus;
  blockerCode: string | null;
}): string {
  if (input.blockerCode) {
    if (input.blockerCode.includes('policy') || input.blockerCode.includes('human_verification')) {
      return 'Escalate to policy review';
    }
    if (input.blockerCode.includes('activation')) {
      return 'Initiate refund orchestration';
    }
    return 'Investigate blocker and retry';
  }

  if (input.authStatus === 'failed') return 'Retry authorization with valid payment method';
  if (input.authStatus === 'pending') return 'Wait for authorization confirmation';

  if (input.captureStatus === 'pending') return 'Hold capture until activation is verified';

  if (input.activationStatus === 'failed' && input.refundStatus === 'not_requested') {
    return 'Start refund workflow';
  }

  if (
    input.refundStatus === 'refund_requested'
    || input.refundStatus === 'refund_in_progress'
    || input.refundStatus === 'dispute_prepared'
  ) {
    return 'Retry refund/dispute orchestration';
  }

  if (input.refundStatus === 'refund_completed' || input.refundStatus === 'dispute_submitted') {
    return 'Notify user and archive resolution';
  }

  if (input.captureStatus === 'captured' && input.activationStatus === 'active') {
    return 'No action needed';
  }

  if (input.captureStatus === 'captured' && input.activationStatus === 'unverified') {
    return 'Run activation verification check';
  }

  return 'Review audit timeline';
}

function deriveLastEvidenceUpdate(row: BaseRow): string {
  const candidates = [
    row.updated_at,
    row.last_event_at,
    row.last_audit_at,
  ].filter((value): value is string => Boolean(value));

  if (candidates.length === 0) return new Date(0).toISOString();
  return candidates
    .slice()
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function timelineDetailFromEvent(row: EventRow): string {
  const explicit = pickString(row.reason, row.details?.message, row.details?.summary);
  if (explicit) return explicit;
  return startCase(row.event_type);
}

function timelineDetailFromAudit(row: AuditRow): string {
  const stateHop = row.from_state ? `${row.from_state} -> ${row.to_state}` : row.to_state;
  return `${row.message} (${stateHop})`;
}

export async function getReconciliationData(input?: {
  userId?: string;
  limit?: number;
}): Promise<ReconciliationData> {
  const userId = input?.userId || await getWalletUserId();
  const limit = Number.isFinite(input?.limit) && (input?.limit || 0) > 0
    ? Math.min(Math.round(input?.limit || 200), 500)
    : 200;

  const base = await query<BaseRow>(
    `
      SELECT
        pf.id,
        pf.user_id,
        pf.task_id,
        pf.merchant,
        pf.amount::text,
        pf.currency,
        pf.funding_mode,
        pf.status,
        pf.requires_activation_verification,
        pf.metadata,
        pf.activation_verified_at::text,
        pf.authorized_at::text,
        pf.captured_at::text,
        pf.created_at::text,
        pf.updated_at::text,
        at.intent AS task_intent,
        at.status AS task_status,
        rc.id AS refund_case_id,
        rc.status AS refund_status,
        rc.activation_failure_reason,
        pe.event_type AS last_event_type,
        pe.reason AS last_event_reason,
        pe.details AS last_event_details,
        pe.created_at::text AS last_event_at,
        ra.action AS last_audit_action,
        ra.message AS last_audit_message,
        ra.details AS last_audit_details,
        ra.created_at::text AS last_audit_at
      FROM payment_flows pf
      LEFT JOIN agent_tasks at
        ON at.id = pf.task_id
        AND at.user_id = pf.user_id
      LEFT JOIN refund_cases rc
        ON rc.payment_flow_id = pf.id
        AND rc.user_id = pf.user_id
      LEFT JOIN LATERAL (
        SELECT
          e.event_type,
          e.reason,
          e.details,
          e.created_at
        FROM payment_flow_events e
        WHERE e.payment_flow_id = pf.id
        ORDER BY e.created_at DESC
        LIMIT 1
      ) pe ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          r.action,
          r.message,
          r.details,
          r.created_at
        FROM refund_audit_logs r
        WHERE r.payment_flow_id = pf.id
        ORDER BY r.created_at DESC
        LIMIT 1
      ) ra ON TRUE
      WHERE pf.user_id = $1
      ORDER BY pf.created_at DESC
      LIMIT $2
    `,
    [userId, limit],
  );

  const flowIds = base.rows.map((row) => row.id);

  const [eventsResult, auditsResult] = flowIds.length > 0
    ? await Promise.all([
      query<EventRow>(
        `
          SELECT
            id,
            payment_flow_id,
            event_type,
            reason,
            details,
            created_at::text
          FROM payment_flow_events
          WHERE payment_flow_id = ANY($1::text[])
          ORDER BY created_at ASC
        `,
        [flowIds],
      ),
      query<AuditRow>(
        `
          SELECT
            id,
            payment_flow_id,
            action,
            from_state,
            to_state,
            message,
            details,
            created_at::text
          FROM refund_audit_logs
          WHERE payment_flow_id = ANY($1::text[])
          ORDER BY created_at ASC
        `,
        [flowIds],
      ),
    ])
    : [{ rows: [] as EventRow[] }, { rows: [] as AuditRow[] }];

  const timelineByFlow = new Map<string, ReconciliationTimelineEntry[]>();

  for (const event of eventsResult.rows) {
    const entries = timelineByFlow.get(event.payment_flow_id) || [];
    entries.push({
      id: event.id,
      flowId: event.payment_flow_id,
      timestamp: event.created_at,
      source: 'payment',
      title: `Payment ${startCase(event.event_type)}`,
      detail: timelineDetailFromEvent(event),
      state: event.event_type,
    });
    timelineByFlow.set(event.payment_flow_id, entries);
  }

  for (const audit of auditsResult.rows) {
    const entries = timelineByFlow.get(audit.payment_flow_id) || [];
    entries.push({
      id: audit.id,
      flowId: audit.payment_flow_id,
      timestamp: audit.created_at,
      source: 'refund',
      title: `Refund ${startCase(audit.action)}`,
      detail: timelineDetailFromAudit(audit),
      state: audit.to_state,
    });
    timelineByFlow.set(audit.payment_flow_id, entries);
  }

  for (const [flowId, entries] of timelineByFlow.entries()) {
    entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    timelineByFlow.set(flowId, entries);
  }

  const records: ReconciliationRecord[] = base.rows.map((row) => {
    const authStatus = deriveAuthStatus(row);
    const captureStatus = deriveCaptureStatus(row);
    const activationStatus = deriveActivationStatus(row);
    const refundStatus = deriveRefundStatus(row);
    const blockerCode = deriveBlockerCode(row, activationStatus);
    const riskScore = deriveRiskScore(row);

    return {
      paymentFlowId: row.id,
      merchant: row.merchant,
      user: row.user_id,
      task: row.task_intent || row.task_id || 'N/A',
      authStatus,
      captureStatus,
      activationStatus,
      refundStatus,
      blockerCode,
      riskScore,
      lastEvidenceUpdate: deriveLastEvidenceUpdate(row),
      nextRecommendedAction: deriveNextRecommendedAction({
        authStatus,
        captureStatus,
        activationStatus,
        refundStatus,
        blockerCode,
      }),
      amount: toNumber(row.amount),
      currency: row.currency.toUpperCase(),
      fundingMode: row.funding_mode,
      paymentFlowStatus: row.status,
      taskId: row.task_id,
      taskIntent: row.task_intent,
      taskStatus: row.task_status,
      refundCaseId: row.refund_case_id,
      activationFailureReason: row.activation_failure_reason,
      timeline: timelineByFlow.get(row.id) || [],
    };
  });

  const stats = {
    total: records.length,
    actionRequired: records.filter((record) => record.nextRecommendedAction !== 'No action needed').length,
    blocked: records.filter((record) => Boolean(record.blockerCode)).length,
    refundedOrDisputed: records.filter((record) => (
      record.refundStatus === 'refund_completed' || record.refundStatus === 'dispute_submitted'
    )).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    records,
    stats,
  };
}
