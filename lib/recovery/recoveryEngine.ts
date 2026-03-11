import 'server-only';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/server/db';
import { decideRecoveryAction, type RecoveryAction } from '@/lib/recovery/policies';
import { groupRecoveryRecords, type RecoveryBuckets } from '@/lib/recovery/grouping';
import {
  canTransitionRecoveryState,
  normalizeRecoveryState,
  type RecoveryState,
} from '@/lib/recovery/stateMachine';

export interface RecoveryCaseRecord {
  id: string;
  userId: string;
  transactionId: string;
  paymentFlowId: string | null;
  ledgerEntryId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  currentState: RecoveryState;
  recommendedRecoveryAction: RecoveryAction;
  reason: string;
  userFacingMessage: string;
  canSelfServe: boolean;
  auditRequirements: string[];
  evidence: Record<string, unknown> | null;
  unresolved: boolean;
  needsManualReview: boolean;
  lastReconciledAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryAuditLog {
  id: string;
  recoveryCaseId: string;
  userId: string;
  actorType: 'system' | 'user' | 'admin';
  actorId: string;
  action: string;
  fromState: RecoveryState | null;
  toState: RecoveryState;
  details: Record<string, unknown> | null;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface RecoveryDecision {
  transactionId: string;
  merchant: string;
  amount: number;
  currentState: RecoveryState;
  recommendedRecoveryAction: RecoveryAction;
  reason: string;
  userFacingMessage: string;
  canSelfServe: boolean;
  auditRequirements: string[];
}

export interface RecoveryListResult {
  generatedAt: string;
  records: RecoveryCaseRecord[];
  summary: {
    total: number;
    canBeRestoredInstantly: number;
    refundInProgress: number;
    needsReview: number;
  };
}

export type { RecoveryBuckets };

export interface RecoveryCaseDetail {
  record: RecoveryCaseRecord;
  auditLogs: RecoveryAuditLog[];
}

export interface UpsertRecoveryCaseInput {
  userId: string;
  transactionId: string;
  paymentFlowId?: string | null;
  ledgerEntryId?: string | null;
  merchant: string;
  amount: number;
  currency: string;
  currentState: RecoveryState;
  recommendedRecoveryAction: RecoveryAction;
  reason: string;
  userFacingMessage: string;
  canSelfServe: boolean;
  auditRequirements: string[];
  evidence?: Record<string, unknown> | null;
  unresolved: boolean;
  needsManualReview: boolean;
}

export interface AppendRecoveryAuditInput {
  recoveryCaseId: string;
  userId: string;
  actorType: 'system' | 'user' | 'admin';
  actorId: string;
  action: string;
  fromState: RecoveryState | null;
  toState: RecoveryState;
  details?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}

export interface RecoveryStore {
  upsertCase(input: UpsertRecoveryCaseInput): Promise<RecoveryCaseRecord>;
  getCaseById(userId: string, caseId: string): Promise<RecoveryCaseRecord | null>;
  getCaseByTransactionId(userId: string, transactionId: string): Promise<RecoveryCaseRecord | null>;
  listCases(input: {
    userId: string;
    unresolvedOnly?: boolean;
    limit?: number;
  }): Promise<RecoveryCaseRecord[]>;
  appendAudit(input: AppendRecoveryAuditInput): Promise<RecoveryAuditLog>;
  listAuditLogs(userId: string, recoveryCaseId: string): Promise<RecoveryAuditLog[]>;
}

type RecoveryCaseRow = {
  id: string;
  user_id: string;
  transaction_id: string;
  payment_flow_id: string | null;
  ledger_entry_id: string | null;
  merchant: string;
  amount: string;
  currency: string;
  current_state: string;
  recommended_recovery_action: RecoveryAction;
  reason: string;
  user_facing_message: string;
  can_self_serve: boolean;
  audit_requirements: unknown;
  evidence: Record<string, unknown> | null;
  unresolved: boolean;
  needs_manual_review: boolean;
  last_reconciled_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type RecoveryAuditRow = {
  id: string;
  recovery_case_id: string;
  user_id: string;
  actor_type: 'system' | 'user' | 'admin';
  actor_id: string;
  action: string;
  from_state: string | null;
  to_state: string;
  details: Record<string, unknown> | null;
  idempotency_key: string | null;
  created_at: string;
};

let recoverySchemaReady: Promise<void> | null = null;

function parseStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function toRecoveryCase(row: RecoveryCaseRow): RecoveryCaseRecord {
  return {
    id: row.id,
    userId: row.user_id,
    transactionId: row.transaction_id,
    paymentFlowId: row.payment_flow_id,
    ledgerEntryId: row.ledger_entry_id,
    merchant: row.merchant,
    amount: Number(row.amount),
    currency: row.currency,
    currentState: normalizeRecoveryState(row.current_state),
    recommendedRecoveryAction: row.recommended_recovery_action,
    reason: row.reason,
    userFacingMessage: row.user_facing_message,
    canSelfServe: row.can_self_serve,
    auditRequirements: parseStringArray(row.audit_requirements),
    evidence: row.evidence || null,
    unresolved: row.unresolved,
    needsManualReview: row.needs_manual_review,
    lastReconciledAt: row.last_reconciled_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRecoveryAudit(row: RecoveryAuditRow): RecoveryAuditLog {
  return {
    id: row.id,
    recoveryCaseId: row.recovery_case_id,
    userId: row.user_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    fromState: row.from_state ? normalizeRecoveryState(row.from_state) : null,
    toState: normalizeRecoveryState(row.to_state),
    details: row.details || null,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

async function ensureRecoverySchema(): Promise<void> {
  if (recoverySchemaReady) {
    await recoverySchemaReady;
    return;
  }

  recoverySchemaReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS recovery_cases (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        payment_flow_id TEXT,
        ledger_entry_id TEXT,
        merchant TEXT NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        currency TEXT NOT NULL,
        current_state TEXT NOT NULL,
        recommended_recovery_action TEXT NOT NULL,
        reason TEXT NOT NULL,
        user_facing_message TEXT NOT NULL,
        can_self_serve BOOLEAN NOT NULL DEFAULT FALSE,
        audit_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
        evidence JSONB,
        unresolved BOOLEAN NOT NULL DEFAULT TRUE,
        needs_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
        last_reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_recovery_cases_transaction UNIQUE (user_id, transaction_id)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_recovery_cases_user_unresolved
      ON recovery_cases (user_id, unresolved, updated_at DESC);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_recovery_cases_payment_flow
      ON recovery_cases (payment_flow_id, updated_at DESC)
      WHERE payment_flow_id IS NOT NULL;
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_recovery_cases_ledger_entry
      ON recovery_cases (ledger_entry_id, updated_at DESC)
      WHERE ledger_entry_id IS NOT NULL;
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS recovery_audit_logs (
        id TEXT PRIMARY KEY,
        recovery_case_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        details JSONB,
        idempotency_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_recovery_audit_case_created
      ON recovery_audit_logs (recovery_case_id, created_at ASC);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_recovery_audit_user_created
      ON recovery_audit_logs (user_id, created_at DESC);
    `);

    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_recovery_audit_idempotent
      ON recovery_audit_logs (recovery_case_id, action, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    `);

    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_recovery_audit_case_id') THEN
          ALTER TABLE recovery_audit_logs
            ADD CONSTRAINT fk_recovery_audit_case_id
            FOREIGN KEY (recovery_case_id)
            REFERENCES recovery_cases(id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  })();

  await recoverySchemaReady;
}

async function selectCase(whereClause: string, params: unknown[]): Promise<RecoveryCaseRecord | null> {
  await ensureRecoverySchema();
  const result = await query<RecoveryCaseRow>(
    `
      SELECT
        id,
        user_id,
        transaction_id,
        payment_flow_id,
        ledger_entry_id,
        merchant,
        amount::text,
        currency,
        current_state,
        recommended_recovery_action,
        reason,
        user_facing_message,
        can_self_serve,
        audit_requirements,
        evidence,
        unresolved,
        needs_manual_review,
        last_reconciled_at::text,
        resolved_at::text,
        created_at::text,
        updated_at::text
      FROM recovery_cases
      WHERE ${whereClause}
      LIMIT 1
    `,
    params,
  );
  if (!result.rows[0]) return null;
  return toRecoveryCase(result.rows[0]);
}

export function createPostgresRecoveryStore(): RecoveryStore {
  return {
    async upsertCase(input) {
      await ensureRecoverySchema();
      const existing = await selectCase('user_id = $1 AND transaction_id = $2', [
        input.userId,
        input.transactionId,
      ]);

      if (existing) {
        const nextState = canTransitionRecoveryState(existing.currentState, input.currentState)
          ? input.currentState
          : 'manual_review_required';
        const nextNeedsManualReview = input.needsManualReview || nextState === 'manual_review_required';
        const nextReason = nextState === input.currentState
          ? input.reason
          : `Invalid transition detected (${existing.currentState} -> ${input.currentState}).`;
        const nextAction = nextState === input.currentState
          ? input.recommendedRecoveryAction
          : 'manual_review';
        const nextMessage = nextState === input.currentState
          ? input.userFacingMessage
          : 'This purchase state changed unexpectedly and needs manual review.';

        const result = await query<RecoveryCaseRow>(
          `
            UPDATE recovery_cases
            SET
              payment_flow_id = COALESCE($3, payment_flow_id),
              ledger_entry_id = COALESCE($4, ledger_entry_id),
              merchant = $5,
              amount = $6,
              currency = lower($7),
              current_state = $8,
              recommended_recovery_action = $9,
              reason = $10,
              user_facing_message = $11,
              can_self_serve = $12,
              audit_requirements = $13::jsonb,
              evidence = $14::jsonb,
              unresolved = $15,
              needs_manual_review = $16,
              last_reconciled_at = NOW(),
              resolved_at = CASE WHEN $15 THEN NULL ELSE COALESCE(resolved_at, NOW()) END,
              updated_at = NOW()
            WHERE id = $1
            RETURNING
              id,
              user_id,
              transaction_id,
              payment_flow_id,
              ledger_entry_id,
              merchant,
              amount::text,
              currency,
              current_state,
              recommended_recovery_action,
              reason,
              user_facing_message,
              can_self_serve,
              audit_requirements,
              evidence,
              unresolved,
              needs_manual_review,
              last_reconciled_at::text,
              resolved_at::text,
              created_at::text,
              updated_at::text
          `,
          [
            existing.id,
            input.transactionId,
            input.paymentFlowId || null,
            input.ledgerEntryId || null,
            input.merchant,
            input.amount,
            input.currency,
            nextState,
            nextAction,
            nextReason,
            nextMessage,
            input.canSelfServe && !nextNeedsManualReview,
            JSON.stringify(input.auditRequirements),
            input.evidence ? JSON.stringify(input.evidence) : null,
            input.unresolved,
            nextNeedsManualReview,
          ],
        );
        return toRecoveryCase(result.rows[0]);
      }

      const result = await query<RecoveryCaseRow>(
        `
          INSERT INTO recovery_cases (
            id,
            user_id,
            transaction_id,
            payment_flow_id,
            ledger_entry_id,
            merchant,
            amount,
            currency,
            current_state,
            recommended_recovery_action,
            reason,
            user_facing_message,
            can_self_serve,
            audit_requirements,
            evidence,
            unresolved,
            needs_manual_review
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, lower($8), $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17
          )
          RETURNING
            id,
            user_id,
            transaction_id,
            payment_flow_id,
            ledger_entry_id,
            merchant,
            amount::text,
            currency,
            current_state,
            recommended_recovery_action,
            reason,
            user_facing_message,
            can_self_serve,
            audit_requirements,
            evidence,
            unresolved,
            needs_manual_review,
            last_reconciled_at::text,
            resolved_at::text,
            created_at::text,
            updated_at::text
        `,
        [
          randomUUID(),
          input.userId,
          input.transactionId,
          input.paymentFlowId || null,
          input.ledgerEntryId || null,
          input.merchant,
          input.amount,
          input.currency,
          input.currentState,
          input.recommendedRecoveryAction,
          input.reason,
          input.userFacingMessage,
          input.canSelfServe,
          JSON.stringify(input.auditRequirements),
          input.evidence ? JSON.stringify(input.evidence) : null,
          input.unresolved,
          input.needsManualReview,
        ],
      );
      return toRecoveryCase(result.rows[0]);
    },

    async getCaseById(userId, caseId) {
      return selectCase('user_id = $1 AND id = $2', [userId, caseId]);
    },

    async getCaseByTransactionId(userId, transactionId) {
      return selectCase('user_id = $1 AND transaction_id = $2', [userId, transactionId]);
    },

    async listCases(input) {
      await ensureRecoverySchema();
      const unresolvedOnly = input.unresolvedOnly !== false;
      const limit = Number.isFinite(input.limit) && (input.limit || 0) > 0
        ? Math.min(Math.round(input.limit || 100), 500)
        : 100;

      const result = await query<RecoveryCaseRow>(
        `
          SELECT
            id,
            user_id,
            transaction_id,
            payment_flow_id,
            ledger_entry_id,
            merchant,
            amount::text,
            currency,
            current_state,
            recommended_recovery_action,
            reason,
            user_facing_message,
            can_self_serve,
            audit_requirements,
            evidence,
            unresolved,
            needs_manual_review,
            last_reconciled_at::text,
            resolved_at::text,
            created_at::text,
            updated_at::text
          FROM recovery_cases
          WHERE user_id = $1
            AND ($2::boolean = false OR unresolved = true)
          ORDER BY unresolved DESC, updated_at DESC
          LIMIT $3
        `,
        [input.userId, unresolvedOnly, limit],
      );
      return result.rows.map(toRecoveryCase);
    },

    async appendAudit(input) {
      await ensureRecoverySchema();
      const auditId = randomUUID();
      const result = await query<RecoveryAuditRow>(
        `
          INSERT INTO recovery_audit_logs (
            id,
            recovery_case_id,
            user_id,
            actor_type,
            actor_id,
            action,
            from_state,
            to_state,
            details,
            idempotency_key
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
          ON CONFLICT DO NOTHING
          RETURNING
            id,
            recovery_case_id,
            user_id,
            actor_type,
            actor_id,
            action,
            from_state,
            to_state,
            details,
            idempotency_key,
            created_at::text
        `,
        [
          auditId,
          input.recoveryCaseId,
          input.userId,
          input.actorType,
          input.actorId,
          input.action,
          input.fromState,
          input.toState,
          input.details ? JSON.stringify(input.details) : null,
          input.idempotencyKey || null,
        ],
      );

      if (result.rows[0]) return toRecoveryAudit(result.rows[0]);

      const existing = await query<RecoveryAuditRow>(
        `
          SELECT
            id,
            recovery_case_id,
            user_id,
            actor_type,
            actor_id,
            action,
            from_state,
            to_state,
            details,
            idempotency_key,
            created_at::text
          FROM recovery_audit_logs
          WHERE recovery_case_id = $1
            AND action = $2
            AND ($3::text IS NULL OR idempotency_key = $3)
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [input.recoveryCaseId, input.action, input.idempotencyKey || null],
      );
      if (!existing.rows[0]) throw new Error('Failed to append recovery audit log');
      return toRecoveryAudit(existing.rows[0]);
    },

    async listAuditLogs(userId, recoveryCaseId) {
      await ensureRecoverySchema();
      const result = await query<RecoveryAuditRow>(
        `
          SELECT
            id,
            recovery_case_id,
            user_id,
            actor_type,
            actor_id,
            action,
            from_state,
            to_state,
            details,
            idempotency_key,
            created_at::text
          FROM recovery_audit_logs
          WHERE user_id = $1
            AND recovery_case_id = $2
          ORDER BY created_at ASC
        `,
        [userId, recoveryCaseId],
      );
      return result.rows.map(toRecoveryAudit);
    },
  };
}

function parseEvidenceBoolean(evidence: Record<string, unknown> | null | undefined, key: string): boolean {
  if (!evidence) return false;
  return evidence[key] === true;
}

export function toRecoveryDecision(record: RecoveryCaseRecord): RecoveryDecision {
  const hasExternalAuthorization = parseEvidenceBoolean(record.evidence, 'hasExternalAuthorization');
  const hasExternalCapture = parseEvidenceBoolean(record.evidence, 'hasExternalCapture');
  const activationConfirmed = parseEvidenceBoolean(record.evidence, 'activationConfirmed');
  const ambiguousState = Boolean(record.needsManualReview) || record.currentState === 'manual_review_required';

  const policyDecision = decideRecoveryAction({
    currentState: record.currentState,
    hasExternalAuthorization,
    hasExternalCapture,
    activationConfirmed,
    ambiguousState,
  });

  return {
    transactionId: record.transactionId,
    merchant: record.merchant,
    amount: record.amount,
    currentState: record.currentState,
    recommendedRecoveryAction: policyDecision.recommendedRecoveryAction,
    reason: policyDecision.reason,
    userFacingMessage: policyDecision.userFacingMessage,
    canSelfServe: policyDecision.canSelfServe,
    auditRequirements: policyDecision.auditRequirements,
  };
}

export { groupRecoveryRecords };

export function createRecoveryEngine(params?: {
  store?: RecoveryStore;
}) {
  const store = params?.store || createPostgresRecoveryStore();

  async function evaluate(input: {
    userId: string;
    recoveryCaseId?: string;
    transactionId?: string;
  }): Promise<RecoveryDecision | null> {
    const record = input.recoveryCaseId
      ? await store.getCaseById(input.userId, input.recoveryCaseId)
      : input.transactionId
        ? await store.getCaseByTransactionId(input.userId, input.transactionId)
        : null;

    if (!record) return null;
    return toRecoveryDecision(record);
  }

  async function list(input: {
    userId: string;
    unresolvedOnly?: boolean;
    limit?: number;
  }): Promise<RecoveryListResult> {
    const records = await store.listCases(input);
    const buckets = groupRecoveryRecords(records);
    const summary = {
      total: records.length,
      canBeRestoredInstantly: buckets.canBeRestoredInstantly.length,
      refundInProgress: buckets.refundInProgress.length,
      needsReview: buckets.needsReview.length,
    };

    return {
      generatedAt: new Date().toISOString(),
      records,
      summary,
    };
  }

  async function detail(input: {
    userId: string;
    recoveryCaseId: string;
  }): Promise<RecoveryCaseDetail | null> {
    const record = await store.getCaseById(input.userId, input.recoveryCaseId);
    if (!record) return null;
    const auditLogs = await store.listAuditLogs(input.userId, input.recoveryCaseId);
    return { record, auditLogs };
  }

  return {
    store,
    evaluate,
    list,
    detail,
  };
}
