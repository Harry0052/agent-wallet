import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { buildSmartHomePayload } from '@/lib/server/smartHome';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'smart_home' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const payload = await buildSmartHomePayload(auth.auth.walletUserId);
    return NextResponse.json({ ok: true, home: payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Calico home';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'smart.home.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
