import 'server-only';
import { decideRecoveryAction } from '@/lib/recovery/policies';
import { createPostgresRecoveryStore, createRecoveryEngine, type RecoveryCaseRecord } from '@/lib/recovery/recoveryEngine';
import type { RecoveryState } from '@/lib/recovery/stateMachine';
import { createRefundService } from '@/lib/refunds/refundService';
import { createReversalService } from '@/lib/refunds/reversalService';
import { query } from '@/lib/server/db';

type PaymentCandidateRow = {
  payment_flow_id: string;
  user_id: string;
  merchant: string;
  amount: string;
  currency: string;
  funding_mode: 'STRIPE_AUTH_CAPTURE' | 'PREPAID_BALANCE';
  status: string;
  stripe_payment_intent_id: string | null;
  authorized_at: string | null;
  captured_at: string | null;
  refunded_at: string | null;
  activation_verified_at: string | null;
  requires_activation_verification: boolean;
  updated_at: string;
  created_at: string;
  activation_failed_reason: string | null;
  activation_failed_details: Record<string, unknown> | null;
  refund_case_id: string | null;
  refund_case_status: string | null;
  refund_case_last_error: string | null;
};

type LedgerCandidateRow = {
  ledger_entry_id: string;
  user_id: string;
  merchant: string | null;
  amount: string;
  currency: string;
  description: string;
  created_at: string;
  provider_reference_id: string | null;
  metadata: Record<string, unknown> | null;
};

type DerivedCase = {
  transactionId: string;
  paymentFlowId: string | null;
  ledgerEntryId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  currentState: RecoveryState;
  unresolved: boolean;
  needsManualReview: boolean;
  reason: string;
  userFacingMessage: string;
  recommendedRecoveryAction:
    | 'restore_wallet_balance'
    | 'void_external_authorization'
    | 'request_refund'
    | 'manual_review'
    | 'none';
  canSelfServe: boolean;
  auditRequirements: string[];
  evidence: Record<string, unknown>;
};

export interface ReconcileFailedPurchasesResult {
  scanned: number;
  detectedUnresolved: number;
  created: number;
  updated: number;
}

export interface RecoveryAutomationResult {
  autoAttempted: number;
  autoSucceeded: number;
  autoFailed: number;
}

function toAmount(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function minutesBetween(iso: string): number {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, (Date.now() - ts) / 60_000);
}

function mapPaymentCandidate(row: PaymentCandidateRow): DerivedCase | null {
  const hasExternalAuthorization = row.funding_mode === 'STRIPE_AUTH_CAPTURE'
    && Boolean(row.stripe_payment_intent_id)
    && Boolean(row.authorized_at);
  const hasExternalCapture = row.funding_mode === 'STRIPE_AUTH_CAPTURE'
    && (
      Boolean(row.captured_at)
      || row.status === 'captured'
      || row.status === 'refund_pending'
      || row.status === 'refunded'
    );
  const activationConfirmed = Boolean(row.activation_verified_at);
  const staleMinutes = minutesBetween(row.updated_at || row.created_at);
  const stalePending = staleMinutes >= 20;

  let state: RecoveryState | null = null;
  let unresolved = true;
  let ambiguousState = false;

  if (row.refund_case_status === 'refund_completed' || row.status === 'refunded') {
    state = 'refund_completed';
    unresolved = false;
  } else if (row.refund_case_status === 'refund_requested') {
    state = 'refund_requested';
  } else if (
    row.refund_case_status === 'refund_in_progress'
    || row.refund_case_status === 'dispute_prepared'
    || row.status === 'refund_pending'
  ) {
    state = 'refund_in_progress';
  } else if (row.refund_case_status === 'dispute_submitted') {
    state = 'manual_review_required';
    ambiguousState = true;
  } else if (row.funding_mode === 'PREPAID_BALANCE') {
    if (row.status === 'captured' && !activationConfirmed) {
      state = 'reversal_available';
    } else if (row.status === 'activation_failed') {
      state = 'reversal_available';
    } else if (row.status === 'refunded') {
      state = 'reversal_completed';
      unresolved = false;
    }
  } else if (hasExternalCapture && !activationConfirmed) {
    state = row.activation_failed_reason ? 'refund_available' : 'activation_unverified';
  } else if (hasExternalAuthorization && !hasExternalCapture) {
    if (row.status === 'activation_failed' || row.activation_failed_reason) {
      state = 'reversal_available';
    } else if (stalePending) {
      state = 'external_authorized';
    }
  } else if (row.status === 'activation_pending' && stalePending) {
    state = 'activation_pending';
    ambiguousState = true;
  }

  if (!state) return null;

  const policyDecision = decideRecoveryAction({
    currentState: state,
    hasExternalAuthorization,
    hasExternalCapture,
    activationConfirmed,
    ambiguousState,
  });

  return {
    transactionId: row.payment_flow_id,
    paymentFlowId: row.payment_flow_id,
    ledgerEntryId: null,
    merchant: row.merchant,
    amount: toAmount(row.amount),
    currency: row.currency,
    currentState: state,
    unresolved,
    needsManualReview: ambiguousState || state === 'manual_review_required',
    reason: policyDecision.reason,
    userFacingMessage: policyDecision.userFacingMessage,
    recommendedRecoveryAction: policyDecision.recommendedRecoveryAction,
    canSelfServe: policyDecision.canSelfServe,
    auditRequirements: policyDecision.auditRequirements,
    evidence: {
      source: 'payment_flow',
      paymentFlowId: row.payment_flow_id,
      paymentStatus: row.status,
      refundCaseId: row.refund_case_id,
      refundCaseStatus: row.refund_case_status,
      refundCaseLastError: row.refund_case_last_error,
      fundingMode: row.funding_mode,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      hasExternalAuthorization,
      hasExternalCapture,
      activationConfirmed,
      activationFailedReason: row.activation_failed_reason,
      activationFailedDetails: row.activation_failed_details || null,
      staleMinutes: Math.round(staleMinutes),
    },
  };
}

