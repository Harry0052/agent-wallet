import 'server-only';
import type { RecoveryAction } from '@/lib/recovery/policies';
import {
  createPostgresRecoveryStore,
  type RecoveryCaseRecord,
  type RecoveryStore,
} from '@/lib/recovery/recoveryEngine';
import {
  createPostgresTwoPhaseStore,
} from '@/lib/payments/ledger';
import { createStripeFirstGateway, createTwoPhasePaymentEngine } from '@/lib/payments/twoPhasePayment';
import type { PaymentFlow } from '@/lib/payments/twoPhasePayment';
import { getStripeClient } from '@/lib/server/stripe';
import { logServerEvent } from '@/lib/server/observability';
import { query } from '@/lib/server/db';
import { recordLedgerEntryUnique } from '@/lib/server/ledger';

interface LedgerEntryRow {
  id: string;
  user_id: string;
  amount: string;
  currency: string;
  direction: 'credit' | 'debit';
  status: string;
  merchant: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
}

export interface ExecuteRecoveryReversalInput {
  userId: string;
  recoveryCaseId: string;
  idempotencyKey: string;
  reason?: string;
  actorType?: 'system' | 'user' | 'admin';
  actorId?: string;
  adminOverride?: boolean;
}

export interface RecoveryReversalResult {
  recoveryCase: RecoveryCaseRecord;
  transactionId: string;
  executionType: 'wallet_reversal' | 'authorization_void' | 'noop';
  message: string;
  idempotentReplay: boolean;
  ledgerEntryId: string | null;
  paymentFlowId: string | null;
}

function ensureIdempotencyKey(input: string): string {
  const normalized = input.trim();
  if (!normalized) throw new Error('idempotencyKey is required');
  return normalized;
}

function readEvidenceBoolean(evidence: Record<string, unknown> | null | undefined, key: string): boolean {
  if (!evidence) return false;
  return evidence[key] === true;
}

function normalizeActor(input: ExecuteRecoveryReversalInput): { actorType: 'system' | 'user' | 'admin'; actorId: string } {
  const actorType = input.actorType || 'user';
  const actorId = (input.actorId || input.userId).trim() || input.userId;
  return { actorType, actorId };
}

async function loadLedgerEntry(userId: string, ledgerEntryId: string): Promise<LedgerEntryRow | null> {
  const result = await query<LedgerEntryRow>(
    `
      SELECT
        id,
        user_id,
        amount::text,
        currency,
        direction,
        status,
        merchant,
        description,
        metadata
      FROM ledger_entries
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [ledgerEntryId, userId],
  );

  return result.rows[0] || null;
}

async function findExistingReversal(params: {
  userId: string;
  recoveryCaseId: string;
  ledgerEntryId: string;
}): Promise<LedgerEntryRow | null> {
  const result = await query<LedgerEntryRow>(
    `
      SELECT
        id,
        user_id,
        amount::text,
        currency,
        direction,
        status,
        merchant,
        description,
        metadata
      FROM ledger_entries
      WHERE user_id = $1
        AND direction = 'credit'
        AND status = 'succeeded'
        AND (
          metadata->>'recovery_case_id' = $2
          OR metadata->>'original_ledger_entry_id' = $3
        )
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [params.userId, params.recoveryCaseId, params.ledgerEntryId],
  );

  return result.rows[0] || null;
}

function mergeEvidence(record: RecoveryCaseRecord, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(record.evidence || {}),
    ...patch,
  };
}

function buildRecoveryCompletionPayload(params: {
  record: RecoveryCaseRecord;
  reason: string;
  evidencePatch: Record<string, unknown>;
}): {
  paymentFlowId: string | null;
  ledgerEntryId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  evidence: Record<string, unknown>;
} {
  return {
    paymentFlowId: params.record.paymentFlowId,
    ledgerEntryId: params.record.ledgerEntryId,
    merchant: params.record.merchant,
    amount: params.record.amount,
    currency: params.record.currency,
    evidence: mergeEvidence(params.record, {
      recovery_completed_at: new Date().toISOString(),
      recovery_completion_reason: params.reason,
      ...params.evidencePatch,
    }),
  };
}

