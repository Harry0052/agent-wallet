import 'server-only';

import { randomUUID } from 'node:crypto';
import { decryptData, encryptData, hashSensitiveValue } from '@/security/encryption';
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

const HASH_PREFIX = 'h1:';
const HASH_SCOPE_FLOW_STRIPE_PI = 'payment_flows.stripe_payment_intent_id';
const HASH_SCOPE_FLOW_AUTHORIZE = 'payment_flows.idempotency_authorize_key';
const HASH_SCOPE_FLOW_CAPTURE = 'payment_flows.idempotency_capture_key';
const HASH_SCOPE_FLOW_VOID = 'payment_flows.idempotency_void_key';
const HASH_SCOPE_EVENT_IDEMPOTENCY = 'payment_flow_events.idempotency_key';
const HASH_SCOPE_RETRY_IDEMPOTENCY = 'payment_retry_jobs.idempotency_key';

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
  stripe_payment_intent_id_encrypted: string | null;
  stripe_payment_intent_id_key_version: string | null;
  requires_activation_verification: boolean;
  idempotency_authorize_key: string;
  idempotency_authorize_key_encrypted: string | null;
  idempotency_authorize_key_key_version: string | null;
  idempotency_capture_key: string | null;
  idempotency_capture_key_encrypted: string | null;
  idempotency_capture_key_key_version: string | null;
  idempotency_void_key: string | null;
  idempotency_void_key_encrypted: string | null;
  idempotency_void_key_key_version: string | null;
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
  idempotency_key_encrypted: string | null;
  idempotency_key_key_version: string | null;
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
  idempotency_key_encrypted: string | null;
  idempotency_key_key_version: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const FLOW_SELECT_COLUMNS = `
  id,
  user_id,
  task_id,
  merchant,
  amount::text,
  currency,
  funding_mode,
  status,
  stripe_payment_intent_id,
  stripe_payment_intent_id_encrypted,
  stripe_payment_intent_id_key_version,
  requires_activation_verification,
  idempotency_authorize_key,
  idempotency_authorize_key_encrypted,
  idempotency_authorize_key_key_version,
  idempotency_capture_key,
  idempotency_capture_key_encrypted,
  idempotency_capture_key_key_version,
  idempotency_void_key,
  idempotency_void_key_encrypted,
  idempotency_void_key_key_version,
  metadata,
  activation_verified_at::text,
  authorized_at::text,
  captured_at::text,
  refunded_at::text,
  created_at::text,
  updated_at::text
`;

const EVENT_SELECT_COLUMNS = `
  id,
  payment_flow_id,
  user_id,
  event_type,
  amount::text,
  currency,
  idempotency_key,
  idempotency_key_encrypted,
  idempotency_key_key_version,
  reason,
  details,
  created_at::text
`;

const RETRY_SELECT_COLUMNS = `
  id,
  payment_flow_id,
  user_id,
  operation,
  attempt,
  max_attempts,
  next_retry_at::text,
  status,
  idempotency_key,
  idempotency_key_encrypted,
  idempotency_key_key_version,
  last_error,
  created_at::text,
  updated_at::text
`;

function looksHashed(value: string): boolean {
  return value.startsWith(HASH_PREFIX);
}

function decryptSensitiveValue(input: {
  encrypted: string | null;
  keyVersion: string | null;
  fallback: string | null;
}): string | null {
  if (input.encrypted && input.keyVersion) {
    try {
      const decrypted = decryptData<unknown>(input.encrypted, input.keyVersion);
      if (typeof decrypted === 'string' && decrypted.trim()) {
        return decrypted;
      }
    } catch {
      // Fall back for legacy plaintext rows.
    }
  }

  if (!input.fallback) return null;
  if (looksHashed(input.fallback)) return null;
  return input.fallback;
}

function hashOrNull(value: string | null | undefined, scope: string): string | null {
  const normalized = value?.trim() || '';
  if (!normalized) return null;
  return hashSensitiveValue(normalized, scope);
}

function encryptOrNull(value: string | null | undefined): { encrypted: string; keyVersion: string } | null {
  const normalized = value?.trim() || '';
  if (!normalized) return null;
  return encryptData(normalized);
}

