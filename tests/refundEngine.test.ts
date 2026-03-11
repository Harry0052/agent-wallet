import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRefundFailure,
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

  private caseIdSeq = 0;
  private auditIdSeq = 0;

  private paymentKey(userId: string, paymentFlowId: string): string {
    return `${userId}:${paymentFlowId}`;
  }

  seedPayment(input: RefundPaymentSnapshot): void {
    this.payments.set(this.paymentKey(input.userId, input.paymentFlowId), input);
  }

  async getPaymentSnapshot(userId: string, paymentFlowId: string): Promise<RefundPaymentSnapshot | null> {
    return this.payments.get(this.paymentKey(userId, paymentFlowId)) || null;
  }

  async detectCapturedButUnfulfilled(userId: string, limit: number): Promise<RefundCandidate[]> {
    const output: RefundCandidate[] = [];
    for (const payment of this.payments.values()) {
      if (payment.userId !== userId) continue;
      if (payment.status !== 'captured') continue;
      if (!payment.activationFailureDetected) continue;
      const existingCaseId = this.caseByPayment.get(this.paymentKey(userId, payment.paymentFlowId));
      if (existingCaseId) {
        const existing = this.cases.get(existingCaseId);
        if (existing && (existing.status === 'refund_completed' || existing.status === 'dispute_submitted')) {
          continue;
        }
      }
      output.push({
        paymentFlowId: payment.paymentFlowId,
        userId,
        reason: payment.activationFailureReason || 'Activation failed after payment capture',
      });
      if (output.length >= limit) break;
    }
    return output;
  }

  async findRefundCaseByPayment(userId: string, paymentFlowId: string): Promise<RefundCase | null> {
    const id = this.caseByPayment.get(this.paymentKey(userId, paymentFlowId));
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

    this.caseIdSeq += 1;
    const id = `rc_${this.caseIdSeq}`;
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
    this.caseByPayment.set(this.paymentKey(input.userId, input.payment.paymentFlowId), id);
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
    const next: RefundCase = {
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
      const existing = this.audits.find((log) => (
        log.refundCaseId === input.refundCaseId
        && log.action === input.action
        && log.idempotencyKey === input.idempotencyKey
      ));
      if (existing) return existing;
    }

    this.auditIdSeq += 1;
    const audit: RefundAuditLog = {
      id: `ra_${this.auditIdSeq}`,
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
    return this.audits.filter((log) => log.userId === userId && log.refundCaseId === refundCaseId);
  }

  async listDueCases(userId: string, nowIso: string, limit: number): Promise<RefundCase[]> {
    const now = Date.parse(nowIso);
    return [...this.cases.values()]
      .filter((refundCase) => (
        refundCase.userId === userId
        && ['refund_requested', 'refund_in_progress', 'dispute_prepared'].includes(refundCase.status)
        && Date.parse(refundCase.nextRetryAt) <= now
      ))
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
    paymentFlowId: 'pay_1',
    userId: 'user_1',
    merchant: 'Netflix',
    amount: 7.99,
    currency: 'usd',
    status: 'captured',
    stripePaymentIntentId: 'pi_1',
    metadata: null,
    capturedAt: '2026-03-10T18:00:00.000Z',
    activationFailureDetected: true,
    activationFailureReason: 'No subscription entitlement found',
    activationFailureEvidence: { signal: 'activation_timeout' },
    ...overrides,
  };
}

test('uses merchant refund path first and completes refund when supported', async () => {
  const store = new InMemoryRefundStore();
  store.seedPayment(basePayment());

  const merchantAdapter: MerchantRefundAdapter = {
    id: 'merchant-success',
    supports() {
      return true;
    },
    async requestRefund() {
      return {
        status: 'completed',
        referenceId: 'mref_1',
        message: 'Merchant refund completed',
      };
    },
  };

  const processorFallback: ProcessorFallbackAdapter = {
    id: 'processor',
    async submitDisputePacket() {
      return {
        submitted: true,
        referenceId: 'proc_1',
        disputeId: 'dp_1',
        message: 'submitted',
      };
    },
  };

  const engine = createRefundEngine({
    store,
    merchantAdapters: [merchantAdapter],
    processorFallback,
  });

  const result = await engine.initiateRefund({
    userId: 'user_1',
    paymentFlowId: 'pay_1',
    idempotencyKey: 'init_1',
  });

  assert.equal(result.refundCase.status, 'refund_completed');
  assert.equal(result.refundCase.merchantReferenceId, 'mref_1');
  assert.match(result.userExplanation, /refund of 7.99 USD has been completed/i);
  const payment = await store.getPaymentSnapshot('user_1', 'pay_1');
  assert.equal(payment?.status, 'refunded');
});

