import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivationVerificationEngine } from '../lib/activation/engine.ts';
import { createApiCheckProvider } from '../lib/activation/providers/apiCheck.ts';
import { createEmailSignalProvider } from '../lib/activation/providers/emailSignal.ts';
import { createStripeReceiptProvider } from '../lib/activation/providers/stripeReceipt.ts';

const BASE_INPUT = {
  paymentId: 'pay_123',
  userId: 'user_123',
  merchant: 'Netflix',
  authorizedAt: '2026-03-10T18:00:00.000Z',
  now: '2026-03-10T18:05:00.000Z',
} as const;

test('marks ACTIVE when webhook confirmation indicates successful activation', async () => {
  const stripeProvider = createStripeReceiptProvider({
    async getSignals() {
      return [
        {
          eventType: 'checkout.session.completed',
          eventId: 'evt_1',
          observedAt: '2026-03-10T18:04:00.000Z',
          paymentIntentId: 'pi_1',
        },
      ];
    },
  });

  const engine = createActivationVerificationEngine({
    providers: [stripeProvider],
    policy: { activationTimeoutMs: 30 * 60 * 1000 },
  });

  const result = await engine.verify(BASE_INPUT);
  assert.equal(result.activationStatus, 'ACTIVE');
  assert.equal(result.nextAction, 'CAPTURE_FUNDS');
  assert.equal(result.settlementRecommendation, 'CAPTURE_SETTLEMENT');
  assert.equal(result.verifiedAt, '2026-03-10T18:04:00.000Z');
});

test('marks FAILED when merchant API explicitly reports activation failure', async () => {
  const apiProvider = createApiCheckProvider({
    async check() {
      return {
        status: 'FAILED',
        observedAt: '2026-03-10T18:03:00.000Z',
        summary: 'Merchant API returned provision_failed.',
        referenceId: 'sub_001',
      };
    },
  });

  const engine = createActivationVerificationEngine({
    providers: [apiProvider],
  });

  const result = await engine.verify(BASE_INPUT);
  assert.equal(result.activationStatus, 'FAILED');
  assert.equal(result.nextAction, 'VOID_OR_REFUND');
  assert.equal(result.settlementRecommendation, 'VOID_OR_REFUND');
});

test('remains PENDING when only pending email signal exists and timeout not reached', async () => {
  const emailProvider = createEmailSignalProvider({
    async getSignals() {
      return [
        {
          id: 'mail_1',
          subject: 'We are setting up your account',
          bodySnippet: 'Activation in progress. Please wait.',
          receivedAt: '2026-03-10T18:04:30.000Z',
        },
      ];
    },
  });

  const engine = createActivationVerificationEngine({
    providers: [emailProvider],
    policy: { activationTimeoutMs: 20 * 60 * 1000 },
  });

  const result = await engine.verify(BASE_INPUT);
  assert.equal(result.activationStatus, 'PENDING');
  assert.equal(result.nextAction, 'WAIT_FOR_SIGNAL');
  assert.equal(result.settlementRecommendation, 'HOLD_SETTLEMENT');
});

test('enforces safe mode when timeout elapses without verification', async () => {
  const emailProvider = createEmailSignalProvider({
    async getSignals() {
      return [];
    },
  });

  const engine = createActivationVerificationEngine({
    providers: [emailProvider],
    policy: {
      activationTimeoutMs: 60 * 1000,
      safeModeOnTimeout: true,
    },
  });

  const result = await engine.verify({
    ...BASE_INPUT,
    now: '2026-03-10T18:10:00.000Z',
  });

  assert.equal(result.activationStatus, 'FAILED');
  assert.equal(result.nextAction, 'DO_NOT_MARK_TASK_COMPLETE');
  assert.equal(result.settlementRecommendation, 'VOID_OR_REFUND');
  assert.ok(result.evidence.some((item) => item.method === 'timeout_classification'));
});

test('supports post-purchase account-state checks through adapter hook', async () => {
  const engine = createActivationVerificationEngine({
    providers: [],
    accountStateChecker: {
      id: 'account-state-adapter',
      async check() {
        return {
          status: 'ACTIVE',
          observedAt: '2026-03-10T18:04:10.000Z',
          summary: 'Service entitlement flag is enabled.',
          referenceId: 'entitlement_123',
        };
      },
    },
  });

  const result = await engine.verify(BASE_INPUT);
  assert.equal(result.activationStatus, 'ACTIVE');
  assert.equal(result.nextAction, 'CAPTURE_FUNDS');
  assert.equal(result.settlementRecommendation, 'CAPTURE_SETTLEMENT');
  assert.equal(result.verifiedAt, '2026-03-10T18:04:10.000Z');
});
