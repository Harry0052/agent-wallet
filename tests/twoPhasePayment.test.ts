import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PaymentFlow,
  PaymentFundingMode,
  PaymentLedgerEvent,
  PaymentLedgerEventType,
  PaymentRetryJob,
  PaymentRetryOperation,
  TwoPhaseStore,
} from '../lib/payments/twoPhasePayment.ts';
import { createTwoPhasePaymentEngine } from '../lib/payments/twoPhasePayment.ts';

class InMemoryStore implements TwoPhaseStore {
  flows = new Map<string, PaymentFlow>();
  authorizeKeyToFlowId = new Map<string, string>();
  events: PaymentLedgerEvent[] = [];
  retries = new Map<string, PaymentRetryJob>();

  private makeAuthorizeMapKey(userId: string, key: string): string {
    return `${userId}:${key}`;
  }

  private makeOperationKey(flowId: string, eventType: PaymentLedgerEventType, idempotencyKey: string | null | undefined): string {
    return `${flowId}:${eventType}:${idempotencyKey || ''}`;
  }

  forceRetriesDue(): void {
    for (const retry of this.retries.values()) {
      retry.nextRetryAt = new Date(Date.now() - 1000).toISOString();
      retry.status = 'pending';
    }
  }

  async findByAuthorizeIdempotency(userId: string, idempotencyKey: string): Promise<PaymentFlow | null> {
    const id = this.authorizeKeyToFlowId.get(this.makeAuthorizeMapKey(userId, idempotencyKey));
    if (!id) return null;
    return this.flows.get(id) || null;
  }

  async findById(userId: string, paymentId: string): Promise<PaymentFlow | null> {
    const flow = this.flows.get(paymentId) || null;
    if (!flow) return null;
    if (flow.userId !== userId) return null;
    return flow;
  }

  async findByStripePaymentIntentId(stripePaymentIntentId: string): Promise<PaymentFlow | null> {
    for (const flow of this.flows.values()) {
      if (flow.stripePaymentIntentId === stripePaymentIntentId) return flow;
    }
    return null;
  }

