import 'server-only';
import {
  createPostgresRecoveryStore,
  type RecoveryCaseRecord,
  type RecoveryStore,
} from '@/lib/recovery/recoveryEngine';
import { createPostgresRefundStore, createRefundEngine, type MerchantRefundAdapter, type ProcessorFallbackAdapter } from '@/lib/refunds/refundEngine';
import { getStripeClient } from '@/lib/server/stripe';
import { logServerEvent } from '@/lib/server/observability';

// Keep the adapter contract colocated with service orchestration so API routes,
// reconciliation jobs, and admin tooling all execute the exact same refund path.
const merchantHttpRefundAdapter: MerchantRefundAdapter = {
  id: 'merchant-http-refund',
  supports(payment) {
    return typeof payment.metadata?.merchant_refund_url === 'string';
  },
  async requestRefund(input) {
    const url = typeof input.payment.metadata?.merchant_refund_url === 'string'
      ? input.payment.metadata.merchant_refund_url
      : null;

    if (!url) {
      return {
        status: 'unavailable',
        message: 'No merchant refund URL configured for this payment.',
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-wallet-idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        paymentFlowId: input.payment.paymentFlowId,
        amount: input.payment.amount,
        currency: input.payment.currency,
        reason: input.reason,
      }),
    });

    if (response.status === 404 || response.status === 405) {
      return {
        status: 'unavailable',
        message: `Merchant refund endpoint does not support automated refunds (${response.status}).`,
      };
    }

    if (!response.ok) {
      throw new Error(`Merchant refund endpoint failed (${response.status}).`);
    }

    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      referenceId?: string;
      message?: string;
      retryAfterMs?: number;
    };
    const status = String(payload.status || '').toLowerCase();

    if (status === 'completed') {
      return {
        status: 'completed',
        referenceId: payload.referenceId || `merchant_ref_${input.refundCase.id}`,
        message: payload.message || 'Merchant confirmed refund completion.',
      };
    }

    if (status === 'unavailable') {
      return {
        status: 'unavailable',
        message: payload.message || 'Merchant refund route unavailable.',
      };
    }

    return {
      status: 'in_progress',
      referenceId: payload.referenceId,
      message: payload.message || 'Merchant refund request accepted and pending.',
      retryAfterMs: typeof payload.retryAfterMs === 'number' ? payload.retryAfterMs : undefined,
    };
  },
};

const stripeProcessorFallback: ProcessorFallbackAdapter = {
  id: 'stripe-processor-fallback',
  async submitDisputePacket(input) {
    if (!input.payment.stripePaymentIntentId) {
      return {
        submitted: false,
        message: 'No processor payment intent available for fallback submission.',
      };
    }

    const refund = await getStripeClient().refunds.create(
      {
        payment_intent: input.payment.stripePaymentIntentId,
        reason: 'requested_by_customer',
        metadata: {
          refund_case_id: input.refundCase.id,
          payment_flow_id: input.payment.paymentFlowId,
          evidence_packet_id: input.evidencePack.packetId,
          evidence_hash: input.evidencePack.hash,
        },
      },
      {
        idempotencyKey: input.idempotencyKey,
      },
    );

    return {
      submitted: true,
      referenceId: refund.id,
      disputeId: refund.id,
      message: 'Processor-side refund/dispute packet submitted to Stripe.',
      raw: {
        refundId: refund.id,
      },
    };
  },
};

export interface RequestRecoveryRefundInput {
  userId: string;
  recoveryCaseId: string;
  idempotencyKey: string;
  activationFailureReason?: string;
  activationEvidence?: Record<string, unknown>;
  allowWithoutActivationFailure?: boolean;
  actorType?: 'system' | 'user' | 'admin';
  actorId?: string;
  adminOverride?: boolean;
}

export interface RequestRecoveryRefundResult {
  recoveryCase: RecoveryCaseRecord;
  refundCase: {
    id: string;
    paymentFlowId: string;
    status: string;
    merchant: string;
    amount: number;
    currency: string;
  };
  auditLogs: Array<{
    id: string;
    action: string;
    fromState: string | null;
    toState: string;
    message: string;
    createdAt: string;
    details: Record<string, unknown> | null;
    idempotencyKey: string | null;
  }>;
  userExplanation: string;
}