function toFlow(row: PaymentFlowRow): PaymentFlow {
  const idempotencyAuthorizeKey = decryptSensitiveValue({
    encrypted: row.idempotency_authorize_key_encrypted,
    keyVersion: row.idempotency_authorize_key_key_version,
    fallback: row.idempotency_authorize_key,
  });
  if (!idempotencyAuthorizeKey) {
    throw new Error(`Missing decryptable authorize idempotency key for payment flow ${row.id}`);
  }

  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    merchant: row.merchant,
    amount: Number(row.amount),
    currency: row.currency,
    fundingMode: row.funding_mode,
    status: row.status,
    stripePaymentIntentId: decryptSensitiveValue({
      encrypted: row.stripe_payment_intent_id_encrypted,
      keyVersion: row.stripe_payment_intent_id_key_version,
      fallback: row.stripe_payment_intent_id,
    }),
    requiresActivationVerification: row.requires_activation_verification,
    idempotencyAuthorizeKey,
    idempotencyCaptureKey: decryptSensitiveValue({
      encrypted: row.idempotency_capture_key_encrypted,
      keyVersion: row.idempotency_capture_key_key_version,
      fallback: row.idempotency_capture_key,
    }),
    idempotencyVoidKey: decryptSensitiveValue({
      encrypted: row.idempotency_void_key_encrypted,
      keyVersion: row.idempotency_void_key_key_version,
      fallback: row.idempotency_void_key,
    }),
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
    idempotencyKey: decryptSensitiveValue({
      encrypted: row.idempotency_key_encrypted,
      keyVersion: row.idempotency_key_key_version,
      fallback: row.idempotency_key,
    }),
    reason: row.reason,
    details: row.details || null,
    createdAt: row.created_at,
  };
}