function mapLedgerCandidate(row: LedgerCandidateRow): DerivedCase {
  const merchant = (row.merchant || '').trim() || 'Unknown merchant';
  const policyDecision = decideRecoveryAction({
    currentState: 'wallet_debited',
    hasExternalAuthorization: false,
    hasExternalCapture: false,
    activationConfirmed: false,
    ambiguousState: false,
  });

  return {
    transactionId: row.ledger_entry_id,
    paymentFlowId: null,
    ledgerEntryId: row.ledger_entry_id,
    merchant,
    amount: toAmount(row.amount),
    currency: row.currency,
    currentState: 'wallet_debited',
    unresolved: true,
    needsManualReview: false,
    reason: policyDecision.reason,
    userFacingMessage: policyDecision.userFacingMessage,
    recommendedRecoveryAction: policyDecision.recommendedRecoveryAction,
    canSelfServe: policyDecision.canSelfServe,
    auditRequirements: policyDecision.auditRequirements,
    evidence: {
      source: 'ledger_entry',
      ledgerEntryId: row.ledger_entry_id,
      createdAt: row.created_at,
      description: row.description,
      providerReferenceId: row.provider_reference_id,
      metadata: row.metadata || null,
      hasExternalAuthorization: false,
      hasExternalCapture: false,
      activationConfirmed: false,
    },
  };
}

async function fetchPaymentCandidates(userId: string, limit: number): Promise<PaymentCandidateRow[]> {
  const result = await query<PaymentCandidateRow>(
    `
      SELECT
        pf.id AS payment_flow_id,
        pf.user_id,
        pf.merchant,
        pf.amount::text,
        pf.currency,
        pf.funding_mode,
        pf.status,
        pf.stripe_payment_intent_id,
        pf.authorized_at::text,
        pf.captured_at::text,
        pf.refunded_at::text,
        pf.activation_verified_at::text,
        pf.requires_activation_verification,
        pf.updated_at::text,
        pf.created_at::text,
        af.reason AS activation_failed_reason,
        af.details AS activation_failed_details,
        rc.id AS refund_case_id,
        rc.status AS refund_case_status,
        rc.last_error AS refund_case_last_error
      FROM payment_flows pf
      LEFT JOIN LATERAL (
        SELECT reason, details
        FROM payment_flow_events e
        WHERE e.payment_flow_id = pf.id
          AND e.event_type = 'activation_failed'
        ORDER BY e.created_at DESC
        LIMIT 1
      ) af ON TRUE
      LEFT JOIN refund_cases rc
        ON rc.payment_flow_id = pf.id
       AND rc.user_id = pf.user_id
      WHERE pf.user_id = $1
      ORDER BY pf.updated_at DESC
      LIMIT $2
    `,
    [userId, limit],
  );

  return result.rows;
}

