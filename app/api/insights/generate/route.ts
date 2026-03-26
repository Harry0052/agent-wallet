import { NextRequest, NextResponse } from 'next/server';
import { isAuthError } from '@/lib/server/auth';
import { generateInsights } from '@/lib/server/engines/insightEngine';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceEntitlement } from '@/security/entitlementGuard';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'ai', scope: 'insights_generate' });
  if (rateLimited) return rateLimited;

  const guard = await enforceEntitlement(req, {
    requiredFeature: 'advanced_insights',
    rateLimitScope: 'insights_generate',
  });
  if (!guard.ok) return guard.response;

  try {
    const userId = guard.ctx.auth.walletUserId;
    const result = await generateInsights(userId);

    logServerEvent('info', 'insights.generate.success', {
      userId,
      insightsCreated: result.insightsCreated,
      insightsDeduped: result.insightsDeduped,
      latencyMs: result.latencyMs,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', error.message, true),
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to generate insights';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'insights.generate.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