test('falls back to processor dispute packet when merchant path is unavailable', async () => {
  const store = new InMemoryRefundStore();
  store.seedPayment(basePayment({ paymentFlowId: 'pay_2' }));

  const merchantAdapter: MerchantRefundAdapter = {
    id: 'merchant-unavailable',
    supports() {
      return false;
    },
    async requestRefund() {
      return {
        status: 'unavailable',
        message: 'n/a',
      };
    },
  };

  let processorCalls = 0;
  const processorFallback: ProcessorFallbackAdapter = {
    id: 'processor',
    async submitDisputePacket() {
      processorCalls += 1;
      return {
        submitted: true,
        referenceId: 'proc_ref_2',
        disputeId: 'dp_2',
        message: 'Processor packet submitted',
      };
    },
  };

  const engine = createRefundEngine({
    store,
    merchantAdapters: [merchantAdapter],
    processorFallback,
  });

  const result = await engine.initiateRefund({
    userId: 'user_1',
    paymentFlowId: 'pay_2',
    idempotencyKey: 'init_2',
  });

  assert.equal(result.refundCase.status, 'dispute_submitted');
  assert.equal(result.refundCase.disputeId, 'dp_2');
  assert.equal(processorCalls, 1);
  assert.ok(result.refundCase.evidencePack);
});

test('is idempotent for repeated initiate requests with same idempotency key', async () => {
  const store = new InMemoryRefundStore();
  store.seedPayment(basePayment({ paymentFlowId: 'pay_3' }));

  const merchantAdapter: MerchantRefundAdapter = {
    id: 'merchant-pending',
    supports() {
      return true;
    },
    async requestRefund() {
      return {
        status: 'in_progress',
        referenceId: 'mref_pending',
        message: 'Pending merchant confirmation',
      };
    },
  };

  const processorFallback: ProcessorFallbackAdapter = {
    id: 'processor',
    async submitDisputePacket() {
      return {
        submitted: true,
        referenceId: 'proc_3',
        disputeId: 'dp_3',
        message: 'submitted',
      };
    },
  };

  const engine = createRefundEngine({
    store,
    merchantAdapters: [merchantAdapter],
    processorFallback,
  });

  const first = await engine.initiateRefund({
    userId: 'user_1',
    paymentFlowId: 'pay_3',
    idempotencyKey: 'idem_3',
  });
  const second = await engine.initiateRefund({
    userId: 'user_1',
    paymentFlowId: 'pay_3',
    idempotencyKey: 'idem_3',
  });

  assert.equal(first.refundCase.id, second.refundCase.id);
  const initiateAudits = first.auditLogs.filter((log) => log.action === 'refund_initiated');
  assert.equal(initiateAudits.length, 1);
});

test('scheduler detects captured-but-unfulfilled payments and initiates orchestration', async () => {
  const store = new InMemoryRefundStore();
  store.seedPayment(basePayment({ paymentFlowId: 'pay_4' }));

  const merchantAdapter: MerchantRefundAdapter = {
    id: 'merchant-success',
    supports() {
      return true;
    },
    async requestRefund() {
      return {
        status: 'completed',
        referenceId: 'mref_4',
        message: 'done',
      };
    },
  };

  const processorFallback: ProcessorFallbackAdapter = {
    id: 'processor',
    async submitDisputePacket() {
      return {
        submitted: true,
        referenceId: 'proc_4',
        disputeId: 'dp_4',
        message: 'submitted',
      };
    },
  };

  const engine = createRefundEngine({
    store,
    merchantAdapters: [merchantAdapter],
    processorFallback,
  });

  const schedulerResult = await engine.runScheduler({ userId: 'user_1', limit: 10 });
  assert.equal(schedulerResult.detected, 1);
  assert.equal(schedulerResult.initiated, 1);
});

test('classifies retryable and unavailable failures correctly', () => {
  const retryable = classifyRefundFailure(new Error('Network timeout from merchant API'));
  assert.equal(retryable.class, 'retryable');

  const unavailable = classifyRefundFailure(new Error('Merchant endpoint unsupported for refunds'));
  assert.equal(unavailable.class, 'unavailable');

  const permanent = classifyRefundFailure(new Error('Invalid refund credentials'));
  assert.equal(permanent.class, 'permanent');
});
