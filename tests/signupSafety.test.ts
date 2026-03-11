import assert from 'node:assert/strict';
import test from 'node:test';
import { WalletFailureCode } from '../lib/failures/codes.ts';
import { evaluateSignupSafety } from '../lib/signup/safety.ts';

test('allows checkout-native merchant with reserve-only path', () => {
  const evaluation = evaluateSignupSafety({
    merchant: 'Netflix',
    antiBotRisk: 'MEDIUM',
    knownRefundReliability: 'MEDIUM',
    accountStatus: 'UNKNOWN',
    accountCreationRequired: true,
    serviceProvisioningConfidence: 0.72,
    activationVerificationMethods: ['POST_PURCHASE_ACCOUNT_STATE_CHECK'],
    reserveOnlySupported: true,
  });

  assert.equal(evaluation.allowed, true);
  assert.equal(evaluation.compatibility.compatibilityTier, 'CHECKOUT_NATIVE');
  assert.match(evaluation.risk.decision, /allow/);
});

test('blocks automation-unsafe merchant before checkout execution', () => {
  const evaluation = evaluateSignupSafety({
    merchant: 'FanDuel',
    antiBotRisk: 'HIGH',
    knownRefundReliability: 'LOW',
    accountStatus: 'UNKNOWN',
    accountCreationRequired: true,
    serviceProvisioningConfidence: 0.4,
    activationVerificationMethods: ['POST_PURCHASE_ACCOUNT_STATE_CHECK'],
  });

  assert.equal(evaluation.allowed, false);
  assert.equal(evaluation.blocker?.code, WalletFailureCode.POLICY_BLOCKED);
  assert.equal(evaluation.blocker?.stage, 'compatibility');
});

test('blocks unknown merchants with human-verification-required compatibility fallback', () => {
  const evaluation = evaluateSignupSafety({
    merchant: 'UnknownMerchantXYZ',
    antiBotRisk: 'LOW',
    knownRefundReliability: 'UNKNOWN',
    accountStatus: 'UNKNOWN',
    accountCreationRequired: true,
    serviceProvisioningConfidence: 0.5,
    activationVerificationMethods: ['POST_PURCHASE_ACCOUNT_STATE_CHECK'],
  });

  assert.equal(evaluation.allowed, false);
  assert.equal(
    evaluation.blocker?.code,
    WalletFailureCode.MERCHANT_REQUIRES_HUMAN_VERIFICATION,
  );
});

test('blocks critical anti-bot risk with captcha/bot taxonomy code', () => {
  const evaluation = evaluateSignupSafety({
    merchant: 'Notion',
    antiBotRisk: 'CRITICAL',
    knownRefundReliability: 'MEDIUM',
    accountStatus: 'UNKNOWN',
    accountCreationRequired: true,
    serviceProvisioningConfidence: 0.65,
    activationVerificationMethods: ['POST_PURCHASE_ACCOUNT_STATE_CHECK'],
  });

  assert.equal(evaluation.allowed, false);
  assert.equal(evaluation.blocker?.code, WalletFailureCode.CAPTCHA_OR_BOT_CHALLENGE);
  assert.equal(evaluation.blocker?.stage, 'pre_charge_risk');
});

