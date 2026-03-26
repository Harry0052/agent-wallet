import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { createPortalSession } from '@/lib/server/billing';
import { apiError, logServerEvent } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'billing' });
  if (rateLimited) return rateLimited;

  try {
    const user = await requireAuthenticatedUser();

    const origin = req.headers.get('origin') || req.nextUrl.origin;
    const returnUrl = `${origin}/settings`;

    const portalUrl = await createPortalSession({
      userId: user.appUserId,
      returnUrl,
    });

    logServerEvent('info', 'billing.portal.created', {
      userId: user.appUserId,
    });

    return NextResponse.json({ ok: true, url: portalUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Portal session failed';
    logServerEvent('error', 'billing.portal.failed', { error: message });

    if (message.includes('Authentication required')) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Please sign in first', false),
        { status: 401 },
      );
    }

    return NextResponse.json(
      apiError('STRIPE_FAILURE', message, true),
      { status: 500 },
    );
  }
}