function createVoidOnlyEngine() {
  const store = createPostgresTwoPhaseStore();
  const gateway = createStripeFirstGateway({
    stripe: getStripeClient(),
    async resolvePaymentMethod() {
      throw new Error('resolvePaymentMethod is unavailable in recovery void flow');
    },
    async captureReservedBalance() {
      throw new Error('captureReservedBalance is unavailable in recovery void flow');
    },
    async releaseReservedBalance() {
      // Prepaid reservation releases are modeled in payment flow events.
    },
  });

  return createTwoPhasePaymentEngine({
    store,
    gateway,
    logger: {
      info: (event, data) => logServerEvent('info', event, data),
      warn: (event, data) => logServerEvent('warn', event, data),
      error: (event, data) => logServerEvent('error', event, data),
    },
  });
}

async function ensureVoidEligible(params: {
  record: RecoveryCaseRecord;
  flow: PaymentFlow;
  adminOverride: boolean;
}): Promise<void> {
  if (params.adminOverride) return;

  if (params.flow.status === 'captured') {
    throw new Error('INVALID_STATE: payment is captured and must use refund flow');
  }

  const hasExternalCapture = readEvidenceBoolean(params.record.evidence, 'hasExternalCapture');
  if (hasExternalCapture) {
    throw new Error('POLICY_FAILURE: reversal is blocked because external capture exists');
  }
}

async function completeRecoveryCase(params: {
  store: RecoveryStore;
  record: RecoveryCaseRecord;
  reason: string;
  actionLabel: string;
  idempotencyKey: string;
  actorType: 'system' | 'user' | 'admin';
  actorId: string;
  evidencePatch: Record<string, unknown>;
}): Promise<RecoveryCaseRecord> {
  const payload = buildRecoveryCompletionPayload({
    record: params.record,
    reason: params.reason,
    evidencePatch: params.evidencePatch,
  });

  const updated = await params.store.upsertCase({
    userId: params.record.userId,
    transactionId: params.record.transactionId,
    paymentFlowId: payload.paymentFlowId,
    ledgerEntryId: payload.ledgerEntryId,
    merchant: payload.merchant,
    amount: payload.amount,
    currency: payload.currency,
    currentState: 'reversal_completed',
    recommendedRecoveryAction: 'none',
    reason: params.reason,
    userFacingMessage: 'Funds were restored successfully.',
    canSelfServe: false,
    auditRequirements: params.record.auditRequirements,
    evidence: payload.evidence,
    unresolved: false,
    needsManualReview: false,
  });

  await params.store.appendAudit({
    recoveryCaseId: updated.id,
    userId: updated.userId,
    actorType: params.actorType,
    actorId: params.actorId,
    action: params.actionLabel,
    fromState: params.record.currentState,
    toState: updated.currentState,
    details: {
      reason: params.reason,
      evidencePatch: params.evidencePatch,
    },
    idempotencyKey: params.idempotencyKey,
  });

  return updated;
}

