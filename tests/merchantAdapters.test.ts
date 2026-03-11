import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MerchantAdapter,
  MerchantAdapterConfigSchema,
  MerchantAdapterTimeoutError,
  MerchantAdapterUnsupportedError,
  type AttemptProvisionInput,
  type AttemptProvisionResult,
  type AuthorizePaymentInput,
  type AuthorizePaymentResult,
  type CapturePaymentInput,
  type CapturePaymentResult,
  type ClassifyMerchantInput,
  type ClassifyMerchantResult,
  type PrepareCheckoutInput,
  type PrepareCheckoutResult,
  type SupportEvidenceInput,
  type SupportEvidenceResult,
  type VerifyActivationInput,
  type VerifyActivationResult,
  type VoidOrRefundInput,
  type VoidOrRefundResult,
} from '../lib/merchants/baseAdapter.ts';
import {
  ApiSubscriptionServiceAdapter,
  type ApiSubscriptionClient,
} from '../lib/merchants/apiSubscriptionAdapter.ts';
import {
  StripeCheckoutSaasAdapter,
  type StripeCheckoutGateway,
} from '../lib/merchants/stripeCheckoutAdapter.ts';
import { UnsupportedConsumerSiteAdapter } from '../lib/merchants/unsupportedConsumerSiteAdapter.ts';

class FlakyPrepareAdapter extends MerchantAdapter {
  attemptCount = 0;

  constructor() {
    super(MerchantAdapterConfigSchema.parse({
      adapterId: 'flaky_prepare_adapter',
      merchant: 'Flaky Merchant',
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 1,
        jitterRatio: 0,
        retryableErrorPatterns: ['transient network'],
      },
      timeoutPolicy: {
        defaultTimeoutMs: 300,
        byOperation: {
          prepareCheckout: 300,
        },
      },
    }));
  }

  protected async doClassifyMerchant(_input: ClassifyMerchantInput): Promise<ClassifyMerchantResult> {
    throw new Error('not used');
  }

  protected async doPrepareCheckout(_input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    this.attemptCount += 1;
    if (this.attemptCount < 2) {
      throw new Error('transient network');
    }
    return {
      status: 'ready',
      checkoutReference: 'chk_1',
      requiresUserInteraction: false,
    };
  }

  protected async doAuthorizePayment(_input: AuthorizePaymentInput): Promise<AuthorizePaymentResult> {
    throw new Error('not used');
  }

  protected async doAttemptProvision(_input: AttemptProvisionInput): Promise<AttemptProvisionResult> {
    throw new Error('not used');
  }

  protected async doVerifyActivation(_input: VerifyActivationInput): Promise<VerifyActivationResult> {
    throw new Error('not used');
  }

  protected async doCapturePayment(_input: CapturePaymentInput): Promise<CapturePaymentResult> {
    throw new Error('not used');
  }

  protected async doVoidOrRefund(_input: VoidOrRefundInput): Promise<VoidOrRefundResult> {
    throw new Error('not used');
  }

  protected async doGetSupportEvidence(_input: SupportEvidenceInput): Promise<SupportEvidenceResult> {
    throw new Error('not used');
  }
}

class TimeoutAdapter extends MerchantAdapter {
  constructor() {
    super(MerchantAdapterConfigSchema.parse({
      adapterId: 'timeout_adapter',
      merchant: 'Slow Merchant',
      retryPolicy: {
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 1,
        jitterRatio: 0,
        retryableErrorPatterns: ['timeout'],
      },
      timeoutPolicy: {
        defaultTimeoutMs: 15,
      },
    }));
  }

  protected async doClassifyMerchant(_input: ClassifyMerchantInput): Promise<ClassifyMerchantResult> {
    throw new Error('not used');
  }

  protected async doPrepareCheckout(_input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    await new Promise((resolve) => {
      setTimeout(resolve, 45);
    });
    return {
      status: 'ready',
      checkoutReference: 'late_session',
      requiresUserInteraction: false,
    };
  }

