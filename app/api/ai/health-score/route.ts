import { NextRequest, NextResponse } from 'next/server';
import { enforceEntitlement } from '@/security/entitlementGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { computeHealthScore } from '@/lib/server/engines/healthScoreEngine';

export async function GET(request: NextRequest) {
  const rateLimited = enforceRateLimit(request, { profile: 'ai', scope: 'ai_health_score' });
  if (rateLimited) return rateLimited;

  const guard = await enforceEntitlement(request, {
    requiredFeature: 'advanced_insights',
    rateLimitScope: 'ai_health',
  });
  if (!guard.ok) return guard.response;

  try {
    const result = await computeHealthScore(guard.ctx.auth.walletUserId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Health score computation failed.';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
