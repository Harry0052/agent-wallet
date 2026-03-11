import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRefundEngine,
  type MerchantRefundAdapter,
  type ProcessorFallbackAdapter,
  type RefundAuditLog,
  type RefundCandidate,
  type RefundCase,
  type RefundPaymentSnapshot,
  type RefundStore,
} from '../lib/refunds/refundEngine.ts';

class InMemoryRefundStore implements RefundStore {
  payments = new Map<string, RefundPaymentSnapshot>();
  cases = new Map<string, RefundCase>();
  caseByPayment = new Map<string, string>();
  audits: RefundAuditLog[] = [];
  caseSeq = 0;
  auditSeq = 0;

  key(userId: string, paymentFlowId: string): string {
    return `${userId}:${paymentFlowId}`;
  }

  seedPayment(payment: RefundPaymentSnapshot): void {
    this.payments.set(this.key(payment.userId, payment.paymentFlowId), payment);
  }

  async getPaymentSnapshot(userId: string, paymentFlowId: string): Promise<RefundPaymentSnapshot | null> {
    return this.payments.get(this.key(userId, paymentFlowId)) || null;
  }

  async detectCapturedButUnfulfilled(userId: string, limit: number): Promise<RefundCandidate[]> {
    const out: RefundCandidate[] = [];
    for (const payment of this.payments.values()) {
      if (payment.userId !== userId) continue;
      if (payment.status !== 'captured') continue;
      if (!payment.activationFailureDetected) continue;
      out.push({
        paymentFlowId: payment.paymentFlowId,
        userId,
        reason: payment.activationFailureReason || 'activation_not_verified',
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  async findRefundCaseByPayment(userId: string, paymentFlowId: string): Promise<RefundCase | null> {
    const id = this.caseByPayment.get(this.key(userId, paymentFlowId));
    if (!id) return null;
    return this.cases.get(id) || null;
  }

  async findRefundCaseById(userId: string, refundCaseId: string): Promise<RefundCase | null> {
    const found = this.cases.get(refundCaseId) || null;
    if (!found || found.userId !== userId) return null;
    return found;
  }

  async createOrGetRefundCase(input: {
    userId: string;
    payment: RefundPaymentSnapshot;
    idempotencyKey: string;
    activationFailureReason: string;
  }): Promise<RefundCase> {
    const existing = await this.findRefundCaseByPayment(input.userId, input.payment.paymentFlowId);
    if (existing) return existing;

    this.caseSeq += 1;
    const id = `rc_${this.caseSeq}`;
    const now = new Date().toISOString();

    const next: RefundCase = {
      id,
      userId: input.userId,
      paymentFlowId: input.payment.paymentFlowId,
      status: 'payment_captured',
      merchant: input.payment.merchant,
      amount: input.payment.amount,
      currency: input.payment.currency,
      activationFailureReason: input.activationFailureReason,
      initiateIdempotencyKey: input.idempotencyKey,
      merchantAdapterId: null,
      merchantReferenceId: null,
      processorReferenceId: null,
      disputeId: null,
      evidencePack: null,
      userExplanation: null,
      retryCount: 0,
      nextRetryAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    this.cases.set(id, next);
    this.caseByPayment.set(this.key(input.userId, input.payment.paymentFlowId), id);
    return next;
  }

  async updateRefundCase(
    userId: string,
    refundCaseId: string,
    patch: Partial<Pick<
      RefundCase,
      | 'status'
      | 'merchantAdapterId'
      | 'merchantReferenceId'
      | 'processorReferenceId'
      | 'disputeId'
      | 'evidencePack'
      | 'userExplanation'
      | 'retryCount'
      | 'nextRetryAt'
      | 'lastError'
    >>,
  ): Promise<RefundCase> {
    const current = await this.findRefundCaseById(userId, refundCaseId);
    if (!current) throw new Error(`Refund case not found: ${refundCaseId}`);
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.cases.set(next.id, next);
    return next;
  }

  async appendAudit(input: {
    refundCaseId: string;
    userId: string;
    paymentFlowId: string;
    fromState: RefundCase['status'] | null;
    toState: RefundCase['status'];
    action: string;
    message: string;
    details?: Record<string, unknown> | null;
    idempotencyKey?: string | null;
  }): Promise<RefundAuditLog> {
    if (input.idempotencyKey) {
      const existing = this.audits.find((audit) => (
        audit.refundCaseId === input.refundCaseId
        && audit.action === input.action
        && audit.idempotencyKey === input.idempotencyKey
      ));
      if (existing) return existing;
    }

    this.auditSeq += 1;
    const audit: RefundAuditLog = {
      id: `ra_${this.auditSeq}`,
      refundCaseId: input.refundCaseId,
      userId: input.userId,
      paymentFlowId: input.paymentFlowId,
      fromState: input.fromState,
      toState: input.toState,
      action: input.action,
      message: input.message,
      details: input.details || null,
      idempotencyKey: input.idempotencyKey || null,
      createdAt: new Date().toISOString(),
    };
    this.audits.push(audit);
    return audit;
  }

  async listAuditLogs(userId: string, refundCaseId: string): Promise<RefundAuditLog[]> {
    return this.audits.filter((audit) => audit.userId === userId && audit.refundCaseId === refundCaseId);
  }

  async listDueCases(userId: string, _nowIso: string, limit: number): Promise<RefundCase[]> {
    return [...this.cases.values()]
      .filter((refundCase) => refundCase.userId === userId)
      .slice(0, limit);
  }

  async markPaymentFlowRefunded(input: {
    userId: string;
    paymentFlowId: string;
    idempotencyKey: string;
    reason: string;
  }): Promise<void> {
    const payment = await this.getPaymentSnapshot(input.userId, input.paymentFlowId);
    if (!payment) return;
    this.seedPayment({
      ...payment,
      status: 'refunded',
      metadata: {
        ...(payment.metadata || {}),
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      },
    });
  }
}

function basePayment(overrides: Partial<RefundPaymentSnapshot> = {}): RefundPaymentSnapshot {
  return {
    paymentFlowId: 'flow_1',
    userId: 'user_1',
    merchant: 'Netflix',
    amount: 7.99,
    currency: 'usd',
    status: 'captured',
    stripePaymentIntentId: 'pi_1',
    metadata: null,
    capturedAt: '2026-03-10T18:00:00.000Z',
    activationFailureDetected: true,
    activationFailureReason: 'Activation check failed',
    activationFailureEvidence: { signal: 'entitlement_missing' },
    ...overrides,
  };
}

function refundAdapters() {
  const merchantAdapter: MerchantRefundAdapter = {
    id: 'merchant-refund',
    supports() {
      return true;
    },
    async requestRefund() {
      return {
        status: 'in_progress',
        referenceId: 'mref_1',
        message: 'Merchant refund pending',
      };
    },
  };

  const processorFallback: ProcessorFallbackAdapter = {
    id: 'processor-fallback',
    async submitDisputePacket() {
      return {
        submitted: true,
        referenceId: 'proc_1',
        disputeId: 'dp_1',
        message: 'submitted',
      };
    },
  };

  return { merchantAdapter, processorFallback };
}

test('duplicate refund button clicks are idempotent with same idempotency key', async () => {
  const store = new InMemoryRefundStore();
  store.seedPayment(basePayment());
  const { merchantAdapter, processorFallback } = refundAdapters();

  const engine = createRefundEngine({
    store,
    merchantAdapters: [merchantAdapter],
    processorFallback,
  });

  const first = await engine.initiateRefund({
    userId: 'user_1',
    paymentFlowId: 'flow_1',
    idempotencyKey: 'ui:request_refund:flow_1',
    allowWithoutActivationFailure: true,
  });

  const second = await engine.initiateRefund({
    userId: 'user_1',
    paymentFlowId: 'flow_1',
    idempotencyKey: 'ui:request_refund:flow_1',
    allowWithoutActivationFailure: true,
  });

  assert.equal(first.refundCase.id, second.refundCase.id);
  assert.equal(first.refundCase.status, 'refund_in_progress');
  assert.equal(second.refundCase.status, 'refund_in_progress');

  const allCases = [...store.cases.values()];
  assert.equal(allCases.length, 1);
});

test('refund initiation is blocked when activation failure was never detected', async () => {
  const store = new InMemoryRefundStore();
  store.seedPayment(basePayment({
    paymentFlowId: 'flow_2',
    activationFailureDetected: false,
    activationFailureReason: null,
    activationFailureEvidence: null,
  }));
  const { merchantAdapter, processorFallback } = refundAdapters();

  const engine = createRefundEngine({
    store,
    merchantAdapters: [merchantAdapter],
    processorFallback,
  });

  await assert.rejects(
    () => engine.initiateRefund({
      userId: 'user_1',
      paymentFlowId: 'flow_2',
      idempotencyKey: 'ui:request_refund:flow_2',
      allowWithoutActivationFailure: false,
    }),
    /activation failure not detected/i,
  );
});
