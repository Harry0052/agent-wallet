import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMerchantCompatibility } from '../lib/merchantCompatibility.ts';

test('classifies Netflix as CHECKOUT_NATIVE with activation verification', () => {
  const decision = classifyMerchantCompatibility({
    merchant: 'Netflix',
    requestedAction: 'SUBSCRIBE',
    countryCode: 'US',
    currency: 'USD',
  });

  assert.equal(decision.compatibilityTier, 'CHECKOUT_NATIVE');
  assert.equal(decision.recommendedPath, 'CHECKOUT_AUTOMATION');
  assert.equal(decision.requiresActivationVerification, true);
  assert.equal(decision.explanation.hardStopBeforePayment, false);
  assert.ok(decision.allowedActions.includes('CAPTURE_PAYMENT'));
});

test('hard-stops FanDuel before payment capture', () => {
  const decision = classifyMerchantCompatibility({
    merchant: 'FanDuel',
    requestedAction: 'BUY',
    countryCode: 'US',
    currency: 'USD',
  });

  assert.equal(decision.compatibilityTier, 'AUTOMATION_UNSAFE');
  assert.equal(decision.recommendedPath, 'BLOCKED');
  assert.equal(decision.explanation.hardStopBeforePayment, true);
  assert.ok(!decision.allowedActions.includes('CAPTURE_PAYMENT'));
  assert.ok(decision.blockedReasons.some((reason) => reason.toLowerCase().includes('hard stop')));
});

test('requires human verification for IRS payments', () => {
  const decision = classifyMerchantCompatibility({
    merchant: 'Internal Revenue Service',
    requestedAction: 'BUY',
    countryCode: 'US',
    currency: 'USD',
  });

  assert.equal(decision.compatibilityTier, 'HUMAN_VERIFICATION_REQUIRED');
  assert.equal(decision.recommendedPath, 'MANUAL_REVIEW');
  assert.equal(decision.explanation.hardStopBeforePayment, true);
  assert.ok(!decision.allowedActions.includes('CAPTURE_PAYMENT'));
});

test('classifies Google Play as PARTNER_ONLY and blocks direct capture', () => {
  const decision = classifyMerchantCompatibility({
    merchant: 'Google Play',
    requestedAction: 'SUBSCRIBE',
    countryCode: 'US',
    currency: 'USD',
  });

  assert.equal(decision.compatibilityTier, 'PARTNER_ONLY');
  assert.equal(decision.recommendedPath, 'PARTNER_CONNECTOR');
  assert.ok(decision.allowedActions.includes('EXECUTE_VIA_PARTNER'));
  assert.ok(!decision.allowedActions.includes('CAPTURE_PAYMENT'));
  assert.ok(decision.blockedReasons.some((reason) => reason.includes('Requested action SUBSCRIBE is blocked')));
});

test('returns stable idempotent decision for same input', () => {
  const input = {
    merchant: 'Netflix',
    requestedAction: 'SUBSCRIBE' as const,
    countryCode: 'US',
    currency: 'USD',
  };

  const first = classifyMerchantCompatibility(input);
  const second = classifyMerchantCompatibility(input);
  assert.deepEqual(first, second);
  assert.equal(first.decisionId, second.decisionId);
});

test('falls back to HUMAN_VERIFICATION_REQUIRED for unknown merchants', () => {
  const decision = classifyMerchantCompatibility({
    merchant: 'Acme Future Commerce',
    requestedAction: 'BUY',
    countryCode: 'US',
    currency: 'USD',
  });

  assert.equal(decision.compatibilityTier, 'HUMAN_VERIFICATION_REQUIRED');
  assert.equal(decision.recommendedPath, 'MANUAL_REVIEW');
  assert.ok(decision.blockedReasons.some((reason) => reason.includes('not in compatibility catalog')));
});

test('throws on invalid empty merchant input', () => {
  assert.throws(() => classifyMerchantCompatibility({
    merchant: '',
    requestedAction: 'BUY',
    countryCode: 'US',
    currency: 'USD',
  }));
});