export function createReversalService(params?: {
  recoveryStore?: RecoveryStore;
}) {
  const recoveryStore = params?.recoveryStore || createPostgresRecoveryStore();

  async function executeReversal(input: ExecuteRecoveryReversalInput): Promise<RecoveryReversalResult> {
    const idempotencyKey = ensureIdempotencyKey(input.idempotencyKey);
    const { actorType, actorId } = normalizeActor(input);

    const record = await recoveryStore.getCaseById(input.userId, input.recoveryCaseId);
    if (!record) {
      throw new Error(`Recovery case not found: ${input.recoveryCaseId}`);
    }

    const hasExternalCapture = readEvidenceBoolean(record.evidence, 'hasExternalCapture');

    if (record.currentState === 'reversal_completed' || record.currentState === 'refund_completed') {
      return {
        recoveryCase: record,
        transactionId: record.transactionId,
        executionType: 'noop',
        message: 'Recovery already completed for this purchase.',
        idempotentReplay: true,
        ledgerEntryId: record.ledgerEntryId,
        paymentFlowId: record.paymentFlowId,
      };
    }

    if (!input.adminOverride) {
      const allowed: RecoveryAction[] = ['restore_wallet_balance', 'void_external_authorization'];
      if (!allowed.includes(record.recommendedRecoveryAction)) {
        throw new Error(
          `POLICY_FAILURE: reversal is not allowed for action ${record.recommendedRecoveryAction}`,
        );
      }

      if (hasExternalCapture) {
        throw new Error('POLICY_FAILURE: reversal is blocked because external capture is present');
      }
    }

    if (record.paymentFlowId && record.recommendedRecoveryAction === 'void_external_authorization') {
      const flowStore = createPostgresTwoPhaseStore();
      const flow = await flowStore.findById(record.userId, record.paymentFlowId);
      if (!flow) {
        throw new Error(`Payment flow not found: ${record.paymentFlowId}`);
      }

      await ensureVoidEligible({
        record,
        flow,
        adminOverride: Boolean(input.adminOverride),
      });

      const engine = createVoidOnlyEngine();
      const voidResult = await engine.voidPayment({
        userId: record.userId,
        paymentId: flow.id,
        idempotencyKey: `${idempotencyKey}:void`,
        reason: input.reason || 'authorization_void_requested_from_recovery_center',
      });

      const reason = input.reason || 'External authorization was voided before capture.';
      const updated = await completeRecoveryCase({
        store: recoveryStore,
        record,
        reason,
        actionLabel: 'authorization_void_completed',
        idempotencyKey,
        actorType,
        actorId,
        evidencePatch: {
          void_payment_status: voidResult.payment.status,
          payment_flow_id: flow.id,
          void_idempotent_replay: voidResult.idempotentReplay,
          void_retry_scheduled: Boolean(voidResult.retryScheduled),
          void_next_retry_at: voidResult.nextRetryAt || null,
        },
      });

      return {
        recoveryCase: updated,
        transactionId: updated.transactionId,
        executionType: 'authorization_void',
        message: 'External authorization was released and the case is resolved.',
        idempotentReplay: voidResult.idempotentReplay,
        ledgerEntryId: updated.ledgerEntryId,
        paymentFlowId: updated.paymentFlowId,
      };
    }

    if (!record.ledgerEntryId) {
      throw new Error('INVALID_STATE: no wallet ledger debit is linked to this recovery case');
    }

    const debit = await loadLedgerEntry(record.userId, record.ledgerEntryId);
    if (!debit) {
      throw new Error(`Ledger entry not found: ${record.ledgerEntryId}`);
    }
    if (debit.direction !== 'debit' || debit.status !== 'succeeded') {
      throw new Error('INVALID_STATE: linked ledger debit is not in succeeded debit state');
    }

    const existingReversal = await findExistingReversal({
      userId: record.userId,
      recoveryCaseId: record.id,
      ledgerEntryId: record.ledgerEntryId,
    });

    const reason = input.reason || 'Wallet reversal issued from recovery center.';

    if (existingReversal) {
      const updated = await completeRecoveryCase({
        store: recoveryStore,
        record,
        reason,
        actionLabel: 'wallet_reversal_replayed',
        idempotencyKey,
        actorType,
        actorId,
        evidencePatch: {
          original_ledger_entry_id: record.ledgerEntryId,
          reversal_ledger_entry_id: existingReversal.id,
          idempotent_replay: true,
        },
      });

      return {
        recoveryCase: updated,
        transactionId: updated.transactionId,
        executionType: 'wallet_reversal',
        message: 'Wallet reversal was already completed and is now reflected in this case.',
        idempotentReplay: true,
        ledgerEntryId: existingReversal.id,
        paymentFlowId: updated.paymentFlowId,
      };
    }

    const reversal = await recordLedgerEntryUnique({
      userId: record.userId,
      type: 'reversal',
      amount: Number(debit.amount),
      currency: debit.currency,
      direction: 'credit',
      status: 'succeeded',
      merchant: debit.merchant || record.merchant,
      description: `Recovery reversal for ${debit.merchant || record.merchant}`,
      source: 'stripe',
      stripeObjectId: `recovery_reversal:${record.id}`,
      metadata: {
        recovery_case_id: record.id,
        original_ledger_entry_id: debit.id,
        reversal_reason: reason,
        idempotency_key: idempotencyKey,
      },
    });

    const updated = await completeRecoveryCase({
      store: recoveryStore,
      record,
      reason,
      actionLabel: 'wallet_reversal_completed',
      idempotencyKey,
      actorType,
      actorId,
      evidencePatch: {
        original_ledger_entry_id: record.ledgerEntryId,
        reversal_ledger_entry_id: reversal.id,
      },
    });

    return {
      recoveryCase: updated,
      transactionId: updated.transactionId,
      executionType: 'wallet_reversal',
      message: 'Wallet balance was restored instantly.',
      idempotentReplay: false,
      ledgerEntryId: reversal.id,
      paymentFlowId: updated.paymentFlowId,
    };
  }

  return {
    executeReversal,
  };
}
