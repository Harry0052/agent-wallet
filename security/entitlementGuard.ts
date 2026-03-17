import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import type { PlanId } from '@/lib/server/billing';
import { getUserSubscription, getBillingState } from '@/lib/server/billing';
import { canAccessFeature, type FeatureKey } from '@/lib/server/entitlements';
import { enforceApiAuth, type AuthGuardContext } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { logServerEvent } from '@/lib/server/observability';

export interface EntitlementGuardContext {
  auth: AuthGuardContext;
  plan: PlanId | null;
  isActive: boolean;
}

interface EnforceEntitlementOptions {
  /** Minimum plan required. If set, rejects users below this plan. */
  requiredPlan?: PlanId;
  /** Specific feature key required. If set, rejects users without this feature. */
  requiredFeature?: FeatureKey;
  /** Rate limit profile. */
  rateLimitProfile?: string;
  /** Rate limit scope. */
  rateLimitScope?: string;
}

/**
 * Centralized entitlement enforcement for API routes.
 * Combines auth check + rate limit + plan/feature access in one call.
 * Fails closed: if subscription state is uncertain, denies premium access.
 */
export async function enforceEntitlement(
  request: NextRequest,
  options: EnforceEntitlementOptions = {},
): Promise<
  | { ok: true; ctx: EntitlementGuardContext }
  | { ok: false; response: NextResponse }
> {
  // Rate limit
  const rateLimited = enforceRateLimit(request, {
    profile: (options.rateLimitProfile ?? 'general') as 'auth' | 'general',
    scope: options.rateLimitScope,
  });
  if (rateLimited) return { ok: false, response: rateLimited };

  // Auth
  const authResult = await enforceApiAuth(request);
  if (!authResult.ok) return { ok: false, response: authResult.response };

  // Load subscription state
  let plan: PlanId | null = null;
  let isActive = false;

  try {
    const subscription = await getUserSubscription(authResult.auth.walletUserId);
    if (subscription) {
      const billing = getBillingState(subscription);
      plan = billing.isActive ? (billing.plan as PlanId | null) : null;
      isActive = billing.isActive;
    }
  } catch (error) {
    // Fail closed: if we can't determine plan, treat as no plan
    logServerEvent('warn', 'entitlement.subscription_load_failed', {
      userId: authResult.auth.walletUserId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  const ctx: EntitlementGuardContext = {
    auth: authResult.auth,
    plan,
    isActive,
  };

  // Check required plan
  if (options.requiredPlan) {
    const PLAN_HIERARCHY: PlanId[] = ['starter', 'pro', 'autonomous'];
    const userLevel = plan ? PLAN_HIERARCHY.indexOf(plan) : -1;
    const requiredLevel = PLAN_HIERARCHY.indexOf(options.requiredPlan);

    if (userLevel < requiredLevel) {
      logServerEvent('info', 'entitlement.access_denied', {
        userId: authResult.auth.walletUserId,
        userPlan: plan,
        requiredPlan: options.requiredPlan,
        path: request.nextUrl.pathname,
      });

      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            error: 'This feature requires a higher plan.',
            requiredPlan: options.requiredPlan,
            currentPlan: plan,
            code: 'PLAN_REQUIRED',
          },
          { status: 403 },
        ),
      };
    }
  }

  // Check required feature
  if (options.requiredFeature) {
    if (!canAccessFeature(plan, options.requiredFeature)) {
      logServerEvent('info', 'entitlement.feature_denied', {
        userId: authResult.auth.walletUserId,
        userPlan: plan,
        requiredFeature: options.requiredFeature,
        path: request.nextUrl.pathname,
      });

      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            error: 'This feature is not available on your current plan.',
            requiredFeature: options.requiredFeature,
            currentPlan: plan,
            code: 'FEATURE_REQUIRED',
          },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true, ctx };
}
