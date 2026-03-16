import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Inline the pure logic to test without server imports
type PlanId = 'starter' | 'pro' | 'autonomous';
type FeatureKey = string;

interface FeatureDefinition {
  key: FeatureKey;
  label: string;
  minimumPlan: PlanId;
}

const PLAN_HIERARCHY: PlanId[] = ['starter', 'pro', 'autonomous'];

const FEATURES: FeatureDefinition[] = [
  { key: 'core_dashboard', label: 'Dashboard', minimumPlan: 'starter' },
  { key: 'basic_transactions', label: 'Transactions', minimumPlan: 'starter' },
  { key: 'advanced_insights', label: 'Advanced Insights', minimumPlan: 'pro' },
  { key: 'smart_savings', label: 'Smart Savings', minimumPlan: 'pro' },
  { key: 'ai_automation', label: 'AI Automation', minimumPlan: 'autonomous' },
  { key: 'bill_negotiation', label: 'Bill Negotiation', minimumPlan: 'autonomous' },
];

function canAccessFeature(userPlan: PlanId | null, feature: FeatureKey): boolean {
  if (!userPlan) return false;
  const def = FEATURES.find((f) => f.key === feature);
  if (!def) return false;
  return PLAN_HIERARCHY.indexOf(userPlan) >= PLAN_HIERARCHY.indexOf(def.minimumPlan);
}

function getLockedFeatures(userPlan: PlanId | null): FeatureDefinition[] {
  if (!userPlan) return FEATURES;
  return FEATURES.filter(
    (f) => PLAN_HIERARCHY.indexOf(userPlan) < PLAN_HIERARCHY.indexOf(f.minimumPlan),
  );
}

describe('entitlements', () => {
  it('no plan has no access', () => {
    assert.equal(canAccessFeature(null, 'core_dashboard'), false);
    assert.equal(canAccessFeature(null, 'ai_automation'), false);
  });

  it('starter can access starter features only', () => {
    assert.equal(canAccessFeature('starter', 'core_dashboard'), true);
    assert.equal(canAccessFeature('starter', 'basic_transactions'), true);
    assert.equal(canAccessFeature('starter', 'advanced_insights'), false);
    assert.equal(canAccessFeature('starter', 'ai_automation'), false);
  });

  it('pro can access starter + pro features', () => {
    assert.equal(canAccessFeature('pro', 'core_dashboard'), true);
    assert.equal(canAccessFeature('pro', 'advanced_insights'), true);
    assert.equal(canAccessFeature('pro', 'smart_savings'), true);
    assert.equal(canAccessFeature('pro', 'ai_automation'), false);
    assert.equal(canAccessFeature('pro', 'bill_negotiation'), false);
  });

  it('autonomous can access everything', () => {
    assert.equal(canAccessFeature('autonomous', 'core_dashboard'), true);
    assert.equal(canAccessFeature('autonomous', 'advanced_insights'), true);
    assert.equal(canAccessFeature('autonomous', 'ai_automation'), true);
    assert.equal(canAccessFeature('autonomous', 'bill_negotiation'), true);
  });

  it('locked features for starter excludes pro and autonomous', () => {
    const locked = getLockedFeatures('starter');
    assert.ok(locked.some((f) => f.key === 'advanced_insights'));
    assert.ok(locked.some((f) => f.key === 'ai_automation'));
    assert.ok(!locked.some((f) => f.key === 'core_dashboard'));
  });

  it('locked features for pro excludes only autonomous', () => {
    const locked = getLockedFeatures('pro');
    assert.ok(!locked.some((f) => f.key === 'advanced_insights'));
    assert.ok(locked.some((f) => f.key === 'ai_automation'));
  });

  it('autonomous has no locked features', () => {
    const locked = getLockedFeatures('autonomous');
    assert.equal(locked.length, 0);
  });

  it('null plan locks everything', () => {
    const locked = getLockedFeatures(null);
    assert.equal(locked.length, FEATURES.length);
  });
});