async function fetchLedgerCandidates(userId: string, limit: number): Promise<LedgerCandidateRow[]> {
  const result = await query<LedgerCandidateRow>(
    `
      SELECT
        le.id AS ledger_entry_id,
        le.user_id,
        le.merchant,
        le.amount::text,
        le.currency,
        le.description,
        le.created_at::text,
        le.provider_reference_id,
        le.metadata
      FROM ledger_entries le
      WHERE le.user_id = $1
        AND le.type = 'subscription_debit'
        AND le.direction = 'debit'
        AND le.status = 'succeeded'
        AND (le.metadata->>'payment_flow_id') IS NULL
        AND (le.provider_reference_id IS NULL OR le.provider_reference_id NOT LIKE 'two_phase_capture:%')
        AND NOT EXISTS (
          SELECT 1
          FROM ledger_entries cr
          WHERE cr.user_id = le.user_id
            AND cr.direction = 'credit'
            AND cr.status = 'succeeded'
            AND (
              cr.metadata->>'reversal_of_ledger_entry_id' = le.id
              OR cr.metadata->>'original_ledger_entry_id' = le.id
            )
        )
      ORDER BY le.created_at DESC
      LIMIT $2
    `,
    [userId, limit],
  );

  return result.rows;
}

async function writeCaseAndAudit(
  existing: RecoveryCaseRecord | null,
  candidate: DerivedCase,
  userId: string,
): Promise<'created' | 'updated' | 'unchanged'> {
  const store = createPostgresRecoveryStore();
  const upserted = await store.upsertCase({
    userId,
    transactionId: candidate.transactionId,
    paymentFlowId: candidate.paymentFlowId,
    ledgerEntryId: candidate.ledgerEntryId,
    merchant: candidate.merchant,
    amount: candidate.amount,
    currency: candidate.currency,
    currentState: candidate.currentState,
    recommendedRecoveryAction: candidate.recommendedRecoveryAction,
    reason: candidate.reason,
    userFacingMessage: candidate.userFacingMessage,
    canSelfServe: candidate.canSelfServe,
    auditRequirements: candidate.auditRequirements,
    evidence: candidate.evidence,
    unresolved: candidate.unresolved,
    needsManualReview: candidate.needsManualReview,
  });

  if (!existing) {
    await store.appendAudit({
      recoveryCaseId: upserted.id,
      userId,
      actorType: 'system',
      actorId: 'reconcile_job',
      action: 'case_detected',
      fromState: null,
      toState: upserted.currentState,
      details: {
        source: candidate.evidence.source,
        recommendedRecoveryAction: upserted.recommendedRecoveryAction,
      },
      idempotencyKey: `reconcile:create:${candidate.transactionId}`,
    });
    return 'created';
  }

  const stateChanged = existing.currentState !== upserted.currentState
    || existing.recommendedRecoveryAction !== upserted.recommendedRecoveryAction
    || existing.unresolved !== upserted.unresolved;
  if (!stateChanged) return 'unchanged';

  await store.appendAudit({
    recoveryCaseId: upserted.id,
    userId,
    actorType: 'system',
    actorId: 'reconcile_job',
    action: 'state_reconciled',
    fromState: existing.currentState,
    toState: upserted.currentState,
    details: {
      previousAction: existing.recommendedRecoveryAction,
      nextAction: upserted.recommendedRecoveryAction,
      unresolved: upserted.unresolved,
    },
    idempotencyKey: `reconcile:update:${candidate.transactionId}:${upserted.currentState}:${upserted.recommendedRecoveryAction}`,
  });
  return 'updated';
}