  async createFlow(input: {
    id?: string;
    userId: string;
    taskId?: string | null;
    merchant: string;
    amount: number;
    currency: string;
    fundingMode: PaymentFundingMode;
    status: PaymentFlow['status'];
    stripePaymentIntentId?: string | null;
    requiresActivationVerification: boolean;
    idempotencyAuthorizeKey: string;
    metadata?: Record<string, unknown> | null;
    authorizedAt?: string | null;
  }): Promise<PaymentFlow> {
    const existing = await this.findByAuthorizeIdempotency(input.userId, input.idempotencyAuthorizeKey);
    if (existing) return existing;

    const now = new Date().toISOString();
    const flow: PaymentFlow = {
      id: input.id || `flow_${this.flows.size + 1}`,
      userId: input.userId,
      taskId: input.taskId || null,
      merchant: input.merchant,
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      fundingMode: input.fundingMode,
      status: input.status,
      stripePaymentIntentId: input.stripePaymentIntentId || null,
      requiresActivationVerification: input.requiresActivationVerification,
      idempotencyAuthorizeKey: input.idempotencyAuthorizeKey,
      idempotencyCaptureKey: null,
      idempotencyVoidKey: null,
      metadata: input.metadata || null,
      activationVerifiedAt: null,
      authorizedAt: input.authorizedAt || null,
      capturedAt: null,
      refundedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.flows.set(flow.id, flow);
    this.authorizeKeyToFlowId.set(this.makeAuthorizeMapKey(flow.userId, flow.idempotencyAuthorizeKey), flow.id);
    return flow;
  }

  async updateFlow(
    userId: string,
    paymentId: string,
    patch: Partial<Pick<PaymentFlow, 'status' | 'stripePaymentIntentId' | 'activationVerifiedAt' | 'authorizedAt' | 'capturedAt' | 'refundedAt' | 'metadata' | 'idempotencyCaptureKey' | 'idempotencyVoidKey'>>,
  ): Promise<PaymentFlow> {
    const flow = await this.findById(userId, paymentId);
    if (!flow) throw new Error(`Payment flow not found: ${paymentId}`);
    const next: PaymentFlow = {
      ...flow,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.flows.set(next.id, next);
    return next;
  }

  async appendEvent(input: {
    paymentFlowId: string;
    userId: string;
    eventType: PaymentLedgerEventType;
    amount: number;
    currency: string;
    idempotencyKey?: string | null;
    reason?: string | null;
    details?: Record<string, unknown> | null;
  }): Promise<PaymentLedgerEvent> {
    if (input.idempotencyKey) {
      const existing = this.events.find((event) => (
        this.makeOperationKey(event.paymentFlowId, event.eventType, event.idempotencyKey)
        === this.makeOperationKey(input.paymentFlowId, input.eventType, input.idempotencyKey || null)
      ));
      if (existing) return existing;
    }

    const event: PaymentLedgerEvent = {
      id: `evt_${this.events.length + 1}`,
      paymentFlowId: input.paymentFlowId,
      userId: input.userId,
      eventType: input.eventType,
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      idempotencyKey: input.idempotencyKey || null,
      reason: input.reason || null,
      details: input.details || null,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async claimOperationIdempotency(input: {
    userId: string;
    paymentId: string;
    operation: PaymentRetryOperation;
    idempotencyKey: string;
  }): Promise<'claimed' | 'replay' | 'conflict'> {
    const flow = await this.findById(input.userId, input.paymentId);
    if (!flow) throw new Error(`Payment flow not found: ${input.paymentId}`);
    if (input.operation === 'capture') {
      if (!flow.idempotencyCaptureKey) {
        flow.idempotencyCaptureKey = input.idempotencyKey;
        return 'claimed';
      }
      return flow.idempotencyCaptureKey === input.idempotencyKey ? 'replay' : 'conflict';
    }

    if (!flow.idempotencyVoidKey) {
      flow.idempotencyVoidKey = input.idempotencyKey;
      return 'claimed';
    }
    return flow.idempotencyVoidKey === input.idempotencyKey ? 'replay' : 'conflict';
  }

  async createRetryJob(input: {
    paymentFlowId: string;
    userId: string;
    operation: PaymentRetryOperation;
    attempt: number;
    maxAttempts: number;
    nextRetryAt: string;
    idempotencyKey: string;
    lastError?: string | null;
  }): Promise<PaymentRetryJob> {
    const job: PaymentRetryJob = {
      id: `retry_${this.retries.size + 1}`,
      paymentFlowId: input.paymentFlowId,
      userId: input.userId,
      operation: input.operation,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      nextRetryAt: input.nextRetryAt,
      status: 'pending',
      idempotencyKey: input.idempotencyKey,
      lastError: input.lastError || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.retries.set(job.id, job);
    return job;
  }

  async listDueRetryJobs(nowIso: string, limit: number): Promise<PaymentRetryJob[]> {
    const now = Date.parse(nowIso);
    return [...this.retries.values()]
      .filter((job) => job.status === 'pending' && Date.parse(job.nextRetryAt) <= now)
      .slice(0, limit);
  }

  async markRetryJob(
    retryJobId: string,
    patch: Partial<Pick<PaymentRetryJob, 'status' | 'attempt' | 'nextRetryAt' | 'lastError'>>,
  ): Promise<void> {
    const job = this.retries.get(retryJobId);
    if (!job) return;
    if (patch.status) job.status = patch.status;
    if (typeof patch.attempt === 'number') job.attempt = patch.attempt;
    if (patch.nextRetryAt) job.nextRetryAt = patch.nextRetryAt;
    if (patch.lastError !== undefined) job.lastError = patch.lastError;
    job.updatedAt = new Date().toISOString();
  }
}

class InMemoryGateway {
  authorizeCalls = 0;
  captureCalls = 0;
  voidCalls = 0;
  prepaidCaptureCalls = 0;
  prepaidReleaseCalls = 0;
  failAuthorize = false;
  failCaptureRetryable = false;

  async authorizeStripe(input: { paymentId: string }): Promise<{ paymentIntentId: string; status: string }> {
    this.authorizeCalls += 1;
    if (this.failAuthorize) throw new Error('network timeout while authorizing');
    return {
      paymentIntentId: `pi_${input.paymentId}`,
      status: 'requires_capture',
    };
  }

  async captureStripe(): Promise<{ paymentIntentId: string; status: string; capturedAmount: number }> {
    this.captureCalls += 1;
    if (this.failCaptureRetryable) {
      this.failCaptureRetryable = false;
      throw new Error('api connection timeout');
    }
    return {
      paymentIntentId: 'pi_captured',
      status: 'succeeded',
      capturedAmount: 7.99,
    };
  }

  async voidOrRefundStripe(): Promise<{ status: 'voided'; externalId: string }> {
    this.voidCalls += 1;
    return { status: 'voided', externalId: 'pi_voided' };
  }

  async captureReservedBalance(): Promise<void> {
    this.prepaidCaptureCalls += 1;
  }

  async releaseReservedBalance(): Promise<void> {
    this.prepaidReleaseCalls += 1;
  }
}

test('authorize stripe flow and emit activation_pending', async () => {
  const store = new InMemoryStore();
  const gateway = new InMemoryGateway();
  const engine = createTwoPhasePaymentEngine({ store, gateway });

  const result = await engine.authorize({
    userId: 'u1',
    merchant: 'Netflix',
    amount: 7.99,
    currency: 'usd',
    idempotencyKey: 'auth-1',
  });

  assert.equal(result.idempotentReplay, false);
  assert.equal(result.payment.fundingMode, 'STRIPE_AUTH_CAPTURE');
  assert.equal(result.payment.status, 'activation_pending');
  assert.equal(gateway.authorizeCalls, 1);
  assert.ok(store.events.some((event) => event.eventType === 'authorized'));
  assert.ok(store.events.some((event) => event.eventType === 'activation_pending'));
});

test('authorize is idempotent by key', async () => {
  const store = new InMemoryStore();
  const gateway = new InMemoryGateway();
  const engine = createTwoPhasePaymentEngine({ store, gateway });

  const first = await engine.authorize({
    userId: 'u1',
    merchant: 'Netflix',
    amount: 7.99,
    currency: 'usd',
    idempotencyKey: 'auth-dup',
  });
  const second = await engine.authorize({
    userId: 'u1',
    merchant: 'Netflix',
    amount: 7.99,
    currency: 'usd',
    idempotencyKey: 'auth-dup',
  });

  assert.equal(first.payment.id, second.payment.id);
  assert.equal(second.idempotentReplay, true);
  assert.equal(gateway.authorizeCalls, 1);
});

test('capture succeeds only after activation verified', async () => {
  const store = new InMemoryStore();
  const gateway = new InMemoryGateway();
  const engine = createTwoPhasePaymentEngine({ store, gateway });

  const auth = await engine.authorize({
    userId: 'u1',
    merchant: 'Hulu',
    amount: 8.99,
    currency: 'usd',
    idempotencyKey: 'auth-capture',
  });

  const capture = await engine.capture({
    userId: 'u1',
    paymentId: auth.payment.id,
    idempotencyKey: 'cap-1',
    activationVerified: true,
  });

  assert.equal(capture.payment.status, 'captured');
  assert.equal(gateway.captureCalls, 1);
  assert.ok(store.events.some((event) => event.eventType === 'activated'));
  assert.ok(store.events.some((event) => event.eventType === 'captured'));
});

test('activation failure triggers void/refund path', async () => {
  const store = new InMemoryStore();
  const gateway = new InMemoryGateway();
  const engine = createTwoPhasePaymentEngine({ store, gateway });

  const auth = await engine.authorize({
    userId: 'u1',
    merchant: 'Disney Plus',
    amount: 13.99,
    currency: 'usd',
    idempotencyKey: 'auth-fail',
  });

  const result = await engine.capture({
    userId: 'u1',
    paymentId: auth.payment.id,
    idempotencyKey: 'cap-fail',
    activationVerified: false,
    activationFailureReason: 'No tool credentials provisioned',
  });

  assert.equal(result.payment.status, 'refunded');
  assert.equal(gateway.voidCalls, 1);
  assert.ok(store.events.some((event) => event.eventType === 'activation_failed'));
  assert.ok(store.events.some((event) => event.eventType === 'refund_pending'));
  assert.ok(store.events.some((event) => event.eventType === 'refunded'));
});

test('retry logic captures on second attempt after transient failure', async () => {
  const store = new InMemoryStore();
  const gateway = new InMemoryGateway();
  gateway.failCaptureRetryable = true;
  const engine = createTwoPhasePaymentEngine({ store, gateway });

  const auth = await engine.authorize({
    userId: 'u1',
    merchant: 'Canva',
    amount: 12.0,
    currency: 'usd',
    idempotencyKey: 'auth-retry',
  });

  const firstCapture = await engine.capture({
    userId: 'u1',
    paymentId: auth.payment.id,
    idempotencyKey: 'cap-retry',
    activationVerified: true,
  });

  assert.equal(firstCapture.retryScheduled, true);
  assert.equal(firstCapture.payment.status, 'activated');

  store.forceRetriesDue();
  const retryRun = await engine.processDueRetries();

  assert.equal(retryRun.processed, 1);
  const updated = await store.findById('u1', auth.payment.id);
  assert.equal(updated?.status, 'captured');
  assert.equal(gateway.captureCalls >= 2, true);
});

test('fallback to prepaid reservation when stripe auth fails and fallback enabled', async () => {
  const store = new InMemoryStore();
  const gateway = new InMemoryGateway();
  gateway.failAuthorize = true;
  const engine = createTwoPhasePaymentEngine({ store, gateway });

  const result = await engine.authorize({
    userId: 'u1',
    merchant: 'Unknown Streaming',
    amount: 5.5,
    currency: 'usd',
    idempotencyKey: 'auth-prepaid',
    allowPrepaidFallback: true,
    prepaidAvailableBalance: 10,
  });

  assert.equal(result.payment.fundingMode, 'PREPAID_BALANCE');
  assert.equal(result.payment.status, 'activation_pending');
  assert.ok(store.events.some((event) => event.eventType === 'reserved'));
});
