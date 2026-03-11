import { randomUUID } from 'node:crypto';
import {
  buildRefundEvidencePack,
  buildRefundUserExplanation,
  type RefundEvidencePack,
} from './evidencePack.ts';

type QueryFn = <T>(text: string, params?: unknown[]) => Promise<{
  rows: T[];
  rowCount: number | null;
}>;

let queryImpl: QueryFn | null = null;

async function runQuery<T>(text: string, params?: unknown[]): Promise<{
  rows: T[];
  rowCount: number | null;
}> {
  if (!queryImpl) {
    const db = await import('../server/db.ts');
    queryImpl = db.query as QueryFn;
  }
  return queryImpl<T>(text, params);
}

export type RefundState =
  | 'payment_captured'
  | 'service_not_activated'
  | 'refund_requested'
  | 'refund_in_progress'
  | 'refund_completed'
  | 'dispute_prepared'
  | 'dispute_submitted';

export interface RefundCase {
  id: string;
  userId: string;
  paymentFlowId: string;
  status: RefundState;
  merchant: string;
  amount: number;
  currency: string;
  activationFailureReason: string | null;
  initiateIdempotencyKey: string | null;
  merchantAdapterId: string | null;
  merchantReferenceId: string | null;
  processorReferenceId: string | null;
  disputeId: string | null;
  evidencePack: RefundEvidencePack | null;
  userExplanation: string | null;
  retryCount: number;
  nextRetryAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefundAuditLog {
  id: string;
  refundCaseId: string;
  userId: string;
  paymentFlowId: string;
  fromState: RefundState | null;
  toState: RefundState;
  action: string;
  message: string;
  details: Record<string, unknown> | null;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface RefundPaymentSnapshot {
  paymentFlowId: string;
  userId: string;
  merchant: string;
  amount: number;
  currency: string;
  status: string;
  stripePaymentIntentId: string | null;
  metadata: Record<string, unknown> | null;
  capturedAt: string | null;
  activationFailureDetected: boolean;
  activationFailureReason: string | null;
  activationFailureEvidence: Record<string, unknown> | null;
}

export interface RefundCandidate {
  paymentFlowId: string;
  userId: string;
  reason: string;
}

export type MerchantRefundResult =
  | {
    status: 'completed';
    referenceId: string;
    message: string;
    raw?: Record<string, unknown> | null;
  }
  | {
    status: 'in_progress';
    referenceId?: string;
    message: string;
    retryAfterMs?: number;
    raw?: Record<string, unknown> | null;
  }
  | {
    status: 'unavailable';
    message: string;
    raw?: Record<string, unknown> | null;
  };

export interface MerchantRefundAdapter {
  id: string;
  supports(payment: RefundPaymentSnapshot): Promise<boolean> | boolean;
  requestRefund(input: {
    refundCase: RefundCase;
    payment: RefundPaymentSnapshot;
    reason: string;
    idempotencyKey: string;
  }): Promise<MerchantRefundResult>;
}

export interface ProcessorFallbackResult {
  submitted: boolean;
  referenceId?: string;
  disputeId?: string;
  message: string;
  raw?: Record<string, unknown> | null;
}

export interface ProcessorFallbackAdapter {
  id: string;
  submitDisputePacket(input: {
    refundCase: RefundCase;
    payment: RefundPaymentSnapshot;
    evidencePack: RefundEvidencePack;
    idempotencyKey: string;
  }): Promise<ProcessorFallbackResult>;
}

export type RefundFailureClass = 'retryable' | 'unavailable' | 'permanent';

export interface RefundFailureClassification {
  class: RefundFailureClass;
  message: string;
}

export function classifyRefundFailure(error: unknown): RefundFailureClassification {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('timeout')
    || normalized.includes('temporarily')
    || normalized.includes('network')
    || normalized.includes('connection')
    || normalized.includes('rate limit')
    || normalized.includes('429')
  ) {
    return { class: 'retryable', message };
  }

  if (
    normalized.includes('unsupported')
    || normalized.includes('unavailable')
    || normalized.includes('not supported')
    || normalized.includes('no refund route')
  ) {
    return { class: 'unavailable', message };
  }

  return { class: 'permanent', message };
}

export interface RefundStore {
  getPaymentSnapshot(userId: string, paymentFlowId: string): Promise<RefundPaymentSnapshot | null>;
  detectCapturedButUnfulfilled(userId: string, limit: number): Promise<RefundCandidate[]>;
  findRefundCaseByPayment(userId: string, paymentFlowId: string): Promise<RefundCase | null>;
  findRefundCaseById(userId: string, refundCaseId: string): Promise<RefundCase | null>;
  createOrGetRefundCase(input: {
    userId: string;
    payment: RefundPaymentSnapshot;
    idempotencyKey: string;
    activationFailureReason: string;
  }): Promise<RefundCase>;
  updateRefundCase(
    userId: string,
    refundCaseId: string,
    patch: Partial<Pick<
      RefundCase,
      | 'status'
      | 'merchantAdapterId'
      | 'merchantReferenceId'
      | 'processorReferenceId'
      | 'disputeId'
      | 'evidencePack'
      | 'userExplanation'
      | 'retryCount'
      | 'nextRetryAt'
      | 'lastError'
    >>,
  ): Promise<RefundCase>;
  appendAudit(input: {
    refundCaseId: string;
    userId: string;
    paymentFlowId: string;
    fromState: RefundState | null;
    toState: RefundState;
    action: string;
    message: string;
    details?: Record<string, unknown> | null;
    idempotencyKey?: string | null;
  }): Promise<RefundAuditLog>;
  listAuditLogs(userId: string, refundCaseId: string): Promise<RefundAuditLog[]>;
  listDueCases(userId: string, nowIso: string, limit: number): Promise<RefundCase[]>;
  markPaymentFlowRefunded(input: {
    userId: string;
    paymentFlowId: string;
    idempotencyKey: string;
    reason: string;
  }): Promise<void>;
}

type RefundCaseRow = {
  id: string;
  user_id: string;
  payment_flow_id: string;
  status: RefundState;
  merchant: string;
  amount: string;
  currency: string;
  activation_failure_reason: string | null;
  initiate_idempotency_key: string | null;
  merchant_adapter_id: string | null;
  merchant_reference_id: string | null;
  processor_reference_id: string | null;
  dispute_id: string | null;
  evidence_pack: RefundEvidencePack | null;
  user_explanation: string | null;
  retry_count: number;
  next_retry_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type RefundAuditRow = {
  id: string;
  refund_case_id: string;
  user_id: string;
  payment_flow_id: string;
  from_state: RefundState | null;
  to_state: RefundState;
  action: string;
  message: string;
  details: Record<string, unknown> | null;
  idempotency_key: string | null;
  created_at: string;
};

type PaymentSnapshotRow = {
  payment_flow_id: string;
  user_id: string;
  merchant: string;
  amount: string;
  currency: string;
  status: string;
  stripe_payment_intent_id: string | null;
  metadata: Record<string, unknown> | null;
  captured_at: string | null;
  activation_failure_detected: boolean;
  activation_failure_reason: string | null;
  activation_failure_evidence: Record<string, unknown> | null;
};

function toRefundCase(row: RefundCaseRow): RefundCase {
  return {
    id: row.id,
    userId: row.user_id,
    paymentFlowId: row.payment_flow_id,
    status: row.status,
    merchant: row.merchant,
    amount: Number(row.amount),
    currency: row.currency,
    activationFailureReason: row.activation_failure_reason,
    initiateIdempotencyKey: row.initiate_idempotency_key,
    merchantAdapterId: row.merchant_adapter_id,
    merchantReferenceId: row.merchant_reference_id,
    processorReferenceId: row.processor_reference_id,
    disputeId: row.dispute_id,
    evidencePack: row.evidence_pack || null,
    userExplanation: row.user_explanation,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRefundAudit(row: RefundAuditRow): RefundAuditLog {
  return {
    id: row.id,
    refundCaseId: row.refund_case_id,
    userId: row.user_id,
    paymentFlowId: row.payment_flow_id,
    fromState: row.from_state,
    toState: row.to_state,
    action: row.action,
    message: row.message,
    details: row.details || null,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

function toPaymentSnapshot(row: PaymentSnapshotRow): RefundPaymentSnapshot {
  return {
    paymentFlowId: row.payment_flow_id,
    userId: row.user_id,
    merchant: row.merchant,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    metadata: row.metadata || null,
    capturedAt: row.captured_at,
    activationFailureDetected: row.activation_failure_detected,
    activationFailureReason: row.activation_failure_reason,
    activationFailureEvidence: row.activation_failure_evidence || null,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function computeRetryDelayMs(retryCount: number): number {
  const attempt = Math.max(1, retryCount + 1);
  const delay = 2_000 * (2 ** (attempt - 1));
  return Math.min(delay, 10 * 60_000);
}

function isFinalState(state: RefundState): boolean {
  return state === 'refund_completed' || state === 'dispute_submitted';
}

export function createPostgresRefundStore(): RefundStore {
  async function selectRefundCase(where: string, params: unknown[]): Promise<RefundCase | null> {
    const result = await runQuery<RefundCaseRow>(
      `
        SELECT
          id,
          user_id,
          payment_flow_id,
          status,
          merchant,
          amount::text,
          currency,
          activation_failure_reason,
          initiate_idempotency_key,
          merchant_adapter_id,
          merchant_reference_id,
          processor_reference_id,
          dispute_id,
          evidence_pack,
          user_explanation,
          retry_count,
          next_retry_at::text,
          last_error,
          created_at::text,
          updated_at::text
        FROM refund_cases
        WHERE ${where}
        LIMIT 1
      `,
      params,
    );

    if (!result.rows[0]) return null;
    return toRefundCase(result.rows[0]);
  }

  async function selectPaymentSnapshot(
    where: string,
    params: unknown[],
    limit = 1,
  ): Promise<RefundPaymentSnapshot[]> {
    const result = await runQuery<PaymentSnapshotRow>(
      `
        SELECT
          pf.id AS payment_flow_id,
          pf.user_id,
          pf.merchant,
          pf.amount::text,
          pf.currency,
          pf.status,
          pf.stripe_payment_intent_id,
          pf.metadata,
          pf.captured_at::text,
          (af.created_at IS NOT NULL) AS activation_failure_detected,
          af.reason AS activation_failure_reason,
          af.details AS activation_failure_evidence
        FROM payment_flows pf
        LEFT JOIN LATERAL (
          SELECT created_at, reason, details
          FROM payment_flow_events e
          WHERE e.payment_flow_id = pf.id
            AND e.event_type = 'activation_failed'
          ORDER BY created_at DESC
          LIMIT 1
        ) af ON true
        WHERE ${where}
        ORDER BY COALESCE(af.created_at, pf.updated_at) DESC
        LIMIT ${limit}
      `,
      params,
    );

    return result.rows.map(toPaymentSnapshot);
  }

  return {
    async getPaymentSnapshot(userId, paymentFlowId) {
      const rows = await selectPaymentSnapshot('pf.user_id = $1 AND pf.id = $2', [userId, paymentFlowId], 1);
      return rows[0] || null;
    },

    async detectCapturedButUnfulfilled(userId, limit) {
      const result = await runQuery<{ payment_flow_id: string; user_id: string; reason: string }>(
        `
          SELECT
            pf.id AS payment_flow_id,
            pf.user_id,
            COALESCE(af.reason, 'Activation failed after payment capture') AS reason
          FROM payment_flows pf
          INNER JOIN LATERAL (
            SELECT created_at, reason
            FROM payment_flow_events e
            WHERE e.payment_flow_id = pf.id
              AND e.event_type = 'activation_failed'
            ORDER BY created_at DESC
            LIMIT 1
          ) af ON true
          LEFT JOIN refund_cases rc
            ON rc.payment_flow_id = pf.id
           AND rc.user_id = pf.user_id
          WHERE pf.user_id = $1
            AND pf.status = 'captured'
            AND (
              rc.id IS NULL
              OR rc.status IN ('refund_requested', 'refund_in_progress', 'dispute_prepared')
            )
          ORDER BY af.created_at ASC
          LIMIT $2
        `,
        [userId, limit],
      );

      return result.rows.map((row) => ({
        paymentFlowId: row.payment_flow_id,
        userId: row.user_id,
        reason: row.reason,
      }));
    },

    async findRefundCaseByPayment(userId, paymentFlowId) {
      return selectRefundCase('user_id = $1 AND payment_flow_id = $2', [userId, paymentFlowId]);
    },

    async findRefundCaseById(userId, refundCaseId) {
      return selectRefundCase('user_id = $1 AND id = $2', [userId, refundCaseId]);
    },

    async createOrGetRefundCase(input) {
      const caseId = randomUUID();
      const result = await runQuery<RefundCaseRow>(
        `
          INSERT INTO refund_cases (
            id,
            user_id,
            payment_flow_id,
            status,
            merchant,
            amount,
            currency,
            activation_failure_reason,
            initiate_idempotency_key,
            retry_count,
            next_retry_at
          )
          VALUES (
            $1, $2, $3, 'payment_captured', $4, $5, lower($6), $7, $8, 0, NOW()
          )
          ON CONFLICT (user_id, payment_flow_id)
          DO UPDATE SET updated_at = NOW()
          RETURNING
            id,
            user_id,
            payment_flow_id,
            status,
            merchant,
            amount::text,
            currency,
            activation_failure_reason,
            initiate_idempotency_key,
            merchant_adapter_id,
            merchant_reference_id,
            processor_reference_id,
            dispute_id,
            evidence_pack,
            user_explanation,
            retry_count,
            next_retry_at::text,
            last_error,
            created_at::text,
            updated_at::text
        `,
        [
          caseId,
          input.userId,
          input.payment.paymentFlowId,
          input.payment.merchant,
          input.payment.amount,
          input.payment.currency,
          input.activationFailureReason,
          input.idempotencyKey,
        ],
      );

      return toRefundCase(result.rows[0]);
    },

    async updateRefundCase(userId, refundCaseId, patch) {
      const current = await selectRefundCase('user_id = $1 AND id = $2', [userId, refundCaseId]);
      if (!current) throw new Error(`Refund case not found: ${refundCaseId}`);

      const next = {
        status: patch.status ?? current.status,
        merchantAdapterId: patch.merchantAdapterId ?? current.merchantAdapterId,
        merchantReferenceId: patch.merchantReferenceId ?? current.merchantReferenceId,
        processorReferenceId: patch.processorReferenceId ?? current.processorReferenceId,
        disputeId: patch.disputeId ?? current.disputeId,
        evidencePack: patch.evidencePack ?? current.evidencePack,
        userExplanation: patch.userExplanation ?? current.userExplanation,
        retryCount: patch.retryCount ?? current.retryCount,
        nextRetryAt: patch.nextRetryAt ?? current.nextRetryAt,
        lastError: patch.lastError ?? current.lastError,
      };

      const result = await runQuery<RefundCaseRow>(
        `
          UPDATE refund_cases
          SET
            status = $3,
            merchant_adapter_id = $4,
            merchant_reference_id = $5,
            processor_reference_id = $6,
            dispute_id = $7,
            evidence_pack = $8::jsonb,
            user_explanation = $9,
            retry_count = $10,
            next_retry_at = $11::timestamptz,
            last_error = $12,
            updated_at = NOW()
          WHERE user_id = $1
            AND id = $2
          RETURNING
            id,
            user_id,
            payment_flow_id,
            status,
            merchant,
            amount::text,
            currency,
            activation_failure_reason,
            initiate_idempotency_key,
            merchant_adapter_id,
            merchant_reference_id,
            processor_reference_id,
            dispute_id,
            evidence_pack,
            user_explanation,
            retry_count,
            next_retry_at::text,
            last_error,
            created_at::text,
            updated_at::text
        `,
        [
          userId,
          refundCaseId,
          next.status,
          next.merchantAdapterId,
          next.merchantReferenceId,
          next.processorReferenceId,
          next.disputeId,
          next.evidencePack ? JSON.stringify(next.evidencePack) : null,
          next.userExplanation,
          next.retryCount,
          next.nextRetryAt,
          next.lastError,
        ],
      );

      return toRefundCase(result.rows[0]);
    },

    async appendAudit(input) {
      const auditId = randomUUID();
      const result = await runQuery<RefundAuditRow>(
        `
          INSERT INTO refund_audit_logs (
            id,
            refund_case_id,
            user_id,
            payment_flow_id,
            from_state,
            to_state,
            action,
            message,
            details,
            idempotency_key
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10
          )
          ON CONFLICT DO NOTHING
          RETURNING
            id,
            refund_case_id,
            user_id,
            payment_flow_id,
            from_state,
            to_state,
            action,
            message,
            details,
            idempotency_key,
            created_at::text
        `,
        [
          auditId,
          input.refundCaseId,
          input.userId,
          input.paymentFlowId,
          input.fromState,
          input.toState,
          input.action,
          input.message,
          input.details ? JSON.stringify(input.details) : null,
          input.idempotencyKey || null,
        ],
      );

      if (result.rows[0]) return toRefundAudit(result.rows[0]);

      const existing = await runQuery<RefundAuditRow>(
        `
          SELECT
            id,
            refund_case_id,
            user_id,
            payment_flow_id,
            from_state,
            to_state,
            action,
            message,
            details,
            idempotency_key,
            created_at::text
          FROM refund_audit_logs
          WHERE refund_case_id = $1
            AND action = $2
            AND ($3::text IS NULL OR idempotency_key = $3)
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [input.refundCaseId, input.action, input.idempotencyKey || null],
      );
      if (!existing.rows[0]) {
        throw new Error('Failed to append refund audit log');
      }
      return toRefundAudit(existing.rows[0]);
    },

    async listAuditLogs(userId, refundCaseId) {
      const result = await runQuery<RefundAuditRow>(
        `
          SELECT
            id,
            refund_case_id,
            user_id,
            payment_flow_id,
            from_state,
            to_state,
            action,
            message,
            details,
            idempotency_key,
            created_at::text
          FROM refund_audit_logs
          WHERE user_id = $1
            AND refund_case_id = $2
          ORDER BY created_at ASC
        `,
        [userId, refundCaseId],
      );
      return result.rows.map(toRefundAudit);
    },

    async listDueCases(userId, now, limit) {
      const result = await runQuery<RefundCaseRow>(
        `
          SELECT
            id,
            user_id,
            payment_flow_id,
            status,
            merchant,
            amount::text,
            currency,
            activation_failure_reason,
            initiate_idempotency_key,
            merchant_adapter_id,
            merchant_reference_id,
            processor_reference_id,
            dispute_id,
            evidence_pack,
            user_explanation,
            retry_count,
            next_retry_at::text,
            last_error,
            created_at::text,
            updated_at::text
          FROM refund_cases
          WHERE user_id = $1
            AND status IN ('refund_requested', 'refund_in_progress', 'dispute_prepared')
            AND next_retry_at <= $2::timestamptz
          ORDER BY next_retry_at ASC
          LIMIT $3
        `,
        [userId, now, limit],
      );
      return result.rows.map(toRefundCase);
    },

    async markPaymentFlowRefunded(input) {
      await runQuery(
        `
          UPDATE payment_flows
          SET
            status = 'refunded',
            refunded_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
          WHERE user_id = $1
            AND id = $2
        `,
        [
          input.userId,
          input.paymentFlowId,
          JSON.stringify({
            refund_orchestration: 'completed',
            refund_reason: input.reason,
          }),
        ],
      );

      await runQuery(
        `
          INSERT INTO payment_flow_events (
            id,
            payment_flow_id,
            user_id,
            event_type,
            amount,
            currency,
            idempotency_key,
            reason,
            details
          )
          SELECT
            $1,
            pf.id,
            pf.user_id,
            'refunded',
            pf.amount,
            pf.currency,
            $2,
            $3,
            $4::jsonb
          FROM payment_flows pf
          WHERE pf.user_id = $5
            AND pf.id = $6
          ON CONFLICT DO NOTHING
        `,
        [
          randomUUID(),
          input.idempotencyKey,
          input.reason,
          JSON.stringify({
            source: 'refund_engine',
          }),
          input.userId,
          input.paymentFlowId,
        ],
      );
    },
  };
}

export interface RefundEngineLogger {
  info(event: string, payload: Record<string, unknown>): void;
  warn(event: string, payload: Record<string, unknown>): void;
  error(event: string, payload: Record<string, unknown>): void;
}

export interface InitiateRefundInput {
  userId: string;
  paymentFlowId: string;
  idempotencyKey: string;
  activationFailureReason?: string;
  activationEvidence?: Record<string, unknown> | null;
  allowWithoutActivationFailure?: boolean;
}

export interface RefundStatusResult {
  refundCase: RefundCase;
  auditLogs: RefundAuditLog[];
  userExplanation: string;
}

export interface RefundSchedulerResult {
  detected: number;
  initiated: number;
  processed: number;
}

function ensureIdempotencyKey(input: string): string {
  const key = input.trim();
  if (!key) throw new Error('idempotencyKey is required');
  return key;
}

function ensureActivationFailureReason(input: string | null | undefined): string {
  const reason = (input || '').trim();
  return reason || 'Service was not activated after payment capture';
}

async function pickMerchantAdapter(
  adapters: MerchantRefundAdapter[],
  payment: RefundPaymentSnapshot,
): Promise<MerchantRefundAdapter | null> {
  for (const adapter of adapters) {
    const supported = await adapter.supports(payment);
    if (supported) return adapter;
  }
  return null;
}

async function transitionCase(
  store: RefundStore,
  input: {
    refundCase: RefundCase;
    toState: RefundState;
    action: string;
    message: string;
    idempotencyKey: string;
    details?: Record<string, unknown> | null;
    patch?: Partial<Pick<
      RefundCase,
      | 'merchantAdapterId'
      | 'merchantReferenceId'
      | 'processorReferenceId'
      | 'disputeId'
      | 'evidencePack'
      | 'userExplanation'
      | 'retryCount'
      | 'nextRetryAt'
      | 'lastError'
    >>;
  },
): Promise<RefundCase> {
  const current = input.refundCase;
  if (current.status !== input.toState) {
    const updated = await store.updateRefundCase(current.userId, current.id, {
      status: input.toState,
      ...(input.patch || {}),
    });

    await store.appendAudit({
      refundCaseId: current.id,
      userId: current.userId,
      paymentFlowId: current.paymentFlowId,
      fromState: current.status,
      toState: input.toState,
      action: input.action,
      message: input.message,
      details: input.details || null,
      idempotencyKey: input.idempotencyKey,
    });
    return updated;
  }

  await store.appendAudit({
    refundCaseId: current.id,
    userId: current.userId,
    paymentFlowId: current.paymentFlowId,
    fromState: current.status,
    toState: input.toState,
    action: input.action,
    message: input.message,
    details: input.details || null,
    idempotencyKey: input.idempotencyKey,
  });
  return store.updateRefundCase(current.userId, current.id, {
    ...(input.patch || {}),
  });
}

export function createRefundEngine(params: {
  store: RefundStore;
  merchantAdapters?: MerchantRefundAdapter[];
  processorFallback: ProcessorFallbackAdapter;
  logger?: RefundEngineLogger;
}) {
  const store = params.store;
  const merchantAdapters = params.merchantAdapters || [];
  const processorFallback = params.processorFallback;
  const logger = params.logger || {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };

  async function processRefundCase(input: {
    userId: string;
    refundCaseId: string;
    idempotencyKey: string;
  }): Promise<RefundCase> {
    const opKey = ensureIdempotencyKey(input.idempotencyKey);
    let refundCase = await store.findRefundCaseById(input.userId, input.refundCaseId);
    if (!refundCase) throw new Error(`Refund case not found: ${input.refundCaseId}`);
    if (isFinalState(refundCase.status)) return refundCase;

    const payment = await store.getPaymentSnapshot(input.userId, refundCase.paymentFlowId);
    if (!payment) throw new Error(`Payment flow not found: ${refundCase.paymentFlowId}`);

    const reason = ensureActivationFailureReason(refundCase.activationFailureReason || payment.activationFailureReason);
    const merchantAdapter = await pickMerchantAdapter(merchantAdapters, payment);

    if (merchantAdapter) {
      refundCase = await transitionCase(store, {
        refundCase,
        toState: 'refund_in_progress',
        action: 'merchant_refund_started',
        message: `Attempting merchant-side refund via ${merchantAdapter.id}.`,
        idempotencyKey: `${opKey}:merchant:start`,
        patch: {
          merchantAdapterId: merchantAdapter.id,
        },
      });

      try {
        const merchantResult = await merchantAdapter.requestRefund({
          refundCase,
          payment,
          reason,
          idempotencyKey: `${opKey}:merchant:request`,
        });

        if (merchantResult.status === 'completed') {
          const explanation = buildRefundUserExplanation({
            state: 'refund_completed',
            merchant: payment.merchant,
            amount: payment.amount,
            currency: payment.currency,
            reason,
            referenceId: merchantResult.referenceId,
          });

          refundCase = await transitionCase(store, {
            refundCase,
            toState: 'refund_completed',
            action: 'merchant_refund_completed',
            message: merchantResult.message,
            idempotencyKey: `${opKey}:merchant:completed`,
            details: merchantResult.raw || null,
            patch: {
              merchantReferenceId: merchantResult.referenceId,
              userExplanation: explanation,
              lastError: null,
            },
          });

          await store.markPaymentFlowRefunded({
            userId: input.userId,
            paymentFlowId: payment.paymentFlowId,
            idempotencyKey: `${opKey}:mark_refunded`,
            reason,
          });
          return refundCase;
        }

        if (merchantResult.status === 'in_progress') {
          const retryAfterMs = merchantResult.retryAfterMs ?? computeRetryDelayMs(refundCase.retryCount);
          const nextRetryAt = addMs(nowIso(), retryAfterMs);
          return transitionCase(store, {
            refundCase,
            toState: 'refund_in_progress',
            action: 'merchant_refund_pending',
            message: merchantResult.message,
            idempotencyKey: `${opKey}:merchant:pending`,
            details: merchantResult.raw || null,
            patch: {
              merchantReferenceId: merchantResult.referenceId || refundCase.merchantReferenceId,
              retryCount: refundCase.retryCount + 1,
              nextRetryAt,
              lastError: null,
            },
          });
        }

        logger.warn('refunds.merchant.unavailable', {
          userId: input.userId,
          refundCaseId: refundCase.id,
          reason: merchantResult.message,
        });
      } catch (error) {
        const classified = classifyRefundFailure(error);
        if (classified.class === 'retryable') {
          const nextRetryAt = addMs(nowIso(), computeRetryDelayMs(refundCase.retryCount));
          return transitionCase(store, {
            refundCase,
            toState: 'refund_in_progress',
            action: 'merchant_refund_retry_scheduled',
            message: classified.message,
            idempotencyKey: `${opKey}:merchant:retry`,
            patch: {
              retryCount: refundCase.retryCount + 1,
              nextRetryAt,
              lastError: classified.message,
            },
          });
        }
      }
    }

    const audits = await store.listAuditLogs(input.userId, refundCase.id);
    const evidencePack = buildRefundEvidencePack({
      refundCase,
      payment,
      auditLogs: audits,
      activationFailureReason: reason,
      activationEvidence: payment.activationFailureEvidence,
    });

    refundCase = await transitionCase(store, {
      refundCase,
      toState: 'dispute_prepared',
      action: 'processor_dispute_prepared',
      message: 'Prepared processor fallback dispute packet.',
      idempotencyKey: `${opKey}:processor:prepared`,
      patch: {
        evidencePack,
        userExplanation: buildRefundUserExplanation({
          state: 'dispute_prepared',
          merchant: payment.merchant,
          amount: payment.amount,
          currency: payment.currency,
          reason,
        }),
        lastError: null,
      },
    });

    try {
      const processorResult = await processorFallback.submitDisputePacket({
        refundCase,
        payment,
        evidencePack,
        idempotencyKey: `${opKey}:processor:submit`,
      });

      if (!processorResult.submitted) {
        const nextRetryAt = addMs(nowIso(), computeRetryDelayMs(refundCase.retryCount));
        return transitionCase(store, {
          refundCase,
          toState: 'dispute_prepared',
          action: 'processor_dispute_pending',
          message: processorResult.message,
          idempotencyKey: `${opKey}:processor:pending`,
          details: processorResult.raw || null,
          patch: {
            processorReferenceId: processorResult.referenceId || refundCase.processorReferenceId,
            retryCount: refundCase.retryCount + 1,
            nextRetryAt,
            lastError: processorResult.message,
          },
        });
      }

      return transitionCase(store, {
        refundCase,
        toState: 'dispute_submitted',
        action: 'processor_dispute_submitted',
        message: processorResult.message,
        idempotencyKey: `${opKey}:processor:submitted`,
        details: processorResult.raw || null,
        patch: {
          processorReferenceId: processorResult.referenceId || refundCase.processorReferenceId,
          disputeId: processorResult.disputeId || refundCase.disputeId,
          userExplanation: buildRefundUserExplanation({
            state: 'dispute_submitted',
            merchant: payment.merchant,
            amount: payment.amount,
            currency: payment.currency,
            reason,
            referenceId: processorResult.disputeId || processorResult.referenceId,
          }),
          lastError: null,
        },
      });
    } catch (error) {
      const classified = classifyRefundFailure(error);
      const nextRetryAt = addMs(nowIso(), computeRetryDelayMs(refundCase.retryCount));
      return transitionCase(store, {
        refundCase,
        toState: 'dispute_prepared',
        action: 'processor_dispute_retry_scheduled',
        message: classified.message,
        idempotencyKey: `${opKey}:processor:retry`,
        patch: {
          retryCount: refundCase.retryCount + 1,
          nextRetryAt,
          lastError: classified.message,
        },
      });
    }
  }

  async function initiateRefund(input: InitiateRefundInput): Promise<RefundStatusResult> {
    const idempotencyKey = ensureIdempotencyKey(input.idempotencyKey);
    const payment = await store.getPaymentSnapshot(input.userId, input.paymentFlowId);
    if (!payment) {
      throw new Error(`Payment flow not found: ${input.paymentFlowId}`);
    }
    if (payment.status !== 'captured') {
      throw new Error('INVALID_STATE: payment must be captured before refund orchestration');
    }

    const activationFailureReason = ensureActivationFailureReason(
      input.activationFailureReason
      || payment.activationFailureReason,
    );
    if (!input.allowWithoutActivationFailure && !payment.activationFailureDetected) {
      throw new Error('INVALID_STATE: activation failure not detected for captured payment');
    }

    let refundCase = await store.createOrGetRefundCase({
      userId: input.userId,
      payment,
      idempotencyKey,
      activationFailureReason,
    });

    await store.appendAudit({
      refundCaseId: refundCase.id,
      userId: refundCase.userId,
      paymentFlowId: refundCase.paymentFlowId,
      fromState: refundCase.status,
      toState: refundCase.status,
      action: 'refund_initiated',
      message: `Refund orchestration initiated for ${refundCase.merchant}.`,
      details: {
        activationFailureReason,
        activationEvidence: input.activationEvidence || payment.activationFailureEvidence || null,
      },
      idempotencyKey: idempotencyKey,
    });

    if (refundCase.status === 'payment_captured') {
      refundCase = await transitionCase(store, {
        refundCase,
        toState: 'service_not_activated',
        action: 'service_not_activated',
        message: activationFailureReason,
        idempotencyKey: `${idempotencyKey}:service_not_activated`,
      });
    }

    if (refundCase.status === 'service_not_activated') {
      refundCase = await transitionCase(store, {
        refundCase,
        toState: 'refund_requested',
        action: 'refund_requested',
        message: 'Refund requested automatically after activation failure.',
        idempotencyKey: `${idempotencyKey}:refund_requested`,
      });
    }

    if (!isFinalState(refundCase.status)) {
      refundCase = await processRefundCase({
        userId: input.userId,
        refundCaseId: refundCase.id,
        idempotencyKey: `${idempotencyKey}:process`,
      });
    }

    const auditLogs = await store.listAuditLogs(input.userId, refundCase.id);
    const userExplanation = refundCase.userExplanation || buildRefundUserExplanation({
      state: refundCase.status,
      merchant: refundCase.merchant,
      amount: refundCase.amount,
      currency: refundCase.currency,
      reason: activationFailureReason,
      referenceId: refundCase.disputeId || refundCase.merchantReferenceId || refundCase.processorReferenceId || undefined,
    });

    return {
      refundCase,
      auditLogs,
      userExplanation,
    };
  }

  async function getRefundStatus(input: {
    userId: string;
    paymentFlowId?: string;
    refundCaseId?: string;
  }): Promise<RefundStatusResult | null> {
    let refundCase: RefundCase | null = null;
    if (input.refundCaseId) {
      refundCase = await store.findRefundCaseById(input.userId, input.refundCaseId);
    } else if (input.paymentFlowId) {
      refundCase = await store.findRefundCaseByPayment(input.userId, input.paymentFlowId);
    } else {
      throw new Error('paymentFlowId or refundCaseId is required');
    }
    if (!refundCase) return null;

    const logs = await store.listAuditLogs(input.userId, refundCase.id);
    const explanation = refundCase.userExplanation || buildRefundUserExplanation({
      state: refundCase.status,
      merchant: refundCase.merchant,
      amount: refundCase.amount,
      currency: refundCase.currency,
      reason: refundCase.activationFailureReason || 'Activation failed after capture',
      referenceId: refundCase.disputeId || refundCase.merchantReferenceId || refundCase.processorReferenceId || undefined,
    });

    return {
      refundCase,
      auditLogs: logs,
      userExplanation: explanation,
    };
  }

  async function runScheduler(input: {
    userId: string;
    limit?: number;
  }): Promise<RefundSchedulerResult> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 200));
    const candidates = await store.detectCapturedButUnfulfilled(input.userId, limit);
    let initiated = 0;

    for (const candidate of candidates) {
      try {
        await initiateRefund({
          userId: candidate.userId,
          paymentFlowId: candidate.paymentFlowId,
          idempotencyKey: `scheduler:${candidate.paymentFlowId}`,
          activationFailureReason: candidate.reason,
          allowWithoutActivationFailure: true,
        });
        initiated += 1;
      } catch (error) {
        logger.warn('refunds.scheduler.initiate_failed', {
          userId: candidate.userId,
          paymentFlowId: candidate.paymentFlowId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const dueCases = await store.listDueCases(input.userId, nowIso(), limit);
    let processed = 0;
    for (const dueCase of dueCases) {
      try {
        await processRefundCase({
          userId: dueCase.userId,
          refundCaseId: dueCase.id,
          idempotencyKey: `scheduler:retry:${dueCase.id}:${dueCase.retryCount}`,
        });
        processed += 1;
      } catch (error) {
        logger.error('refunds.scheduler.process_failed', {
          userId: dueCase.userId,
          refundCaseId: dueCase.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      detected: candidates.length,
      initiated,
      processed,
    };
  }

  return {
    initiateRefund,
    processRefundCase,
    getRefundStatus,
    runScheduler,
  };
}
