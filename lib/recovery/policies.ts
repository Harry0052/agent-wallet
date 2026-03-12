import { timingSafeEqual } from 'node:crypto';
import type { RecoveryState } from '@/lib/recovery/stateMachine';
import { getOptionalSecret } from '@/security/secretsManager';

export type RecoveryAction =
  | 'restore_wallet_balance'
  | 'void_external_authorization'
  | 'request_refund'
  | 'manual_review'
  | 'none';

export interface RecoveryPolicyInput {
  currentState: RecoveryState;
  hasExternalAuthorization: boolean;
  hasExternalCapture: boolean;
  activationConfirmed: boolean;
  ambiguousState: boolean;
}

export interface RecoveryPolicyDecision {
  recommendedRecoveryAction: RecoveryAction;
  reason: string;
  userFacingMessage: string;
  canSelfServe: boolean;
  auditRequirements: string[];
}

function decision(input: RecoveryPolicyDecision): RecoveryPolicyDecision {
  return input;
}

export function decideRecoveryAction(input: RecoveryPolicyInput): RecoveryPolicyDecision {
  if (input.activationConfirmed) {
    return decision({
      recommendedRecoveryAction: 'none',
      reason: 'Service activation is confirmed; recovery is not permitted.',
      userFacingMessage: 'This purchase is active, so no reversal or refund is available.',
      canSelfServe: false,
      auditRequirements: ['activation_evidence', 'state_transition_log'],
    });
  }

  if (input.ambiguousState) {
    return decision({
      recommendedRecoveryAction: 'manual_review',
      reason: 'State is ambiguous and requires operations review.',
      userFacingMessage: 'We need a manual review before changing funds on this purchase.',
      canSelfServe: false,
      auditRequirements: ['processor_state_snapshot', 'ledger_trace', 'activation_trace'],
    });
  }

  if (input.currentState === 'refund_requested' || input.currentState === 'refund_in_progress') {
    return decision({
      recommendedRecoveryAction: 'none',
      reason: 'Refund workflow is already running.',
      userFacingMessage: 'Refund is already in progress. You can track status from this page.',
      canSelfServe: false,
      auditRequirements: ['refund_case_status', 'timeline_events'],
    });
  }

  if (input.currentState === 'refund_completed' || input.currentState === 'reversal_completed') {
    return decision({
      recommendedRecoveryAction: 'none',
      reason: 'Recovery is already completed.',
      userFacingMessage: 'Recovery has completed and funds were already restored.',
      canSelfServe: false,
      auditRequirements: ['completion_evidence'],
    });
  }

  if (!input.hasExternalCapture && !input.hasExternalAuthorization) {
    return decision({
      recommendedRecoveryAction: 'restore_wallet_balance',
      reason: 'No external settlement evidence found; internal reversal is safe.',
      userFacingMessage: 'Funds can be restored instantly because no external settlement is recorded.',
      canSelfServe: true,
      auditRequirements: ['ledger_debit_reference', 'no_external_capture_proof', 'idempotency_key'],
    });
  }

  if (!input.hasExternalCapture && input.hasExternalAuthorization) {
    return decision({
      recommendedRecoveryAction: 'void_external_authorization',
      reason: 'External payment is authorized but not captured; release/void is safest.',
      userFacingMessage: 'Authorization can be released now because capture has not occurred.',
      canSelfServe: true,
      auditRequirements: ['processor_authorization_reference', 'capture_absence_proof', 'idempotency_key'],
    });
  }

  if (input.hasExternalCapture) {
    return decision({
      recommendedRecoveryAction: 'request_refund',
      reason: 'External capture occurred without confirmed activation.',
      userFacingMessage: 'A refund request can be started directly from Agent Wallet.',
      canSelfServe: true,
      auditRequirements: ['capture_reference', 'activation_failure_evidence', 'refund_idempotency_key'],
    });
  }

  return decision({
    recommendedRecoveryAction: 'manual_review',
    reason: 'No policy branch matched safely.',
    userFacingMessage: 'This purchase requires manual review before recovery.',
    canSelfServe: false,
    auditRequirements: ['full_case_export'],
  });
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminOverrideAuthorized(headers: Headers): boolean {
  const configured = getOptionalSecret('RECOVERY_ADMIN_TOKEN') || '';
  if (!configured) return false;

  const presented = (headers.get('x-agent-wallet-admin-token') || '').trim();
  if (!presented) return false;

  return secureEqual(configured, presented);
}