function ensureIdempotencyKey(input: string): string {
  const normalized = input.trim();
  if (!normalized) throw new Error('idempotencyKey is required');
  return normalized;
}

function normalizeActor(input: RequestRecoveryRefundInput): { actorType: 'system' | 'user' | 'admin'; actorId: string } {
  const actorType = input.actorType || 'user';
  const actorId = (input.actorId || input.userId).trim() || input.userId;
  return { actorType, actorId };
}

function readEvidenceBoolean(evidence: Record<string, unknown> | null | undefined, key: string): boolean {
  if (!evidence) return false;
  return evidence[key] === true;
}

function mapRefundStatusToRecoveryState(status: string): {
  state: RecoveryCaseRecord['currentState'];
  unresolved: boolean;
  needsManualReview: boolean;
  nextAction: RecoveryCaseRecord['recommendedRecoveryAction'];
} {
  if (status === 'refund_completed') {
    return {
      state: 'refund_completed',
      unresolved: false,
      needsManualReview: false,
      nextAction: 'none',
    };
  }

  if (status === 'dispute_submitted') {
    return {
      state: 'manual_review_required',
      unresolved: true,
      needsManualReview: true,
      nextAction: 'manual_review',
    };
  }

  if (
    status === 'refund_requested'
    || status === 'service_not_activated'
    || status === 'payment_captured'
  ) {
    return {
      state: 'refund_requested',
      unresolved: true,
      needsManualReview: false,
      nextAction: 'request_refund',
    };
  }

  return {
    state: 'refund_in_progress',
    unresolved: true,
    needsManualReview: false,
    nextAction: 'request_refund',
  };
}

function createEngine() {
  return createRefundEngine({
    store: createPostgresRefundStore(),
    merchantAdapters: [merchantHttpRefundAdapter],
    processorFallback: stripeProcessorFallback,
    logger: {
      info: (event, payload) => logServerEvent('info', event, payload),
      warn: (event, payload) => logServerEvent('warn', event, payload),
      error: (event, payload) => logServerEvent('error', event, payload),
    },
  });
}

