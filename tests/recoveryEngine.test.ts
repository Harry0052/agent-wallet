import assert from 'node:assert/strict';
import test from 'node:test';
import { decideRecoveryAction } from '../lib/recovery/policies.ts';
import { groupRecoveryRecords } from '../lib/recovery/grouping.ts';

interface RecoveryCaseRecord {
  id: string;
  userId: string;
  transactionId: string;
  paymentFlowId: string | null;
  ledgerEntryId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  currentState: string;
  recommendedRecoveryAction: string;
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

function makeRecord(overrides: Partial<RecoveryCaseRecord> = {}): RecoveryCaseRecord {
  const now = new Date().toISOString();
  return {
    id: 'case_1',
    userId: 'user_1',
    transactionId: 'txn_1',
    paymentFlowId: null,
    ledgerEntryId: 'led_1',
    merchant: 'Netflix',
    amount: 7.99,
    currency: 'usd',
    currentState: 'wallet_debited',
    recommendedRecoveryAction: 'restore_wallet_balance',
    reason: 'No external settlement evidence found.',
    userFacingMessage: 'Funds can be restored instantly.',
    canSelfServe: true,
    auditRequirements: ['ledger_trace'],
    evidence: {
      hasExternalAuthorization: false,
      hasExternalCapture: false,
      activationConfirmed: false,
    },
    unresolved: true,
    needsManualReview: false,
    lastReconciledAt: now,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('internal debit only -> instant reversal recommendation', () => {
  const decision = decideRecoveryAction({
    currentState: 'wallet_debited',
    hasExternalAuthorization: false,
    hasExternalCapture: false,
    activationConfirmed: false,
    ambiguousState: false,
  });

  assert.equal(decision.recommendedRecoveryAction, 'restore_wallet_balance');
  assert.equal(decision.canSelfServe, true);
});

test('external authorization only -> void recommendation', () => {
  const decision = decideRecoveryAction({
    currentState: 'external_authorized',
    hasExternalAuthorization: true,
    hasExternalCapture: false,
    activationConfirmed: false,
    ambiguousState: false,
  });

  assert.equal(decision.recommendedRecoveryAction, 'void_external_authorization');
  assert.equal(decision.canSelfServe, true);
});

test('external capture without activation -> refund recommendation', () => {
  const decision = decideRecoveryAction({
    currentState: 'refund_available',
    hasExternalAuthorization: true,
    hasExternalCapture: true,
    activationConfirmed: false,
    ambiguousState: false,
  });

  assert.equal(decision.recommendedRecoveryAction, 'request_refund');
  assert.equal(decision.canSelfServe, true);
});

test('ambiguous state -> manual review recommendation', () => {
  const decision = decideRecoveryAction({
    currentState: 'activation_pending',
    hasExternalAuthorization: true,
    hasExternalCapture: false,
    activationConfirmed: false,
    ambiguousState: true,
  });

  assert.equal(decision.recommendedRecoveryAction, 'manual_review');
  assert.equal(decision.canSelfServe, false);
});

test('activation succeeds -> no refund allowed', () => {
  const decision = decideRecoveryAction({
    currentState: 'external_captured',
    hasExternalAuthorization: true,
    hasExternalCapture: true,
    activationConfirmed: true,
    ambiguousState: false,
  });

  assert.equal(decision.recommendedRecoveryAction, 'none');
  assert.equal(decision.canSelfServe, false);
});

test('dashboard grouping surfaces self-serve recovery rows', () => {
  const buckets = groupRecoveryRecords([
    makeRecord({
      id: 'case_instant',
      recommendedRecoveryAction: 'restore_wallet_balance',
      currentState: 'reversal_available',
    }),
    makeRecord({
      id: 'case_refund',
      recommendedRecoveryAction: 'request_refund',
      currentState: 'refund_available',
      paymentFlowId: 'flow_1',
      ledgerEntryId: null,
      evidence: {
        hasExternalAuthorization: true,
        hasExternalCapture: true,
      },
    }),
    makeRecord({
      id: 'case_review',
      recommendedRecoveryAction: 'manual_review',
      currentState: 'manual_review_required',
      canSelfServe: false,
      needsManualReview: true,
    }),
  ]);

  assert.equal(buckets.canBeRestoredInstantly.length, 1);
  assert.equal(buckets.refundInProgress.length, 1);
  assert.equal(buckets.needsReview.length, 1);
  assert.equal(buckets.canBeRestoredInstantly[0]?.id, 'case_instant');
});
