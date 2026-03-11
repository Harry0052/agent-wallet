import { createHash } from 'node:crypto';

export interface RefundEvidencePayment {
  paymentFlowId: string;
  userId: string;
  merchant: string;
  amount: number;
  currency: string;
  stripePaymentIntentId: string | null;
  capturedAt: string | null;
}

export interface RefundEvidenceCase {
  id: string;
  status: string;
  retryCount: number;
  createdAt: string;
}

export interface RefundEvidenceAudit {
  id: string;
  action: string;
  fromState: string | null;
  toState: string;
  message: string;
  createdAt: string;
  details: Record<string, unknown> | null;
}

export interface RefundEvidencePack {
  packetId: string;
  createdAt: string;
  hash: string;
  summary: {
    paymentFlowId: string;
    merchant: string;
    amount: number;
    currency: string;
    activationFailureReason: string;
  };
  timeline: Array<{
    at: string;
    action: string;
    message: string;
    toState: string;
  }>;
  artifacts: {
    payment: RefundEvidencePayment;
    refundCase: RefundEvidenceCase;
    activationEvidence: Record<string, unknown> | null;
    auditCount: number;
  };
}

export function buildRefundEvidencePack(input: {
  refundCase: {
    id: string;
    status: string;
    retryCount: number;
    createdAt: string;
  };
  payment: RefundEvidencePayment;
  activationFailureReason: string;
  activationEvidence?: Record<string, unknown> | null;
  auditLogs: RefundEvidenceAudit[];
}): RefundEvidencePack {
  const createdAt = new Date().toISOString();
  const packetId = `refund_pkt_${input.refundCase.id}`;

  const timeline = input.auditLogs.map((log) => ({
    at: log.createdAt,
    action: log.action,
    message: log.message,
    toState: log.toState,
  }));

  const payload = {
    packetId,
    createdAt,
    summary: {
      paymentFlowId: input.payment.paymentFlowId,
      merchant: input.payment.merchant,
      amount: input.payment.amount,
      currency: input.payment.currency,
      activationFailureReason: input.activationFailureReason,
    },
    timeline,
    artifacts: {
      payment: input.payment,
      refundCase: {
        id: input.refundCase.id,
        status: input.refundCase.status,
        retryCount: input.refundCase.retryCount,
        createdAt: input.refundCase.createdAt,
      },
      activationEvidence: input.activationEvidence || null,
      auditCount: input.auditLogs.length,
    },
  };

  const hash = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

  return {
    ...payload,
    hash,
  };
}

export function buildRefundUserExplanation(input: {
  state: string;
  merchant: string;
  amount: number;
  currency: string;
  reason: string;
  referenceId?: string;
}): string {
  const amount = `${input.amount.toFixed(2)} ${input.currency.toUpperCase()}`;

  if (input.state === 'refund_completed') {
    return `We confirmed ${input.merchant} failed to activate your service. A refund of ${amount} has been completed${input.referenceId ? ` (reference ${input.referenceId})` : ''}.`;
  }

  if (input.state === 'dispute_submitted') {
    return `We confirmed ${input.merchant} failed to activate your service. Merchant refund was unavailable, so we submitted a processor dispute packet${input.referenceId ? ` (reference ${input.referenceId})` : ''}.`;
  }

  if (input.state === 'dispute_prepared') {
    return `Activation failed for ${input.merchant}. We prepared a processor dispute packet and are submitting it now.`;
  }

  if (input.state === 'refund_in_progress') {
    return `Activation failed for ${input.merchant}. A refund request for ${amount} is in progress.`;
  }

  if (input.state === 'refund_requested') {
    return `Activation failed for ${input.merchant}. We requested a refund and are waiting for provider confirmation.`;
  }

  if (input.state === 'service_not_activated') {
    return `Payment was captured by ${input.merchant}, but service activation failed: ${input.reason}.`;
  }

  return `Refund orchestration started for ${input.merchant}. Reason: ${input.reason}.`;
}
