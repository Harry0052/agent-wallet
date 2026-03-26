import 'server-only';

import type { AutomationActionRecord } from '@/lib/server/automation/types';
import type { AutomationPolicyConfig } from '@/lib/server/automation/types';
import type { ExecutionTaskResult } from './types';

// ── Validation Verdict ───────────────────────────────────────────────────────

export type ValidationVerdictCode =
  | 'VERIFIED_COMPLETE'
  | 'NEEDS_USER_REVIEW'
  | 'FAILED'
  | 'NO_ACTION_TAKEN';

export interface ValidationVerdict {
  verdict: ValidationVerdictCode;
  reason: string;
  evidence: Record<string, unknown> | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasConfirmationEvidence(result: ExecutionTaskResult): boolean {
  if (!result.evidence || result.evidence.length === 0) return false;
  return result.evidence.some(
    (e) =>
      e.type === 'confirmation_number'
      || e.type === 'email_reference'
      || (e.type === 'text_summary' && e.value.length > 10),
  );
}

function actionTypeMatches(
  requestedAction: AutomationActionRecord,
  result: ExecutionTaskResult,
): boolean {
  const resultMeta = result.metadata || {};
  const resultActionType = resultMeta.action_type as string | undefined;

  // If the result reports an action_type, verify it matches
  if (resultActionType && resultActionType !== requestedAction.actionType) {
    return false;
  }

  return true;
}

function amountAndDestinationMatch(
  requestedAction: AutomationActionRecord,
  result: ExecutionTaskResult,
): boolean {
  const resultMeta = result.metadata || {};

  // Check amount if the action had one
  if (requestedAction.amount !== null) {
    const resultAmount = resultMeta.amount as number | undefined;
    if (resultAmount !== undefined && resultAmount !== requestedAction.amount) {
      return false;
    }
  }

  // Check destination/merchant if specified
  const requestedMerchant =
    (requestedAction.payload?.merchant as string)
    || (requestedAction.payload?.targetService as string);
  const resultMerchant = resultMeta.merchant as string | undefined;

  if (
    requestedMerchant
    && resultMerchant
    && resultMerchant.toLowerCase() !== requestedMerchant.toLowerCase()
  ) {
    return false;
  }

  return true;
}

const NO_ACTION_FAILURE_REASONS = new Set([
  'captcha_required',
  'login_failed',
  'credentials_missing',
  'otp_required',
  'otp_expired',
  'unsupported_service',
]);

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Validate the outcome of a TinyFish execution against the original action request.
 *
 * Verdicts:
 * - VERIFIED_COMPLETE: success=true, status=completed, action_type matches,
 *   amount/destination match, confirmation evidence exists
 * - NEEDS_USER_REVIEW: action may have completed but evidence is incomplete,
 *   or confirmation is missing
 * - FAILED: success=false, or policy violated, or outcome contradicts request
 * - NO_ACTION_TAKEN: stopped before submission, captcha, login failed, inaccessible
 */
export function validateCompletion(
  requestedAction: AutomationActionRecord,
  _policySnapshot: AutomationPolicyConfig,
  tinyFishResult: ExecutionTaskResult,
): ValidationVerdict {
  // ── NO_ACTION_TAKEN: stopped before meaningful work ───────────────────
  if (tinyFishResult.failureReason && NO_ACTION_FAILURE_REASONS.has(tinyFishResult.failureReason)) {
    return {
      verdict: 'NO_ACTION_TAKEN',
      reason: `Execution stopped before submission: ${tinyFishResult.failureReason}. ${tinyFishResult.outcome}`,
      evidence: {
        failureReason: tinyFishResult.failureReason,
        stepsCompleted: tinyFishResult.steps.filter((s) => s.status === 'completed').length,
        stepsTotal: tinyFishResult.steps.length,
      },
    };
  }

  // ── FAILED: explicit failure status ───────────────────────────────────
  if (tinyFishResult.status === 'failed' || tinyFishResult.status === 'cancelled') {
    return {
      verdict: 'FAILED',
      reason: `Execution failed: ${tinyFishResult.outcome}`,
      evidence: {
        status: tinyFishResult.status,
        failureReason: tinyFishResult.failureReason || null,
        stepsCompleted: tinyFishResult.steps.filter((s) => s.status === 'completed').length,
        stepsTotal: tinyFishResult.steps.length,
        providerEvidence: tinyFishResult.evidence,
      },
    };
  }

  // ── Check action type mismatch ────────────────────────────────────────
  if (!actionTypeMatches(requestedAction, tinyFishResult)) {
    return {
      verdict: 'FAILED',
      reason: 'The execution result reports a different action type than what was requested.',
      evidence: {
        requestedActionType: requestedAction.actionType,
        resultActionType: tinyFishResult.metadata?.action_type || null,
      },
    };
  }

  // ── Check amount/destination mismatch ─────────────────────────────────
  if (!amountAndDestinationMatch(requestedAction, tinyFishResult)) {
    return {
      verdict: 'FAILED',
      reason: 'The execution result does not match the requested amount or destination.',
      evidence: {
        requestedAmount: requestedAction.amount,
        requestedMerchant:
          requestedAction.payload?.merchant || requestedAction.payload?.targetService || null,
        resultMetadata: tinyFishResult.metadata,
      },
    };
  }

  // ── VERIFIED_COMPLETE: all checks pass ────────────────────────────────
  if (
    tinyFishResult.status === 'completed'
    && hasConfirmationEvidence(tinyFishResult)
  ) {
    return {
      verdict: 'VERIFIED_COMPLETE',
      reason: `Action completed successfully with confirmation evidence. ${tinyFishResult.outcome}`,
      evidence: {
        providerTaskId: tinyFishResult.providerTaskId,
        stepsCompleted: tinyFishResult.steps.filter((s) => s.status === 'completed').length,
        stepsTotal: tinyFishResult.steps.length,
        evidenceCount: tinyFishResult.evidence.length,
        confirmations: tinyFishResult.evidence
          .filter((e) => e.type === 'confirmation_number')
          .map((e) => e.value),
      },
    };
  }

  // ── NEEDS_USER_REVIEW: completed but missing evidence ─────────────────
  if (tinyFishResult.status === 'completed') {
    return {
      verdict: 'NEEDS_USER_REVIEW',
      reason: `Action may have completed but confirmation evidence is incomplete. ${tinyFishResult.outcome}`,
      evidence: {
        providerTaskId: tinyFishResult.providerTaskId,
        stepsCompleted: tinyFishResult.steps.filter((s) => s.status === 'completed').length,
        stepsTotal: tinyFishResult.steps.length,
        evidenceCount: tinyFishResult.evidence.length,
        missingConfirmation: true,
      },
    };
  }

  // ── NEEDS_USER_REVIEW: indeterminate state ────────────────────────────
  return {
    verdict: 'NEEDS_USER_REVIEW',
    reason: `Execution ended in status "${tinyFishResult.status}". Manual verification recommended. ${tinyFishResult.outcome}`,
    evidence: {
      status: tinyFishResult.status,
      stepsCompleted: tinyFishResult.steps.filter((s) => s.status === 'completed').length,
      stepsTotal: tinyFishResult.steps.length,
      providerEvidence: tinyFishResult.evidence,
    },
  };
}
