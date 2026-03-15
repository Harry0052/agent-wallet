import { NextRequest, NextResponse } from 'next/server';
import { isAuthError } from '@/lib/server/auth';
import { generateInsights } from '@/lib/server/engines/insightEngine';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'insights_generate' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
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
