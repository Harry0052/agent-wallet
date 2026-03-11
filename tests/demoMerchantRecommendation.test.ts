import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listDefaultDemoCandidates,
  rankDemoSafeMerchants,
  recommendMerchantForDemo,
} from '../lib/demo/merchantRecommendation.ts';
import { SAMPLE_DEMO_MERCHANTS } from '../lib/demo/merchantRules.ts';

test('recommends API-native merchant as demo-safe', () => {
  const aws = SAMPLE_DEMO_MERCHANTS.find((merchant) => merchant.merchant === 'AWS');
  assert.ok(aws);

  const recommendation = recommendMerchantForDemo(aws!);
  assert.equal(recommendation.demoSafe, true);
  assert.ok(recommendation.score >= 80);
  assert.equal(recommendation.recommendedDemoType, 'API_NATIVE_AUTONOMOUS_DEMO');
});

test('does not recommend known autonomous-signup blocker merchants', () => {
  const netflix = SAMPLE_DEMO_MERCHANTS.find((merchant) => merchant.merchant === 'Netflix');
  assert.ok(netflix);

  const recommendation = recommendMerchantForDemo(netflix!);
  assert.equal(recommendation.demoSafe, false);
  assert.equal(recommendation.recommendedDemoType, 'DO_NOT_DEMO_AUTONOMOUS_SIGNUP');
  assert.ok(
    recommendation.reasons.some((reason) => reason.toLowerCase().includes('common autonomous-signup blocker')),
  );
});

test('hard-stops critical anti-bot risk merchant', () => {
  const risky = recommendMerchantForDemo({
    merchant: 'RiskyConsumerSite',
    apiAvailability: 'LIMITED',
    checkoutSimplicity: 'SIMPLE',
    provisioningReliability: 'MEDIUM',
    antiBotRisk: 'CRITICAL',
    refundReliability: 'HIGH',
    subscriptionCancellationSupport: 'FULL',
    knownAutonomousSignupBlocker: false,
    notes: [],
  });

  assert.equal(risky.demoSafe, false);
  assert.ok(
    risky.reasons.some((reason) => reason.toLowerCase().includes('anti-bot risk')),
  );
});

test('ranks safe merchants first and blocked merchants later', () => {
  const ranked = rankDemoSafeMerchants(SAMPLE_DEMO_MERCHANTS);
  assert.ok(ranked.length >= 4);

  const firstUnsafeIndex = ranked.findIndex((entry) => !entry.demoSafe);
  assert.ok(firstUnsafeIndex > 0);
  assert.ok(ranked.slice(0, firstUnsafeIndex).every((entry) => entry.demoSafe));
});

test('default candidates exclude unsafe consumer signup demos at top', () => {
  const defaults = listDefaultDemoCandidates();
  const topFive = defaults.slice(0, 5).map((entry) => entry.merchant);

  assert.ok(!topFive.includes('Netflix'));
  assert.ok(!topFive.includes('FanDuel'));
});

