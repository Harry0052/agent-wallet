import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { getUserPersona } from '@/lib/server/persona';
import { apiError } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'persona' });
  if (rateLimited) return rateLimited;

  try {
    const user = await requireAuthenticatedUser();
    const persona = await getUserPersona(user.appUserId);

    return NextResponse.json({
      ok: true,
      persona: persona || null,
      hasPersona: !!persona?.onboardingCompleted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch persona';
    if (message.includes('Authentication required')) {
      return NextResponse.json(apiError('VALIDATION_ERROR', message, false), { status: 401 });
    }
    return NextResponse.json(apiError('UNKNOWN_FAILURE', message, true), { status: 500 });
  }
}