  protected async doAuthorizePayment(_input: AuthorizePaymentInput): Promise<AuthorizePaymentResult> {
    throw new Error('not used');
  }

  protected async doAttemptProvision(_input: AttemptProvisionInput): Promise<AttemptProvisionResult> {
    throw new Error('not used');
  }

  protected async doVerifyActivation(_input: VerifyActivationInput): Promise<VerifyActivationResult> {
    throw new Error('not used');
  }

  protected async doCapturePayment(_input: CapturePaymentInput): Promise<CapturePaymentResult> {
    throw new Error('not used');
  }

  protected async doVoidOrRefund(_input: VoidOrRefundInput): Promise<VoidOrRefundResult> {
    throw new Error('not used');
  }

  protected async doGetSupportEvidence(_input: SupportEvidenceInput): Promise<SupportEvidenceResult> {
    throw new Error('not used');
  }
}

test('base adapter retries transient prepareCheckout failures and succeeds', async () => {
  const adapter = new FlakyPrepareAdapter();
  const result = await adapter.prepareCheckout({
    merchant: 'Flaky Merchant',
    amount: 9.99,
    currency: 'USD',
    context: {
      userId: 'u1',
      taskId: 't1',
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(adapter.attemptCount, 2);
});

test('base adapter surfaces timeout error with operation context', async () => {
  const adapter = new TimeoutAdapter();

  await assert.rejects(
    adapter.prepareCheckout({
      merchant: 'Slow Merchant',
      amount: 19,
      currency: 'USD',
      context: {
        userId: 'u2',
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof MerchantAdapterTimeoutError);
      assert.equal(error.operation, 'prepareCheckout');
      return true;
    },
  );
});

test('stripe checkout adapter implements contract for classify/prepare/authorize/capture/refund', async () => {
  const gateway: StripeCheckoutGateway = {
    async createCheckoutSession() {
      return { id: 'cs_test_1', url: 'https://checkout.example/session/cs_test_1' };
    },
    async authorizePayment() {
      return { id: 'auth_test_1', status: 'authorized' };
    },
    async capturePayment() {
      return { id: 'cap_test_1', status: 'captured' };
    },
    async voidOrRefund() {
      return { id: 'rf_test_1', status: 'refunded' };
    },
  };

  const adapter = new StripeCheckoutSaasAdapter({
    adapterId: 'stripe_checkout_adapter',
    merchant: 'Netflix',
    supportedMerchants: ['netflix'],
    defaultSuccessUrl: 'https://wallet.local/success',
    defaultCancelUrl: 'https://wallet.local/cancel',
    planPriceLookup: { ads: 'price_ads' },
    activationMode: 'webhook',
    timeoutPolicy: {
      defaultTimeoutMs: 1000,
      byOperation: {},
    },
    retryPolicy: {
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 1,
      jitterRatio: 0,
      retryableErrorPatterns: ['timeout'],
    },
    metadata: {},
  }, {
    gateway,
  });

  const classify = await adapter.classifyMerchant({
    request: {
      merchant: 'Netflix',
      requestedAction: 'SUBSCRIBE',
      countryCode: 'US',
      currency: 'USD',
    },
  });
  assert.equal(classify.supported, true);

  const prepared = await adapter.prepareCheckout({
    merchant: 'Netflix',
    planId: 'ads',
    amount: 7.99,
    currency: 'USD',
    context: {
      userId: 'u3',
      taskId: 'task_3',
    },
  });
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.checkoutReference, 'cs_test_1');

  const authorized = await adapter.authorizePayment({
    merchant: 'Netflix',
    amount: 7.99,
    currency: 'USD',
    context: {
      userId: 'u3',
      paymentId: 'p3',
      idempotencyKey: 'idem_auth_3',
    },
  });
  assert.equal(authorized.status, 'authorized');

  const captured = await adapter.capturePayment({
    merchant: 'Netflix',
    amount: 7.99,
    currency: 'USD',
    context: {
      userId: 'u3',
      paymentId: 'p3',
      idempotencyKey: 'idem_capture_3',
    },
  });
  assert.equal(captured.status, 'captured');

  const refunded = await adapter.voidOrRefund({
    merchant: 'Netflix',
    amount: 7.99,
    currency: 'USD',
    reason: 'Activation failed',
    context: {
      userId: 'u3',
      paymentId: 'p3',
      idempotencyKey: 'idem_refund_3',
    },
  });
  assert.equal(refunded.status, 'refunded');
});

test('api subscription adapter supports API-native merchants', async () => {
  const client: ApiSubscriptionClient = {
    async createCheckoutDraft() {
      return { draftId: 'draft_1' };
    },
    async authorize() {
      return { authorizationId: 'api_auth_1', status: 'authorized' };
    },
    async provision() {
      return { provisionId: 'prov_1', status: 'provisioned' };
    },
    async verify() {
      return { activationStatus: 'ACTIVE', observedAt: new Date().toISOString() };
    },
    async capture() {
      return { captureId: 'cap_1', status: 'captured' };
    },
    async voidOrRefund() {
      return { referenceId: 'refund_1', status: 'refunded' };
    },
  };

  const adapter = new ApiSubscriptionServiceAdapter({
    adapterId: 'api_sub_adapter',
    merchant: 'OpenAI',
    apiBaseUrl: 'https://merchant.api',
    merchantAliases: ['openai'],
    activationTimeoutMs: 60000,
    timeoutPolicy: {
      defaultTimeoutMs: 1000,
      byOperation: {},
    },
    retryPolicy: {
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 1,
      jitterRatio: 0,
      retryableErrorPatterns: ['timeout'],
    },
    metadata: {},
  }, {
    client,
  });

  const classify = await adapter.classifyMerchant({
    request: {
      merchant: 'OpenAI',
      requestedAction: 'SUBSCRIBE',
      countryCode: 'US',
      currency: 'USD',
    },
  });
  assert.equal(classify.supported, true);

  const activation = await adapter.verifyActivation({
    merchant: 'OpenAI',
    context: {
      userId: 'u4',
      taskId: 't4',
      paymentId: 'p4',
      authorizedAt: new Date().toISOString(),
    },
  });

  assert.equal(activation.activationStatus, 'ACTIVE');
  assert.equal(activation.settlementRecommendation, 'CAPTURE_SETTLEMENT');
});

test('unsupported consumer site adapter hard-stops payment operations', async () => {
  const adapter = new UnsupportedConsumerSiteAdapter({
    adapterId: 'unsupported_site_adapter',
    merchant: 'ConsumerSite',
    blockedReason: 'Consumer signup flow is unsupported for autonomous execution.',
    merchantAliases: ['consumersite'],
    timeoutPolicy: {
      defaultTimeoutMs: 1000,
      byOperation: {},
    },
    retryPolicy: {
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 1,
      jitterRatio: 0,
      retryableErrorPatterns: ['timeout'],
    },
    metadata: {},
  });

  const classify = await adapter.classifyMerchant({
    request: {
      merchant: 'ConsumerSite',
      requestedAction: 'SUBSCRIBE',
      countryCode: 'US',
      currency: 'USD',
    },
  });
  assert.equal(classify.supported, false);

  const checkout = await adapter.prepareCheckout({
    merchant: 'ConsumerSite',
    amount: 10,
    currency: 'USD',
    context: {
      userId: 'u5',
    },
  });
  assert.equal(checkout.status, 'blocked');

  await assert.rejects(
    adapter.authorizePayment({
      merchant: 'ConsumerSite',
      amount: 10,
      currency: 'USD',
      context: {
        userId: 'u5',
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof MerchantAdapterUnsupportedError);
      assert.equal(error.operation, 'authorizePayment');
      return true;
    },
  );
});
