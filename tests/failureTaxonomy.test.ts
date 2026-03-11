import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FailureSource,
  FailureRecordSchema,
  WalletFailureCode,
} from '../lib/failures/codes.ts';
import {
  assertAllPoliciesValid,
  getFailurePolicy,
  getUiCopyForFailure,
  RetryStrategy,
  RefundAction,
  LoggingLevel,
} from '../lib/failures/policies.ts';
import { mapErrorToFailure } from '../lib/failures/mapError.ts';

test('includes every required standardized failure code', () => {
  const expected = new Set([
    'signup_blocked',
    'merchant_requires_human_verification',
    'captcha_or_bot_challenge',
    'plan_selection_failed',
    'payment_authorization_failed',
    'payment_captured_activation_failed',
    'activation_unverified',
    'merchant_site_error',
    'duplicate_account_detected',
    'unsupported_checkout_path',
    'policy_blocked',
    'high_refund_risk',
  ]);

  const actual = new Set(Object.values(WalletFailureCode));
  assert.deepEqual(actual, expected);
});

test('defines valid policy entry for each failure code', () => {
  assert.doesNotThrow(() => assertAllPoliciesValid());

  for (const code of Object.values(WalletFailureCode) as WalletFailureCode[]) {
    const policy = getFailurePolicy(code);
    assert.equal(policy.code, code);
    assert.ok(policy.userMessage.length > 0);
    assert.ok(policy.nextActionLabel.length > 0);
  }
});

test('maps captured + activation failure into refund-safe critical code', () => {
  const mapped = mapErrorToFailure({
    source: FailureSource.PAYMENT_PROCESSOR,
    paymentStatus: 'captured',
    activationStatus: 'FAILED',
    message: 'Charge succeeded but service not provisioned',
  });

  assert.equal(mapped.code, WalletFailureCode.PAYMENT_CAPTURED_ACTIVATION_FAILED);
  assert.equal(mapped.severity, 'critical');
  assert.equal(mapped.recoverable, true);

  const policy = getFailurePolicy(mapped.code);
  assert.equal(policy.refund.action, RefundAction.AUTO_REFUND);
  assert.equal(policy.logging.level, LoggingLevel.CRITICAL);
});

test('maps captcha and forces manual-only retry policy', () => {
  const mapped = mapErrorToFailure({
    message: 'Captcha challenge presented by merchant',
    stage: 'signup',
    source: FailureSource.MERCHANT,
  });

  assert.equal(mapped.code, WalletFailureCode.CAPTCHA_OR_BOT_CHALLENGE);
  const policy = getFailurePolicy(mapped.code);
  assert.equal(policy.retry.strategy, RetryStrategy.MANUAL_ONLY);
  assert.equal(policy.refund.action, RefundAction.NONE);
});

test('maps policy errors deterministically and exposes ui-friendly copy', () => {
  const mapped = mapErrorToFailure({
    message: 'POLICY_FAILURE: blocked by policy guardrail',
    source: FailureSource.POLICY_ENGINE,
  });

  assert.equal(mapped.code, WalletFailureCode.POLICY_BLOCKED);
  const copy = getUiCopyForFailure(mapped.code);
  assert.ok(copy.title.toLowerCase().includes('policy'));
  assert.ok(copy.userMessage.toLowerCase().includes('blocked'));
  assert.ok(copy.nextActionLabel.length > 0);
});

test('failure records remain zod-serializable', () => {
  const mapped = mapErrorToFailure({
    message: 'checkout path unsupported by automation',
    source: FailureSource.ORCHESTRATION,
    merchant: 'Example Merchant',
  });

  const parsed = FailureRecordSchema.parse(mapped);
  assert.equal(parsed.code, WalletFailureCode.UNSUPPORTED_CHECKOUT_PATH);
});
