import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluatePreChargeRisk,
  type PreChargeGateInput,
} from '../lib/risk/preChargeGate.ts';

const FIXTURES: Record<string, PreChargeGateInput> = {
  awsLowRisk: {
    merchant: 'AWS',
    compatibilityTier: 'API_NATIVE',
    refundRiskLevel: 'LOW',
    requiresActivationVerification: false,
    activationSignals: {
      verificationAvailable: true,
      availableMethods: ['MERCHANT_API_CHECK', 'WEBHOOK_CONFIRMATION'],
    },
    knownRefundReliability: 'HIGH',
    antiBotRisk: 'LOW',
    accountCreation: {
      required: false,
      accountStatus: 'EXISTS',
    },
    serviceProvisioningConfidence: 0.94,
    reserveOnlySupported: true,
    compatibilityBlockedReasons: [],
  },
  netflixActivationRisk: {
    merchant: 'Netflix',
    compatibilityTier: 'CHECKOUT_NATIVE',
    refundRiskLevel: 'HIGH',
    requiresActivationVerification: true,
    activationSignals: {
      verificationAvailable: true,
      availableMethods: ['EMAIL_RECEIPT_PARSING'],
    },
    knownRefundReliability: 'MEDIUM',
    antiBotRisk: 'MEDIUM',
    accountCreation: {
      required: true,
      accountStatus: 'NOT_FOUND',
    },
    serviceProvisioningConfidence: 0.67,
    reserveOnlySupported: true,
    compatibilityBlockedReasons: [],
  },
  fanduelUnsafe: {
    merchant: 'FanDuel',
    compatibilityTier: 'AUTOMATION_UNSAFE',
    refundRiskLevel: 'CRITICAL',
    requiresActivationVerification: true,
    activationSignals: {
      verificationAvailable: false,
      availableMethods: [],
    },
    knownRefundReliability: 'LOW',
    antiBotRisk: 'HIGH',
    accountCreation: {
      required: true,
      accountStatus: 'UNKNOWN',
    },
    serviceProvisioningConfidence: 0.2,
    reserveOnlySupported: true,
    compatibilityBlockedReasons: ['Regulated merchant path blocked by policy.'],
  },
};

test('allows direct capture for low-risk API-native merchant', () => {
  const result = evaluatePreChargeRisk(FIXTURES.awsLowRisk);

  assert.equal(result.decision, 'allow');
  assert.equal(result.allowedExecutionPath, 'CAPTURE_ALLOWED');
  assert.equal(result.reserveRequired, false);
  assert.equal(result.hardStops.length, 0);
  assert.ok(result.score.overallScore >= 78);
  assert.equal(result.score.riskBand, 'LOW');
});

test('returns allow_with_reserve_only when activation/refund risk requires reserve mode', () => {
  const result = evaluatePreChargeRisk(FIXTURES.netflixActivationRisk);

  assert.equal(result.decision, 'allow_with_reserve_only');
  assert.equal(result.allowedExecutionPath, 'RESERVE_ONLY');
  assert.equal(result.reserveRequired, true);
  assert.equal(result.hardStops.length, 0);
  assert.ok(result.blockedReasons.some((reason) => reason.toLowerCase().includes('reserve-only')));
});

test('hard-stops AUTOMATION_UNSAFE merchants with deny_with_reason', () => {
  const result = evaluatePreChargeRisk(FIXTURES.fanduelUnsafe);

  assert.equal(result.decision, 'deny_with_reason');
  assert.equal(result.allowedExecutionPath, 'BLOCKED');
  assert.ok(result.denyReason);
  assert.ok(result.hardStops.some((stop) => stop.code === 'AUTOMATION_UNSAFE'));
});

test('denies with explicit reason when reserve-only is required but unsupported', () => {
  const result = evaluatePreChargeRisk({
    ...FIXTURES.netflixActivationRisk,
    reserveOnlySupported: false,
  });

  assert.equal(result.decision, 'deny_with_reason');
  assert.equal(result.allowedExecutionPath, 'BLOCKED');
  assert.match(result.denyReason || '', /reserve-only/i);
  assert.ok(result.hardStops.some((stop) => stop.code === 'RESERVE_NOT_SUPPORTED'));
});

test('returns deny when score is below threshold without hard-stop policy trigger', () => {
  const result = evaluatePreChargeRisk({
    merchant: 'Example Commerce',
    compatibilityTier: 'CHECKOUT_NATIVE',
    refundRiskLevel: 'HIGH',
    requiresActivationVerification: false,
    activationSignals: {
      verificationAvailable: true,
      availableMethods: ['TIMEOUT_CLASSIFICATION'],
    },
    knownRefundReliability: 'LOW',
    antiBotRisk: 'HIGH',
    accountCreation: {
      required: true,
      accountStatus: 'NOT_FOUND',
    },
    serviceProvisioningConfidence: 0.19,
    reserveOnlySupported: true,
    compatibilityBlockedReasons: [],
  }, {
    enforceReserveWhenActivationRequired: false,
    enforceReserveWhenRefundRiskHigh: false,
    thresholds: {
      allowMinScore: 90,
      reserveOnlyMinScore: 75,
      denyBelowScore: 70,
    },
  });

  assert.equal(result.decision, 'deny');
  assert.equal(result.allowedExecutionPath, 'BLOCKED');
  assert.equal(result.hardStops.length, 0);
  assert.ok(result.blockedReasons.some((reason) => reason.toLowerCase().includes('threshold')));
});

test('is idempotent for identical inputs and policy', () => {
  const policy = {
    thresholds: {
      allowMinScore: 78,
      reserveOnlyMinScore: 58,
      denyBelowScore: 42,
    },
    enforceReserveWhenActivationRequired: true,
    enforceReserveWhenRefundRiskHigh: true,
  };

  const first = evaluatePreChargeRisk(FIXTURES.netflixActivationRisk, policy);
  const second = evaluatePreChargeRisk(FIXTURES.netflixActivationRisk, policy);

  assert.equal(first.decisionId, second.decisionId);
  assert.equal(first.decision, second.decision);
  assert.equal(first.score.overallScore, second.score.overallScore);
  assert.deepEqual(first.score.factors, second.score.factors);
});

test('supports configurable thresholds to allow stronger reserve-only workflows', () => {
  const result = evaluatePreChargeRisk(FIXTURES.netflixActivationRisk, {
    thresholds: {
      allowMinScore: 92,
      reserveOnlyMinScore: 45,
      denyBelowScore: 20,
    },
  });

  assert.equal(result.decision, 'allow_with_reserve_only');
  assert.equal(result.policyApplied.thresholds.allowMinScore, 92);
  assert.equal(result.policyApplied.thresholds.reserveOnlyMinScore, 45);
});
