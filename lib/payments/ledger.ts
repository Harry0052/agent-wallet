import 'server-only';
import { randomUUID } from 'node:crypto';
import { query } from '../server/db.ts';
import type {
  PaymentFlow,
  PaymentFlowStatus,
  PaymentFundingMode,
  PaymentLedgerEvent,
  PaymentLedgerEventType,
  PaymentRetryJob,
  PaymentRetryOperation,
  TwoPhaseStore,
} from './twoPhasePayment.ts';

type PaymentFlowRow = {
  id: string;
  user_id: string;
  task_id: string | null;
  merchant: string;
  amount: string;
  currency: string;
  funding_mode: PaymentFundingMode;
  status: PaymentFlowStatus;
  stripe_payment_intent_id: string | null;
  requires_activation_verification: boolean;
  idempotency_authorize_key: string;
  idempotency_capture_key: string | null;
  idempotency_void_key: string | null;
  metadata: Record<string, unknown> | null;
  activation_verified_at: string | null;
  authorized_at: string | null;
  captured_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentEventRow = {
  id: string;
  payment_flow_id: string;
  user_id: string;
  event_type: PaymentLedgerEventType;
  amount: string;
  currency: string;
  idempotency_key: string | null;
  reason: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type RetryRow = {
  id: string;
  payment_flow_id: string;
  user_id: string;
  operation: PaymentRetryOperation;
  attempt: number;
  max_attempts: number;
  next_retry_at: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  idempotency_key: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function toFlow(row: PaymentFlowRow): PaymentFlow {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    merchant: row.merchant,
    amount: Number(row.amount),
    currency: row.currency,
    fundingMode: row.funding_mode,
    status: row.status,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    requiresActivationVerification: row.requires_activation_verification,
    idempotencyAuthorizeKey: row.idempotency_authorize_key,
    idempotencyCaptureKey: row.idempotency_capture_key,
    idempotencyVoidKey: row.idempotency_void_key,
    metadata: row.metadata || null,
    activationVerifiedAt: row.activation_verified_at,
    authorizedAt: row.authorized_at,
    capturedAt: row.captured_at,
    refundedAt: row.refunded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: PaymentEventRow): PaymentLedgerEvent {
  return {
    id: row.id,
    paymentFlowId: row.payment_flow_id,
    userId: row.user_id,
    eventType: row.event_type,
    amount: Number(row.amount),
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    reason: row.reason,
    details: row.details || null,
    createdAt: row.created_at,
  };
}

function toRetryJob(row: RetryRow): PaymentRetryJob {
  return {
    id: row.id,
    paymentFlowId: row.payment_flow_id,
    userId: row.user_id,
    operation: row.operation,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findFlowByWhere(sqlWhere: string, params: unknown[]): Promise<PaymentFlow | null> {
  const result = await query<PaymentFlowRow>(
    `
      SELECT
        id,
        user_id,
        task_id,
        merchant,
        amount::text,
        currency,
        funding_mode,
        status,
        stripe_payment_intent_id,
        requires_activation_verification,
        idempotency_authorize_key,
        idempotency_capture_key,
        idempotency_void_key,
        metadata,
        activation_verified_at::text,
        authorized_at::text,
        captured_at::text,
        refunded_at::text,
        created_at::text,
        updated_at::text
      FROM payment_flows
      WHERE ${sqlWhere}
      LIMIT 1
    `,
    params,
  );

  if (!result.rows[0]) return null;
  return toFlow(result.rows[0]);
}

export function createPostgresTwoPhaseStore(): TwoPhaseStore {
  return {
    async findByAuthorizeIdempotency(userId, idempotencyKey) {
      return findFlowByWhere('user_id = $1 AND idempotency_authorize_key = $2', [userId, idempotencyKey]);
    },

    async findById(userId, paymentId) {
      return findFlowByWhere('user_id = $1 AND id = $2', [userId, paymentId]);
    },

    async findByStripePaymentIntentId(stripePaymentIntentId) {
      return findFlowByWhere('stripe_payment_intent_id = $1', [stripePaymentIntentId]);
    },

    async createFlow(input) {
      const flowId = input.id || randomUUID();
      const result = await query<PaymentFlowRow>(
        `
          INSERT INTO payment_flows (
            id,
            user_id,
            task_id,
            merchant,
            amount,
            currency,
            funding_mode,
            status,
            stripe_payment_intent_id,
            requires_activation_verification,
            idempotency_authorize_key,
            metadata,
            activation_verified_at,
            authorized_at,
            captured_at,
            refunded_at
          )
          VALUES (
            $1, $2, $3, $4, $5, lower($6), $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16
          )
          ON CONFLICT (user_id, idempotency_authorize_key)
          DO UPDATE SET updated_at = NOW()
          RETURNING
            id,
            user_id,
            task_id,
            merchant,
            amount::text,
            currency,
            funding_mode,
            status,
            stripe_payment_intent_id,
            requires_activation_verification,
            idempotency_authorize_key,
            idempotency_capture_key,
            idempotency_void_key,
            metadata,
            activation_verified_at::text,
            authorized_at::text,
            captured_at::text,
            refunded_at::text,
            created_at::text,
            updated_at::text
        `,
        [
          flowId,
          input.userId,
          input.taskId || null,
          input.merchant,
          input.amount,
          input.currency,
          input.fundingMode,
          input.status,
          input.stripePaymentIntentId || null,
          input.requiresActivationVerification,
          input.idempotencyAuthorizeKey,
          input.metadata ? JSON.stringify(input.metadata) : null,
          null,
          input.authorizedAt || null,
          null,
          null,
        ],
      );

      return toFlow(result.rows[0]);
    },

    async updateFlow(userId, paymentId, patch) {
      const current = await findFlowByWhere('user_id = $1 AND id = $2', [userId, paymentId]);
      if (!current) throw new Error(`Payment flow not found: ${paymentId}`);

      const next = {
        status: patch.status ?? current.status,
        stripePaymentIntentId: patch.stripePaymentIntentId ?? current.stripePaymentIntentId,
        activationVerifiedAt: patch.activationVerifiedAt ?? current.activationVerifiedAt,
        authorizedAt: patch.authorizedAt ?? current.authorizedAt,
        capturedAt: patch.capturedAt ?? current.capturedAt,
        refundedAt: patch.refundedAt ?? current.refundedAt,
        metadata: patch.metadata ?? current.metadata,
        idempotencyCaptureKey: patch.idempotencyCaptureKey ?? current.idempotencyCaptureKey,
        idempotencyVoidKey: patch.idempotencyVoidKey ?? current.idempotencyVoidKey,
      };

      const result = await query<PaymentFlowRow>(
        `
          UPDATE payment_flows
          SET
            status = $3,
            stripe_payment_intent_id = $4,
            activation_verified_at = $5,
            authorized_at = $6,
            captured_at = $7,
            refunded_at = $8,
            metadata = $9::jsonb,
            idempotency_capture_key = $10,
            idempotency_void_key = $11,
            updated_at = NOW()
          WHERE user_id = $1
            AND id = $2
          RETURNING
            id,
            user_id,
            task_id,
            merchant,
            amount::text,
            currency,
            funding_mode,
            status,
            stripe_payment_intent_id,
            requires_activation_verification,
            idempotency_authorize_key,
            idempotency_capture_key,
            idempotency_void_key,
            metadata,
            activation_verified_at::text,
            authorized_at::text,
            captured_at::text,
            refunded_at::text,
            created_at::text,
            updated_at::text
        `,
        [
          userId,
          paymentId,
          next.status,
          next.stripePaymentIntentId,
          next.activationVerifiedAt,
          next.authorizedAt,
          next.capturedAt,
          next.refundedAt,
          next.metadata ? JSON.stringify(next.metadata) : null,
          next.idempotencyCaptureKey,
          next.idempotencyVoidKey,
        ],
      );

      return toFlow(result.rows[0]);
    },

    async appendEvent(input) {
      const eventId = randomUUID();
      const result = await query<PaymentEventRow>(
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
          VALUES ($1, $2, $3, $4, $5, lower($6), $7, $8, $9::jsonb)
          ON CONFLICT DO NOTHING
          RETURNING
            id,
            payment_flow_id,
            user_id,
            event_type,
            amount::text,
            currency,
            idempotency_key,
            reason,
            details,
            created_at::text
        `,
        [
          eventId,
          input.paymentFlowId,
          input.userId,
          input.eventType,
          input.amount,
          input.currency,
          input.idempotencyKey || null,
          input.reason || null,
          input.details ? JSON.stringify(input.details) : null,
        ],
      );

      if (result.rows[0]) return toEvent(result.rows[0]);

      const existing = await query<PaymentEventRow>(
        `
          SELECT
            id,
            payment_flow_id,
            user_id,
            event_type,
            amount::text,
            currency,
            idempotency_key,
            reason,
            details,
            created_at::text
          FROM payment_flow_events
          WHERE payment_flow_id = $1
            AND event_type = $2
            AND ($3::text IS NULL OR idempotency_key = $3)
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [input.paymentFlowId, input.eventType, input.idempotencyKey || null],
      );
      if (!existing.rows[0]) {
        throw new Error('Failed to append payment flow event');
      }
      return toEvent(existing.rows[0]);
    },

    async claimOperationIdempotency(input) {
      const column = input.operation === 'capture' ? 'idempotency_capture_key' : 'idempotency_void_key';

      const claimed = await query<{ id: string }>(
        `
          UPDATE payment_flows
          SET ${column} = $3,
              updated_at = NOW()
          WHERE user_id = $1
            AND id = $2
            AND ${column} IS NULL
          RETURNING id
        `,
        [input.userId, input.paymentId, input.idempotencyKey],
      );
      if ((claimed.rowCount ?? 0) > 0) return 'claimed';

      const current = await query<{ key: string | null }>(
        `
          SELECT ${column}::text AS key
          FROM payment_flows
          WHERE user_id = $1
            AND id = $2
          LIMIT 1
        `,
        [input.userId, input.paymentId],
      );

      const row = current.rows[0];
      if (!row) throw new Error(`Payment flow not found: ${input.paymentId}`);
      if (row.key === input.idempotencyKey) return 'replay';
      return 'conflict';
    },

    async createRetryJob(input) {
      const result = await query<RetryRow>(
        `
          INSERT INTO payment_retry_jobs (
            id,
            payment_flow_id,
            user_id,
            operation,
            attempt,
            max_attempts,
            next_retry_at,
            status,
            idempotency_key,
            last_error
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
          RETURNING
            id,
            payment_flow_id,
            user_id,
            operation,
            attempt,
            max_attempts,
            next_retry_at::text,
            status,
            idempotency_key,
            last_error,
            created_at::text,
            updated_at::text
        `,
        [
          randomUUID(),
          input.paymentFlowId,
          input.userId,
          input.operation,
          input.attempt,
          input.maxAttempts,
          input.nextRetryAt,
          input.idempotencyKey,
          input.lastError || null,
        ],
      );

      return toRetryJob(result.rows[0]);
    },

    async listDueRetryJobs(nowIso, limit) {
      const result = await query<RetryRow>(
        `
          SELECT
            id,
            payment_flow_id,
            user_id,
            operation,
            attempt,
            max_attempts,
            next_retry_at::text,
            status,
            idempotency_key,
            last_error,
            created_at::text,
            updated_at::text
          FROM payment_retry_jobs
          WHERE status = 'pending'
            AND next_retry_at <= $1::timestamptz
          ORDER BY next_retry_at ASC
          LIMIT $2
        `,
        [nowIso, limit],
      );
      return result.rows.map(toRetryJob);
    },

    async markRetryJob(retryJobId, patch) {
      await query(
        `
          UPDATE payment_retry_jobs
          SET
            status = COALESCE($2, status),
            attempt = COALESCE($3, attempt),
            next_retry_at = COALESCE($4::timestamptz, next_retry_at),
            last_error = COALESCE($5, last_error),
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          retryJobId,
          patch.status || null,
          patch.attempt ?? null,
          patch.nextRetryAt || null,
          patch.lastError || null,
        ],
      );
    },
  };
}