export function createRefundService(params?: {
  recoveryStore?: RecoveryStore;
}) {
  const recoveryStore = params?.recoveryStore || createPostgresRecoveryStore();

  async function requestRefund(input: RequestRecoveryRefundInput): Promise<RequestRecoveryRefundResult> {
    const idempotencyKey = ensureIdempotencyKey(input.idempotencyKey);
    const { actorType, actorId } = normalizeActor(input);

    const caseRecord = await recoveryStore.getCaseById(input.userId, input.recoveryCaseId);
    if (!caseRecord) {
      throw new Error(`Recovery case not found: ${input.recoveryCaseId}`);
    }

    if (!caseRecord.paymentFlowId) {
      throw new Error('INVALID_STATE: recovery case does not reference a payment flow');
    }

    const hasExternalCapture = readEvidenceBoolean(caseRecord.evidence, 'hasExternalCapture');
    if (!input.adminOverride && !hasExternalCapture) {
      throw new Error('POLICY_FAILURE: refund requires confirmed external capture evidence');
    }

    if (!input.adminOverride && caseRecord.recommendedRecoveryAction === 'none') {
      throw new Error('INVALID_STATE: recovery is already completed for this case');
    }

    if (
      !input.adminOverride
      && caseRecord.recommendedRecoveryAction !== 'request_refund'
      && caseRecord.currentState !== 'refund_requested'
      && caseRecord.currentState !== 'refund_in_progress'
      && caseRecord.currentState !== 'refund_available'
    ) {
      throw new Error(`POLICY_FAILURE: refund action is not available in state ${caseRecord.currentState}`);
    }

    const engine = createEngine();
    const status = await engine.initiateRefund({
      userId: input.userId,
      paymentFlowId: caseRecord.paymentFlowId,
      idempotencyKey,
      activationFailureReason: input.activationFailureReason,
      activationEvidence: input.activationEvidence || caseRecord.evidence || undefined,
      allowWithoutActivationFailure: input.allowWithoutActivationFailure ?? true,
    });

    const mapping = mapRefundStatusToRecoveryState(status.refundCase.status);
    const updatedCase = await recoveryStore.upsertCase({
      userId: caseRecord.userId,
      transactionId: caseRecord.transactionId,
      paymentFlowId: caseRecord.paymentFlowId,
      ledgerEntryId: caseRecord.ledgerEntryId,
      merchant: caseRecord.merchant,
      amount: caseRecord.amount,
      currency: caseRecord.currency,
      currentState: mapping.state,
      recommendedRecoveryAction: mapping.nextAction,
      reason: `Refund status: ${status.refundCase.status}`,
      userFacingMessage: status.userExplanation,
      canSelfServe: mapping.nextAction === 'request_refund',
      auditRequirements: caseRecord.auditRequirements,
      evidence: {
        ...(caseRecord.evidence || {}),
        refund_case_id: status.refundCase.id,
        refund_status: status.refundCase.status,
        refund_updated_at: new Date().toISOString(),
      },
      unresolved: mapping.unresolved,
      needsManualReview: mapping.needsManualReview,
    });

    await recoveryStore.appendAudit({
      recoveryCaseId: updatedCase.id,
      userId: updatedCase.userId,
      actorType,
      actorId,
      action: 'refund_request_submitted',
      fromState: caseRecord.currentState,
      toState: updatedCase.currentState,
      details: {
        refundCaseId: status.refundCase.id,
        refundStatus: status.refundCase.status,
      },
      idempotencyKey,
    });

    return {
      recoveryCase: updatedCase,
      refundCase: {
        id: status.refundCase.id,
        paymentFlowId: status.refundCase.paymentFlowId,
        status: status.refundCase.status,
        merchant: status.refundCase.merchant,
        amount: status.refundCase.amount,
        currency: status.refundCase.currency,
      },
      auditLogs: status.auditLogs,
      userExplanation: status.userExplanation,
    };
  }

  async function syncRefundStatus(input: {
    userId: string;
    recoveryCaseId: string;
  }): Promise<RequestRecoveryRefundResult | null> {
    const caseRecord = await recoveryStore.getCaseById(input.userId, input.recoveryCaseId);
    if (!caseRecord || !caseRecord.paymentFlowId) return null;

    const engine = createEngine();
    const status = await engine.getRefundStatus({
      userId: input.userId,
      paymentFlowId: caseRecord.paymentFlowId,
    });

    if (!status) return null;

    const mapping = mapRefundStatusToRecoveryState(status.refundCase.status);
    const updatedCase = await recoveryStore.upsertCase({
      userId: caseRecord.userId,
      transactionId: caseRecord.transactionId,
      paymentFlowId: caseRecord.paymentFlowId,
      ledgerEntryId: caseRecord.ledgerEntryId,
      merchant: caseRecord.merchant,
      amount: caseRecord.amount,
      currency: caseRecord.currency,
      currentState: mapping.state,
      recommendedRecoveryAction: mapping.nextAction,
      reason: `Refund status synchronized: ${status.refundCase.status}`,
      userFacingMessage: status.userExplanation,
      canSelfServe: mapping.nextAction === 'request_refund',
      auditRequirements: caseRecord.auditRequirements,
      evidence: {
        ...(caseRecord.evidence || {}),
        refund_case_id: status.refundCase.id,
        refund_status: status.refundCase.status,
        refund_synced_at: new Date().toISOString(),
      },
      unresolved: mapping.unresolved,
      needsManualReview: mapping.needsManualReview,
    });

    return {
      recoveryCase: updatedCase,
      refundCase: {
        id: status.refundCase.id,
        paymentFlowId: status.refundCase.paymentFlowId,
        status: status.refundCase.status,
        merchant: status.refundCase.merchant,
        amount: status.refundCase.amount,
        currency: status.refundCase.currency,
      },
      auditLogs: status.auditLogs,
      userExplanation: status.userExplanation,
    };
  }

  return {
    requestRefund,
    syncRefundStatus,
  };
}
