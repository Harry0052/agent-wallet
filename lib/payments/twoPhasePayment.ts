import { randomUUID } from 'node:crypto';

export type PaymentFundingMode = 'STRIPE_AUTH_CAPTURE' | 'PREPAID_BALANCE';
export type PaymentFlowStatus =
  | 'authorization_pending'
  | 'activation_pending'
  | 'activated'
  | 'activation_failed'
  | 'capture_pending'
  | 'captured'
  | 'refund_pending'
  | 'refunded'
  | 'failed';

export type PaymentLedgerEventType =
  | 'reserved'
  | 'authorized'
  | 'captured'
  | 'activation_pending'
  | 'activated'
  | 'activation_failed'
  | 'refund_pending'
  | 'refunded';

export type PaymentRetryOperation = 'capture' | 'void';

export interface PaymentFlow {
  id: string;
  userId: string;
  taskId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  fundingMode: PaymentFundingMode;
  status: PaymentFlowStatus;
  stripePaymentIntentId: string | null;
  requiresActivationVerification: boolean;
  idempotencyAuthorizeKey: string;
  idempotencyCaptureKey: string | null;
  idempotencyVoidKey: string | null;
  metadata: Record<string, unknown> | null;
  activationVerifiedAt: string | null;
  authorizedAt: string | null;
  capturedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentLedgerEvent {
  id: string;
  paymentFlowId: string;
  userId: string;
  eventType: PaymentLedgerEventType;
  amount: number;
  currency: string;
  idempotencyKey: string | null;
  reason: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface PaymentRetryJob {
  id: string;
  paymentFlowId: string;
  userId: string;
  operation: PaymentRetryOperation;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  idempotencyKey: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TwoPhaseStore {
  findByAuthorizeIdempotency(userId: string, idempotencyKey: string): Promise<PaymentFlow | null>;
  findById(userId: string, paymentId: string): Promise<PaymentFlow | null>;
  findByStripePaymentIntentId(stripePaymentIntentId: string): Promise<PaymentFlow | null>;
  createFlow(input: {
    id?: string;
    userId: string;
    taskId?: string | null;
    merchant: string;
    amount: number;
    currency: string;
    fundingMode: PaymentFundingMode;
    status: PaymentFlowStatus;
    stripePaymentIntentId?: string | null;
    requiresActivationVerification: boolean;
    idempotencyAuthorizeKey: string;
    metadata?: Record<string, unknown> | null;
    authorizedAt?: string | null;
  }): Promise<PaymentFlow>;
  updateFlow(
    userId: string,
    paymentId: string,
    patch: Partial<Pick<
      PaymentFlow,
      | 'status'
      | 'stripePaymentIntentId'
      | 'activationVerifiedAt'
      | 'authorizedAt'
      | 'capturedAt'
      | 'refundedAt'
      | 'metadata'
      | 'idempotencyCaptureKey'
      | 'idempotencyVoidKey'
    >>,
  ): Promise<PaymentFlow>;
  appendEvent(input: {
    paymentFlowId: string;
    userId: string;
    eventType: PaymentLedgerEventType;
    amount: number;
    currency: string;
    idempotencyKey?: string | null;
    reason?: string | null;
    details?: Record<string, unknown> | null;
  }): Promise<PaymentLedgerEvent>;
  claimOperationIdempotency(input: {
    userId: string;
    paymentId: string;
    operation: PaymentRetryOperation;
    idempotencyKey: string;
  }): Promise<'claimed' | 'replay' | 'conflict'>;
  createRetryJob(input: {
    paymentFlowId: string;
    userId: string;
    operation: PaymentRetryOperation;
    attempt: number;
    maxAttempts: number;
    nextRetryAt: string;
    idempotencyKey: string;
    lastError?: string | null;
  }): Promise<PaymentRetryJob>;
  listDueRetryJobs(nowIso: string, limit: number): Promise<PaymentRetryJob[]>;
  markRetryJob(
    retryJobId: string,
    patch: Partial<Pick<PaymentRetryJob, 'status' | 'attempt' | 'nextRetryAt' | 'lastError'>>,
  ): Promise<void>;
}

export interface StripeAuthorizationResult {
  paymentIntentId: string;
  status: string;
}

export interface StripeCaptureResult {
  paymentIntentId: string;
  status: string;
  capturedAmount?: number;
}

export interface StripeVoidOrRefundResult {
  status: 'voided' | 'refunded' | 'noop';
  externalId?: string;
}

export interface TwoPhaseGateway {
  authorizeStripe(input: {
    userId: string;
    paymentId: string;
    merchant: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    preferredPaymentMethodId?: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<StripeAuthorizationResult>;
  captureStripe(input: {
    userId: string;
    paymentId: string;
    stripePaymentIntentId: string;
    idempotencyKey: string;
  }): Promise<StripeCaptureResult>;
  voidOrRefundStripe(input: {
    userId: string;
    paymentId: string;
    stripePaymentIntentId: string;
    idempotencyKey: string;
    reason: string;
  }): Promise<StripeVoidOrRefundResult>;
  captureReservedBalance(input: {
    userId: string;
    paymentId: string;
    merchant: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<void>;
  releaseReservedBalance(input: {
    userId: string;
    paymentId: string;
    merchant: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    reason: string;
  }): Promise<void>;
}

export interface StripeLike {
  paymentIntents: {
    create(input: any, opts?: any): Promise<{
      id: string;
      status: string;
    }>;
    capture(id: string, input?: any, opts?: any): Promise<{
      id: string;
      status: string;
      amount_received?: number | null;
      amount?: number | null;
    }>;
    cancel(id: string, input?: any, opts?: any): Promise<{
      id: string;
      status: string;
    }>;
    retrieve(id: string): Promise<{
      id: string;
      status: string;
      amount_received?: number | null;
      amount?: number | null;
    }>;
  };
  refunds: {
    create(input: any, opts?: any): Promise<{ id: string }>;
  };
}

export function createStripeFirstGateway(params: {
  stripe: StripeLike;
  resolvePaymentMethod: (input: {
    userId: string;
    preferredPaymentMethodId?: string;
  }) => Promise<{ customerId: string; paymentMethodId: string }>;
  captureReservedBalance: TwoPhaseGateway['captureReservedBalance'];
  releaseReservedBalance: TwoPhaseGateway['releaseReservedBalance'];
}): TwoPhaseGateway {
  return {
    async authorizeStripe(input) {
      const paymentMethod = await params.resolvePaymentMethod({
        userId: input.userId,
        preferredPaymentMethodId: input.preferredPaymentMethodId,
      });

      const intent = await params.stripe.paymentIntents.create({
        amount: Math.round(input.amount * 100),
        currency: input.currency.toLowerCase(),
        customer: paymentMethod.customerId,
        payment_method: paymentMethod.paymentMethodId,
        capture_method: 'manual',
        confirm: true,
        off_session: true,
        metadata: {
          wallet_action: 'two_phase_payment_authorize',
          wallet_user_id: input.userId,
          payment_flow_id: input.paymentId,
          merchant: input.merchant,
          ...(input.metadata || {}),
        },
      }, {
        idempotencyKey: input.idempotencyKey,
      });

      return {
        paymentIntentId: intent.id,
        status: intent.status,
      };
    },

    async captureStripe(input) {
      const capture = await params.stripe.paymentIntents.capture(
        input.stripePaymentIntentId,
        {
          metadata: {
            wallet_action: 'two_phase_payment_capture',
            payment_flow_id: input.paymentId,
          },
        },
        {
          idempotencyKey: input.idempotencyKey,
        },
      );

      const amountCents = capture.amount_received ?? capture.amount ?? 0;
      return {
        paymentIntentId: capture.id,
        status: capture.status,
        capturedAmount: amountCents / 100,
      };
    },

    async voidOrRefundStripe(input) {
      const intent = await params.stripe.paymentIntents.retrieve(input.stripePaymentIntentId);

      if (intent.status === 'requires_capture') {
        const canceled = await params.stripe.paymentIntents.cancel(
          input.stripePaymentIntentId,
          {
            cancellation_reason: 'requested_by_customer',
          },
          { idempotencyKey: input.idempotencyKey },
        );
        return {
          status: canceled.status === 'canceled' ? 'voided' : 'noop',
          externalId: canceled.id,
        };
      }

      if (intent.status === 'succeeded') {
        const refund = await params.stripe.refunds.create({
          payment_intent: input.stripePaymentIntentId,
          reason: 'requested_by_customer',
          metadata: {
            wallet_action: 'two_phase_payment_refund',
            payment_flow_id: input.paymentId,
            reason: input.reason,
          },
        }, {
          idempotencyKey: input.idempotencyKey,
        });

        return {
          status: 'refunded',
          externalId: refund.id,
        };
      }

      return {
        status: 'noop',
        externalId: intent.id,
      };
    },

    captureReservedBalance: params.captureReservedBalance,
    releaseReservedBalance: params.releaseReservedBalance,
  };
}

export interface TwoPhaseLogger {
  info(event: string, data: Record<string, unknown>): void;
  warn(event: string, data: Record<string, unknown>): void;
  error(event: string, data: Record<string, unknown>): void;
}

export interface AuthorizeTwoPhaseInput {
  userId: string;
  taskId?: string | null;
  merchant: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  fundingMode?: PaymentFundingMode;
  allowPrepaidFallback?: boolean;
  prepaidAvailableBalance?: number;
  requiresActivationVerification?: boolean;
  preferredPaymentMethodId?: string;
  metadata?: Record<string, unknown> | null;
}

export interface CaptureTwoPhaseInput {
  userId: string;
  paymentId: string;
  idempotencyKey: string;
  activationVerified: boolean;
  activationEvidence?: Record<string, unknown> | null;
  activationFailureReason?: string;
  prepaidAvailableBalance?: number;
}

export interface VoidTwoPhaseInput {
  userId: string;
  paymentId: string;
  idempotencyKey: string;
  reason: string;
}

export interface TwoPhaseResult {
  payment: PaymentFlow;
  idempotentReplay: boolean;
  retryScheduled?: boolean;
  nextRetryAt?: string;
}

const DEFAULT_MAX_RETRIES = 5;

function nowIso(): string {
  return new Date().toISOString();
}

function toLowerCurrency(input: string): string {
  return input.trim().toLowerCase();
}

export function isRetryableFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('timeout')
    || msg.includes('temporarily unavailable')
    || msg.includes('rate limit')
    || msg.includes('network')
    || msg.includes('connection')
    || msg.includes('api')
  );
}

export function computeRetryDelayMs(attempt: number): number {
  const boundedAttempt = Math.max(1, attempt);
  const delay = 1_000 * (2 ** (boundedAttempt - 1));
  return Math.min(delay, 5 * 60_000);
}

function addDelay(baseIso: string, delayMs: number): string {
  return new Date(new Date(baseIso).getTime() + delayMs).toISOString();
}

function assertPositiveAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }
}

function assertIdempotencyKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new Error('idempotencyKey is required');
  return normalized;
}

function enrichMetadata(
  base: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(base || {}),
    ...patch,
  };
}

export function createTwoPhasePaymentEngine(params: {
  store: TwoPhaseStore;
  gateway: TwoPhaseGateway;
  logger?: TwoPhaseLogger;
  maxRetries?: number;
}) {
  const store = params.store;
  const gateway = params.gateway;
  const logger = params.logger || {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function scheduleRetry(input: {
    payment: PaymentFlow;
    operation: PaymentRetryOperation;
    attempt: number;
    idempotencyKey: string;
    error: Error;
  }): Promise<{ nextRetryAt: string; exhausted: boolean }> {
    if (input.attempt >= maxRetries) {
      await store.createRetryJob({
        paymentFlowId: input.payment.id,
        userId: input.payment.userId,
        operation: input.operation,
        attempt: input.attempt,
        maxAttempts: maxRetries,
        nextRetryAt: nowIso(),
        idempotencyKey: input.idempotencyKey,
        lastError: input.error.message,
      });
      return { nextRetryAt: nowIso(), exhausted: true };
    }

    const nextRetryAt = addDelay(nowIso(), computeRetryDelayMs(input.attempt));
    await store.createRetryJob({
      paymentFlowId: input.payment.id,
      userId: input.payment.userId,
      operation: input.operation,
      attempt: input.attempt,
      maxAttempts: maxRetries,
      nextRetryAt,
      idempotencyKey: input.idempotencyKey,
      lastError: input.error.message,
    });
    return { nextRetryAt, exhausted: false };
  }

  async function voidInternal(input: VoidTwoPhaseInput, fromCaptureFail = false): Promise<TwoPhaseResult> {
    const key = assertIdempotencyKey(input.idempotencyKey);
    const payment = await store.findById(input.userId, input.paymentId);
    if (!payment) throw new Error(`Payment flow not found: ${input.paymentId}`);

    if (payment.status === 'refunded') {
      return { payment, idempotentReplay: true };
    }

    const idempotency = await store.claimOperationIdempotency({
      userId: input.userId,
      paymentId: input.paymentId,
      operation: 'void',
      idempotencyKey: key,
    });

    if (idempotency === 'conflict') {
      throw new Error('IDEMPOTENCY_CONFLICT: void already claimed with a different key');
    }
    if (idempotency === 'replay') {
      const replay = await store.findById(input.userId, input.paymentId);
      if (!replay) throw new Error(`Payment flow not found: ${input.paymentId}`);
      return { payment: replay, idempotentReplay: true };
    }

    await store.appendEvent({
      paymentFlowId: payment.id,
      userId: payment.userId,
      eventType: 'refund_pending',
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey: key,
      reason: input.reason,
      details: { fromCaptureFail },
    });

    await store.updateFlow(payment.userId, payment.id, { status: 'refund_pending' });

    try {
      if (payment.fundingMode === 'STRIPE_AUTH_CAPTURE' && payment.stripePaymentIntentId) {
        await gateway.voidOrRefundStripe({
          userId: payment.userId,
          paymentId: payment.id,
          stripePaymentIntentId: payment.stripePaymentIntentId,
          idempotencyKey: key,
          reason: input.reason,
        });
      } else {
        await gateway.releaseReservedBalance({
          userId: payment.userId,
          paymentId: payment.id,
          merchant: payment.merchant,
          amount: payment.amount,
          currency: payment.currency,
          idempotencyKey: key,
          reason: input.reason,
        });
      }
    } catch (error) {
      if (isRetryableFailure(error)) {
        const retryError = error instanceof Error ? error : new Error(String(error));
        const { nextRetryAt } = await scheduleRetry({
          payment,
          operation: 'void',
          attempt: 1,
          idempotencyKey: key,
          error: retryError,
        });
        logger.warn('payments.void.retry_scheduled', {
          paymentId: payment.id,
          nextRetryAt,
          reason: retryError.message,
        });
        const fresh = await store.findById(payment.userId, payment.id);
        if (!fresh) throw new Error(`Payment flow not found: ${payment.id}`);
        return { payment: fresh, idempotentReplay: false, retryScheduled: true, nextRetryAt };
      }
      throw error;
    }

    await store.appendEvent({
      paymentFlowId: payment.id,
      userId: payment.userId,
      eventType: 'refunded',
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey: key,
      reason: input.reason,
      details: { fromCaptureFail },
    });

    const updated = await store.updateFlow(payment.userId, payment.id, {
      status: 'refunded',
      refundedAt: nowIso(),
    });

    return { payment: updated, idempotentReplay: false };
  }

  async function authorize(input: AuthorizeTwoPhaseInput): Promise<TwoPhaseResult> {
    assertPositiveAmount(input.amount);
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const existing = await store.findByAuthorizeIdempotency(input.userId, idempotencyKey);
    if (existing) {
      return { payment: existing, idempotentReplay: true };
    }

    const merchant = input.merchant.trim();
    if (!merchant) throw new Error('merchant is required');

    const paymentId = randomUUID();
    const normalizedCurrency = toLowerCurrency(input.currency || 'usd');

    let selectedFundingMode: PaymentFundingMode = input.fundingMode || 'STRIPE_AUTH_CAPTURE';
    let stripePaymentIntentId: string | null = null;

    if (selectedFundingMode === 'STRIPE_AUTH_CAPTURE') {
      try {
        const stripeAuth = await gateway.authorizeStripe({
          userId: input.userId,
          paymentId,
          merchant,
          amount: input.amount,
          currency: normalizedCurrency,
          idempotencyKey,
          preferredPaymentMethodId: input.preferredPaymentMethodId,
          metadata: input.metadata || null,
        });
        stripePaymentIntentId = stripeAuth.paymentIntentId;
      } catch (error) {
        const canFallback = input.allowPrepaidFallback === true
          && Number.isFinite(input.prepaidAvailableBalance)
          && (input.prepaidAvailableBalance || 0) >= input.amount;
        if (!canFallback) throw error;
        selectedFundingMode = 'PREPAID_BALANCE';
      }
    }

    if (
      selectedFundingMode === 'PREPAID_BALANCE'
      && (
        !Number.isFinite(input.prepaidAvailableBalance)
        || (input.prepaidAvailableBalance || 0) < input.amount
      )
    ) {
      throw new Error('Insufficient prepaid balance for reservation fallback');
    }

    const authorizedAt = selectedFundingMode === 'STRIPE_AUTH_CAPTURE' ? nowIso() : null;
    const created = await store.createFlow({
      id: paymentId,
      userId: input.userId,
      taskId: input.taskId || null,
      merchant,
      amount: input.amount,
      currency: normalizedCurrency,
      fundingMode: selectedFundingMode,
      status: 'activation_pending',
      stripePaymentIntentId,
      requiresActivationVerification: input.requiresActivationVerification !== false,
      idempotencyAuthorizeKey: idempotencyKey,
      metadata: enrichMetadata(input.metadata || null, {
        authorize_idempotency_key: idempotencyKey,
        selected_funding_mode: selectedFundingMode,
      }),
      authorizedAt,
    });

    await store.appendEvent({
      paymentFlowId: created.id,
      userId: created.userId,
      eventType: selectedFundingMode === 'STRIPE_AUTH_CAPTURE' ? 'authorized' : 'reserved',
      amount: created.amount,
      currency: created.currency,
      idempotencyKey,
      details: {
        fundingMode: selectedFundingMode,
        stripePaymentIntentId: created.stripePaymentIntentId,
      },
    });

    await store.appendEvent({
      paymentFlowId: created.id,
      userId: created.userId,
      eventType: 'activation_pending',
      amount: created.amount,
      currency: created.currency,
      idempotencyKey,
      details: {
        requiresActivationVerification: created.requiresActivationVerification,
      },
    });

    return { payment: created, idempotentReplay: false };
  }

  async function attemptCaptureActivated(
    payment: PaymentFlow,
    idempotencyKey: string,
    prepaidAvailableBalance?: number,
  ): Promise<TwoPhaseResult> {
    if (payment.fundingMode === 'STRIPE_AUTH_CAPTURE') {
      if (!payment.stripePaymentIntentId) {
        throw new Error('Missing Stripe payment intent for capture');
      }

      try {
        const capture = await gateway.captureStripe({
          userId: payment.userId,
          paymentId: payment.id,
          stripePaymentIntentId: payment.stripePaymentIntentId,
          idempotencyKey,
        });

        await store.appendEvent({
          paymentFlowId: payment.id,
          userId: payment.userId,
          eventType: 'captured',
          amount: payment.amount,
          currency: payment.currency,
          idempotencyKey,
          details: {
            stripePaymentIntentId: capture.paymentIntentId,
            gatewayStatus: capture.status,
            capturedAmount: capture.capturedAmount ?? payment.amount,
          },
        });

        const updated = await store.updateFlow(payment.userId, payment.id, {
          status: 'captured',
          capturedAt: nowIso(),
        });
        return { payment: updated, idempotentReplay: false };
      } catch (error) {
        if (isRetryableFailure(error)) {
          const retryError = error instanceof Error ? error : new Error(String(error));
          const { nextRetryAt } = await scheduleRetry({
            payment,
            operation: 'capture',
            attempt: 1,
            idempotencyKey,
            error: retryError,
          });
          logger.warn('payments.capture.retry_scheduled', {
            paymentId: payment.id,
            reason: retryError.message,
            nextRetryAt,
          });
          const fresh = await store.findById(payment.userId, payment.id);
          if (!fresh) throw new Error(`Payment flow not found: ${payment.id}`);
          return { payment: fresh, idempotentReplay: false, retryScheduled: true, nextRetryAt };
        }
        throw error;
      }
    }

    if (!Number.isFinite(prepaidAvailableBalance) || (prepaidAvailableBalance || 0) < payment.amount) {
      await store.appendEvent({
        paymentFlowId: payment.id,
        userId: payment.userId,
        eventType: 'activation_failed',
        amount: payment.amount,
        currency: payment.currency,
        idempotencyKey,
        reason: 'Prepaid balance unavailable at capture time',
      });

      await store.updateFlow(payment.userId, payment.id, {
        status: 'activation_failed',
      });

      return voidInternal({
        userId: payment.userId,
        paymentId: payment.id,
        idempotencyKey: `${idempotencyKey}:void`,
        reason: 'Prepaid balance unavailable at capture time',
      }, true);
    }

    await gateway.captureReservedBalance({
      userId: payment.userId,
      paymentId: payment.id,
      merchant: payment.merchant,
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey,
    });

    await store.appendEvent({
      paymentFlowId: payment.id,
      userId: payment.userId,
      eventType: 'captured',
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey,
      details: { fundingMode: payment.fundingMode },
    });

    const updated = await store.updateFlow(payment.userId, payment.id, {
      status: 'captured',
      capturedAt: nowIso(),
    });
    return { payment: updated, idempotentReplay: false };
  }

  async function capture(input: CaptureTwoPhaseInput): Promise<TwoPhaseResult> {
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const payment = await store.findById(input.userId, input.paymentId);
    if (!payment) throw new Error(`Payment flow not found: ${input.paymentId}`);

    if (payment.status === 'captured') {
      return { payment, idempotentReplay: true };
    }

    const idempotency = await store.claimOperationIdempotency({
      userId: input.userId,
      paymentId: input.paymentId,
      operation: 'capture',
      idempotencyKey,
    });
    if (idempotency === 'conflict') {
      throw new Error('IDEMPOTENCY_CONFLICT: capture already claimed with a different key');
    }
    if (idempotency === 'replay') {
      const replay = await store.findById(input.userId, input.paymentId);
      if (!replay) throw new Error(`Payment flow not found: ${input.paymentId}`);
      return { payment: replay, idempotentReplay: true };
    }

    if (!input.activationVerified) {
      const reason = input.activationFailureReason || 'Activation verification failed';
      await store.appendEvent({
        paymentFlowId: payment.id,
        userId: payment.userId,
        eventType: 'activation_failed',
        amount: payment.amount,
        currency: payment.currency,
        idempotencyKey,
        reason,
        details: input.activationEvidence || null,
      });
      await store.updateFlow(payment.userId, payment.id, { status: 'activation_failed' });
      return voidInternal({
        userId: payment.userId,
        paymentId: payment.id,
        idempotencyKey: `${idempotencyKey}:void`,
        reason,
      }, true);
    }

    await store.appendEvent({
      paymentFlowId: payment.id,
      userId: payment.userId,
      eventType: 'activated',
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey,
      details: input.activationEvidence || null,
    });

    const activated = await store.updateFlow(payment.userId, payment.id, {
      status: 'activated',
      activationVerifiedAt: nowIso(),
    });

    return attemptCaptureActivated(activated, idempotencyKey, input.prepaidAvailableBalance);
  }

  async function voidPayment(input: VoidTwoPhaseInput): Promise<TwoPhaseResult> {
    return voidInternal(input, false);
  }

  async function processDueRetries(limit = 20): Promise<{ processed: number }> {
    const jobs = await store.listDueRetryJobs(nowIso(), limit);
    for (const job of jobs) {
      await store.markRetryJob(job.id, {
        status: 'processing',
        attempt: job.attempt + 1,
      });

      try {
        const flow = await store.findById(job.userId, job.paymentFlowId);
        if (!flow) {
          await store.markRetryJob(job.id, { status: 'failed', lastError: 'payment flow missing' });
          continue;
        }

        if (job.operation === 'capture') {
          if (flow.status !== 'activated') {
            await store.markRetryJob(job.id, { status: 'completed' });
            continue;
          }

          await attemptCaptureActivated(flow, job.idempotencyKey);
          await store.markRetryJob(job.id, { status: 'completed', lastError: null });
          continue;
        }

        await voidInternal({
          userId: flow.userId,
          paymentId: flow.id,
          idempotencyKey: job.idempotencyKey,
          reason: 'retry_void_operation',
        }, true);
        await store.markRetryJob(job.id, { status: 'completed', lastError: null });
      } catch (error) {
        const nextAttempt = job.attempt + 1;
        if (nextAttempt >= job.maxAttempts) {
          await store.markRetryJob(job.id, {
            status: 'failed',
            lastError: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        const nextRetryAt = addDelay(nowIso(), computeRetryDelayMs(nextAttempt));
        await store.markRetryJob(job.id, {
          status: 'pending',
          attempt: nextAttempt,
          nextRetryAt,
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { processed: jobs.length };
  }

  return {
    authorize,
    capture,
    voidPayment,
    processDueRetries,
  };
}