export async function reconcileFailedPurchases(input: {
  userId: string;
  limit?: number;
}): Promise<ReconcileFailedPurchasesResult> {
  const limit = Number.isFinite(input.limit) && (input.limit || 0) > 0
    ? Math.min(Math.round(input.limit || 200), 500)
    : 200;

  const store = createPostgresRecoveryStore();
  const [paymentRows, ledgerRows] = await Promise.all([
    fetchPaymentCandidates(input.userId, limit),
    fetchLedgerCandidates(input.userId, limit),
  ]);

  const candidates: DerivedCase[] = [];
  for (const row of paymentRows) {
    const mapped = mapPaymentCandidate(row);
    if (mapped) candidates.push(mapped);
  }
  for (const row of ledgerRows) {
    candidates.push(mapLedgerCandidate(row));
  }

  let created = 0;
  let updated = 0;
  let detectedUnresolved = 0;

  for (const candidate of candidates) {
    if (candidate.unresolved) detectedUnresolved += 1;
    const existing = await store.getCaseByTransactionId(input.userId, candidate.transactionId);
    const result = await writeCaseAndAudit(existing, candidate, input.userId);
    if (result === 'created') created += 1;
    if (result === 'updated') updated += 1;
  }

  return {
    scanned: paymentRows.length + ledgerRows.length,
    detectedUnresolved,
    created,
    updated,
  };
}

export async function runRecoveryReconciliationCycle(input: {
  userId: string;
  limit?: number;
  autoRecover?: boolean;
}): Promise<ReconcileFailedPurchasesResult & RecoveryAutomationResult> {
  const reconcileResult = await reconcileFailedPurchases({
    userId: input.userId,
    limit: input.limit,
  });

  if (!input.autoRecover) {
    return {
      ...reconcileResult,
      autoAttempted: 0,
      autoSucceeded: 0,
      autoFailed: 0,
    };
  }

  const limit = Number.isFinite(input.limit) && (input.limit || 0) > 0
    ? Math.min(Math.round(input.limit || 100), 500)
    : 100;

  const recoveryEngine = createRecoveryEngine();
  const reversalService = createReversalService({ recoveryStore: recoveryEngine.store });
  const refundService = createRefundService({ recoveryStore: recoveryEngine.store });
  const unresolved = await recoveryEngine.list({
    userId: input.userId,
    unresolvedOnly: true,
    limit,
  });

  let autoAttempted = 0;
  let autoSucceeded = 0;
  let autoFailed = 0;

  for (const record of unresolved.records) {
    const action = record.recommendedRecoveryAction;
    if (
      action !== 'restore_wallet_balance'
      && action !== 'void_external_authorization'
      && action !== 'request_refund'
    ) {
      continue;
    }

    autoAttempted += 1;
    try {
      if (action === 'request_refund') {
        await refundService.requestRefund({
          userId: record.userId,
          recoveryCaseId: record.id,
          idempotencyKey: `auto_recover:refund:${record.id}`,
          actorType: 'system',
          actorId: 'auto_recovery_scheduler',
          allowWithoutActivationFailure: true,
        });
      } else {
        await reversalService.executeReversal({
          userId: record.userId,
          recoveryCaseId: record.id,
          idempotencyKey: `auto_recover:reversal:${record.id}`,
          actorType: 'system',
          actorId: 'auto_recovery_scheduler',
          reason: action === 'void_external_authorization'
            ? 'Automatic authorization release from recovery scheduler.'
            : 'Automatic wallet reversal from recovery scheduler.',
        });
      }
      autoSucceeded += 1;
    } catch (error) {
      autoFailed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      const updated = await recoveryEngine.store.upsertCase({
        userId: record.userId,
        transactionId: record.transactionId,
        paymentFlowId: record.paymentFlowId,
        ledgerEntryId: record.ledgerEntryId,
        merchant: record.merchant,
        amount: record.amount,
        currency: record.currency,
        currentState: 'manual_review_required',
        recommendedRecoveryAction: 'manual_review',
        reason: `Automatic recovery attempt failed: ${reason}`,
        userFacingMessage: 'This purchase needs manual review before recovery can continue.',
        canSelfServe: false,
        auditRequirements: record.auditRequirements,
        evidence: {
          ...(record.evidence || {}),
          auto_recovery_error: reason,
          auto_recovery_failed_at: new Date().toISOString(),
        },
        unresolved: true,
        needsManualReview: true,
      });
      await recoveryEngine.store.appendAudit({
        recoveryCaseId: updated.id,
        userId: updated.userId,
        actorType: 'system',
        actorId: 'auto_recovery_scheduler',
        action: 'auto_recovery_failed',
        fromState: record.currentState,
        toState: updated.currentState,
        details: {
          previousAction: action,
          error: reason,
        },
        idempotencyKey: `auto_recover:fail:${record.id}`,
      });
    }
  }

  return {
    ...reconcileResult,
    autoAttempted,
    autoSucceeded,
    autoFailed,
  };
}
