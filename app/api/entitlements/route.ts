import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { getUserSubscription, getBillingState } from '@/lib/server/billing';
import { getAvailableFeatures, getLockedFeatures, PLAN_TUTORIALS } from '@/lib/server/entitlements';
import { apiError } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'billing' });
  if (rateLimited) return rateLimited;

  try {
    const user = await requireAuthenticatedUser();
    const sub = await getUserSubscription(user.appUserId);
    const billing = getBillingState(sub);

    return NextResponse.json({
      ok: true,
      plan: billing.plan,
      isActive: billing.isActive,
      available: getAvailableFeatures(billing.plan).map((f) => f.key),
      locked: getLockedFeatures(billing.plan).map((f) => ({
        key: f.key,
        label: f.label,
        description: f.description,
        minimumPlan: f.minimumPlan,
      })),
      tutorial: billing.plan ? PLAN_TUTORIALS[billing.plan] : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch entitlements';
    if (message.includes('Authentication required')) {
      return NextResponse.json(apiError('VALIDATION_ERROR', message, false), { status: 401 });
    }
    return NextResponse.json(apiError('UNKNOWN_FAILURE', message, true), { status: 500 });
  }
}
