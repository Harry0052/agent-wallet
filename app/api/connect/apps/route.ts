import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { listConnectedApps } from '@/lib/server/connectedApps';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'connect_apps' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const apps = await listConnectedApps(auth.auth.walletUserId);
    return NextResponse.json({ ok: true, apps });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load connected apps';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'connect.apps.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
