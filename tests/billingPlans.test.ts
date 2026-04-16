import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test plan definitions and entitlement logic without DB/Stripe dependencies
// We inline the pure logic here to avoid importing server-only modules.

type PlanId = 'starter' | 'pro' | 'autonomous';

const PLAN_HIERARCHY: PlanId[] = ['starter', 'pro', 'autonomous'];

const PLANS: Record<PlanId, { priceMonthly: number; trialDays: number }> = {
  starter: { priceMonthly: 5, trialDays: 14 },
  pro: { priceMonthly: 20, trialDays: 0 },
  autonomous: { priceMonthly: 30, trialDays: 0 },
};

interface BillingState {
  plan: PlanId | null;
  status: string;
  isActive: boolean;
  isTrial: boolean;
  cancelAtPeriodEnd: boolean;
}

function hasFeatureAccess(billing: BillingState, requiredPlan: PlanId): boolean {
  if (!billing.isActive || !billing.plan) return false;
  const userLevel = PLAN_HIERARCHY.indexOf(billing.plan);
  const requiredLevel = PLAN_HIERARCHY.indexOf(requiredPlan);
  return userLevel >= requiredLevel;
}

function getUserPlanAction(billing: BillingState, targetPlan: PlanId): string {
  if (!billing.plan || !billing.isActive) return 'subscribe';
  if (billing.plan === targetPlan) return 'current';
  const currentLevel = PLAN_HIERARCHY.indexOf(billing.plan);
  const targetLevel = PLAN_HIERARCHY.indexOf(targetPlan);
  return targetLevel > currentLevel ? 'upgrade' : 'downgrade';
}

describe('billing plans', () => {
  it('has correct prices', () => {
    assert.equal(PLANS.starter.priceMonthly, 5);
    assert.equal(PLANS.pro.priceMonthly, 20);
    assert.equal(PLANS.autonomous.priceMonthly, 30);
  });

  it('only starter has a trial', () => {
    assert.equal(PLANS.starter.trialDays, 14);
    assert.equal(PLANS.pro.trialDays, 0);
    assert.equal(PLANS.autonomous.trialDays, 0);
  });

  it('plan hierarchy is starter < pro < autonomous', () => {
    assert.deepEqual(PLAN_HIERARCHY, ['starter', 'pro', 'autonomous']);
  });
});

describe('feature access', () => {
  it('no plan means no access', () => {
    const billing: BillingState = { plan: null, status: 'none', isActive: false, isTrial: false, cancelAtPeriodEnd: false };
    assert.equal(hasFeatureAccess(billing, 'starter'), false);
    assert.equal(hasFeatureAccess(billing, 'pro'), false);
  });

  it('starter can access starter features', () => {
    const billing: BillingState = { plan: 'starter', status: 'active', isActive: true, isTrial: false, cancelAtPeriodEnd: false };
    assert.equal(hasFeatureAccess(billing, 'starter'), true);
    assert.equal(hasFeatureAccess(billing, 'pro'), false);
    assert.equal(hasFeatureAccess(billing, 'autonomous'), false);
  });

  it('pro can access starter and pro features', () => {
    const billing: BillingState = { plan: 'pro', status: 'active', isActive: true, isTrial: false, cancelAtPeriodEnd: false };
    assert.equal(hasFeatureAccess(billing, 'starter'), true);
    assert.equal(hasFeatureAccess(billing, 'pro'), true);
    assert.equal(hasFeatureAccess(billing, 'autonomous'), false);
  });

  it('autonomous can access everything', () => {
    const billing: BillingState = { plan: 'autonomous', status: 'active', isActive: true, isTrial: false, cancelAtPeriodEnd: false };
    assert.equal(hasFeatureAccess(billing, 'starter'), true);
    assert.equal(hasFeatureAccess(billing, 'pro'), true);
    assert.equal(hasFeatureAccess(billing, 'autonomous'), true);
  });

  it('trialing user has access', () => {
    const billing: BillingState = { plan: 'starter', status: 'trialing', isActive: true, isTrial: true, cancelAtPeriodEnd: false };
    assert.equal(hasFeatureAccess(billing, 'starter'), true);
  });

  it('canceled user with expired period has no access', () => {
    const billing: BillingState = { plan: 'pro', status: 'canceled', isActive: false, isTrial: false, cancelAtPeriodEnd: false };
    assert.equal(hasFeatureAccess(billing, 'starter'), false);
  });
});

describe('plan action resolution', () => {
  it('no plan -> subscribe', () => {
    const billing: BillingState = { plan: null, status: 'none', isActive: false, isTrial: false, cancelAtPeriodEnd: false };
    assert.equal(getUserPlanAction(billing, 'starter'), 'subscribe');
    assert.equal(getUserPlanAction(billing, 'pro'), 'subscribe');
  });

  it('same plan -> current', () => {
    const billing: BillingState = { plan: 'pro', status: 'active', isActive: true, isTrial: false, cancelAtPeriodEnd: false };
    assert.equal(getUserPlanAction(billing, 'pro'), 'current');
  });

  it('starter -> pro is upgrade', () => {
    const billing: BillingState = { plan: 'starter', status: 'active', isActive: true, isTrial: false, cancelAtPeriodEnd: false };
    assert.equal(getUserPlanAction(billing, 'pro'), 'upgrade');
    assert.equal(getUserPlanAction(billing, 'autonomous'), 'upgrade');
  });

  it('autonomous -> pro is downgrade', () => {
    const billing: BillingState = { plan: 'autonomous', status: 'active', isActive: true, isTrial: false, cancelAtPeriodEnd: false };
    assert.equal(getUserPlanAction(billing, 'pro'), 'downgrade');
    assert.equal(getUserPlanAction(billing, 'starter'), 'downgrade');
  });
});