function toRetryJob(row: RetryRow): PaymentRetryJob {
  const idempotencyKey = decryptSensitiveValue({
    encrypted: row.idempotency_key_encrypted,
    keyVersion: row.idempotency_key_key_version,
    fallback: row.idempotency_key,
  });
  if (!idempotencyKey) {
    throw new Error(`Missing decryptable retry idempotency key for retry job ${row.id}`);
  }

  return {
    id: row.id,
    paymentFlowId: row.payment_flow_id,
    userId: row.user_id,
    operation: row.operation,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at,
    status: row.status,
    idempotencyKey,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findFlowByWhere(sqlWhere: string, params: unknown[]): Promise<PaymentFlow | null> {
  const result = await query<PaymentFlowRow>(
    `
      SELECT
        ${FLOW_SELECT_COLUMNS}
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
      const authorizeHash = hashSensitiveValue(idempotencyKey, HASH_SCOPE_FLOW_AUTHORIZE);
      return findFlowByWhere(
        'user_id = $1 AND (idempotency_authorize_key = $2 OR idempotency_authorize_key = $3)',
        [userId, authorizeHash, idempotencyKey],
      );
    },

    async findById(userId, paymentId) {
      return findFlowByWhere('user_id = $1 AND id = $2', [userId, paymentId]);
    },

    async findByStripePaymentIntentId(stripePaymentIntentId) {
      const piHash = hashSensitiveValue(stripePaymentIntentId, HASH_SCOPE_FLOW_STRIPE_PI);
      return findFlowByWhere(
        'stripe_payment_intent_id = $1 OR stripe_payment_intent_id = $2',
        [piHash, stripePaymentIntentId],
      );
    },

    async createFlow(input) {
      const flowId = input.id || randomUUID();

      const stripeIntentHash = hashOrNull(input.stripePaymentIntentId || null, HASH_SCOPE_FLOW_STRIPE_PI);
      const stripeIntentEncrypted = encryptOrNull(input.stripePaymentIntentId || null);
      const authorizeHash = hashSensitiveValue(input.idempotencyAuthorizeKey, HASH_SCOPE_FLOW_AUTHORIZE);
      const authorizeEncrypted = encryptData(input.idempotencyAuthorizeKey);

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
            stripe_payment_intent_id_encrypted,
            stripe_payment_intent_id_key_version,
            requires_activation_verification,
            idempotency_authorize_key,
            idempotency_authorize_key_encrypted,
            idempotency_authorize_key_key_version,
            metadata,
            activation_verified_at,
            authorized_at,
            captured_at,
            refunded_at
          )
          VALUES (
            $1, $2, $3, $4, $5, lower($6), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20
          )
          ON CONFLICT (user_id, idempotency_authorize_key)
          DO UPDATE SET updated_at = NOW()
          RETURNING
            ${FLOW_SELECT_COLUMNS}
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
          stripeIntentHash,
          stripeIntentEncrypted?.encrypted || null,
          stripeIntentEncrypted?.keyVersion || null,
          input.requiresActivationVerification,
          authorizeHash,
          authorizeEncrypted.encrypted,
          authorizeEncrypted.keyVersion,
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

      const stripeIntentHash = hashOrNull(next.stripePaymentIntentId, HASH_SCOPE_FLOW_STRIPE_PI);
      const stripeIntentEncrypted = encryptOrNull(next.stripePaymentIntentId);
      const captureHash = hashOrNull(next.idempotencyCaptureKey, HASH_SCOPE_FLOW_CAPTURE);
      const captureEncrypted = encryptOrNull(next.idempotencyCaptureKey);
      const voidHash = hashOrNull(next.idempotencyVoidKey, HASH_SCOPE_FLOW_VOID);
      const voidEncrypted = encryptOrNull(next.idempotencyVoidKey);

      const result = await query<PaymentFlowRow>(
        `
          UPDATE payment_flows
          SET
            status = $3,
            stripe_payment_intent_id = $4,
            stripe_payment_intent_id_encrypted = $5,
            stripe_payment_intent_id_key_version = $6,
            activation_verified_at = $7,
            authorized_at = $8,
            captured_at = $9,
            refunded_at = $10,
            metadata = $11::jsonb,
            idempotency_capture_key = $12,
            idempotency_capture_key_encrypted = $13,
            idempotency_capture_key_key_version = $14,
            idempotency_void_key = $15,
            idempotency_void_key_encrypted = $16,
            idempotency_void_key_key_version = $17,
            updated_at = NOW()
          WHERE user_id = $1
            AND id = $2
          RETURNING
            ${FLOW_SELECT_COLUMNS}
        `,
        [
          userId,
          paymentId,
          next.status,
          stripeIntentHash,
          stripeIntentEncrypted?.encrypted || null,
          stripeIntentEncrypted?.keyVersion || null,
          next.activationVerifiedAt,
          next.authorizedAt,
          next.capturedAt,
          next.refundedAt,
          next.metadata ? JSON.stringify(next.metadata) : null,
          captureHash,
          captureEncrypted?.encrypted || null,
          captureEncrypted?.keyVersion || null,
          voidHash,
          voidEncrypted?.encrypted || null,
          voidEncrypted?.keyVersion || null,
        ],
      );

      return toFlow(result.rows[0]);
    },

    async appendEvent(input) {
      const eventId = randomUUID();
      const eventKeyHash = hashOrNull(input.idempotencyKey || null, HASH_SCOPE_EVENT_IDEMPOTENCY);
      const eventKeyEncrypted = encryptOrNull(input.idempotencyKey || null);

      if (input.idempotencyKey) {
        const existing = await query<PaymentEventRow>(
          `
            SELECT
              ${EVENT_SELECT_COLUMNS}
            FROM payment_flow_events
            WHERE payment_flow_id = $1
              AND event_type = $2
              AND (idempotency_key = $3 OR idempotency_key = $4)
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [input.paymentFlowId, input.eventType, eventKeyHash, input.idempotencyKey],
        );

        if (existing.rows[0]) {
          return toEvent(existing.rows[0]);
        }
      }

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
            idempotency_key_encrypted,
            idempotency_key_key_version,
            reason,
            details
          )
          VALUES ($1, $2, $3, $4, $5, lower($6), $7, $8, $9, $10, $11::jsonb)
          ON CONFLICT DO NOTHING
          RETURNING
            ${EVENT_SELECT_COLUMNS}
        `,
        [
          eventId,
          input.paymentFlowId,
          input.userId,
          input.eventType,
          input.amount,
          input.currency,
          eventKeyHash,
          eventKeyEncrypted?.encrypted || null,
          eventKeyEncrypted?.keyVersion || null,
          input.reason || null,
          input.details ? JSON.stringify(input.details) : null,
        ],
      );

      if (result.rows[0]) return toEvent(result.rows[0]);

      const existing = await query<PaymentEventRow>(
        `
          SELECT
            ${EVENT_SELECT_COLUMNS}
          FROM payment_flow_events
          WHERE payment_flow_id = $1
            AND event_type = $2
            AND (
              $3::text IS NULL
              OR idempotency_key = $3
              OR idempotency_key = $4
            )
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [input.paymentFlowId, input.eventType, eventKeyHash, input.idempotencyKey || null],
      );
      if (!existing.rows[0]) {
        throw new Error('Failed to append payment flow event');
      }
      return toEvent(existing.rows[0]);
    },

    async claimOperationIdempotency(input) {
      const column = input.operation === 'capture' ? 'idempotency_capture_key' : 'idempotency_void_key';
      const encryptedColumn = input.operation === 'capture'
        ? 'idempotency_capture_key_encrypted'
        : 'idempotency_void_key_encrypted';
      const keyVersionColumn = input.operation === 'capture'
        ? 'idempotency_capture_key_key_version'
        : 'idempotency_void_key_key_version';
      const scope = input.operation === 'capture' ? HASH_SCOPE_FLOW_CAPTURE : HASH_SCOPE_FLOW_VOID;
      const hashedKey = hashSensitiveValue(input.idempotencyKey, scope);
      const encryptedKey = encryptData(input.idempotencyKey);

      const claimed = await query<{ id: string }>(
        `
          UPDATE payment_flows
          SET ${column} = $3,
              ${encryptedColumn} = $4,
              ${keyVersionColumn} = $5,
              updated_at = NOW()
          WHERE user_id = $1
            AND id = $2
            AND ${column} IS NULL
          RETURNING id
        `,
        [input.userId, input.paymentId, hashedKey, encryptedKey.encrypted, encryptedKey.keyVersion],
      );
      if ((claimed.rowCount ?? 0) > 0) return 'claimed';

      const current = await query<{
        key: string | null;
        encrypted: string | null;
        key_version: string | null;
      }>(
        `
          SELECT
            ${column}::text AS key,
            ${encryptedColumn}::text AS encrypted,
            ${keyVersionColumn}::text AS key_version
          FROM payment_flows
          WHERE user_id = $1
            AND id = $2
          LIMIT 1
        `,
        [input.userId, input.paymentId],
      );

      const row = current.rows[0];
      if (!row) throw new Error(`Payment flow not found: ${input.paymentId}`);

      const currentKey = decryptSensitiveValue({
        encrypted: row.encrypted,
        keyVersion: row.key_version,
        fallback: row.key,
      });
      if (currentKey === input.idempotencyKey) return 'replay';
      return 'conflict';
    },

    async createRetryJob(input) {
      const retryKeyHash = hashSensitiveValue(input.idempotencyKey, HASH_SCOPE_RETRY_IDEMPOTENCY);
      const retryKeyEncrypted = encryptData(input.idempotencyKey);

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
            idempotency_key_encrypted,
            idempotency_key_key_version,
            last_error
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11)
          RETURNING
            ${RETRY_SELECT_COLUMNS}
        `,
        [
          randomUUID(),
          input.paymentFlowId,
          input.userId,
          input.operation,
          input.attempt,
          input.maxAttempts,
          input.nextRetryAt,
          retryKeyHash,
          retryKeyEncrypted.encrypted,
          retryKeyEncrypted.keyVersion,
          input.lastError || null,
        ],
      );

      return toRetryJob(result.rows[0]);
    },

    async listDueRetryJobs(nowIso, limit) {
      const result = await query<RetryRow>(
        `
          SELECT
            ${RETRY_SELECT_COLUMNS}
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
