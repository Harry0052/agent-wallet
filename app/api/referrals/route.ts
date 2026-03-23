import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { getReferralStats } from '@/lib/server/referrals';
import { logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'referrals' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const stats = await getReferralStats(auth.auth.appUserId);
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load referral stats';
    logServerEvent('error', 'referrals.stats.failed', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
