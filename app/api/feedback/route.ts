import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'feedback' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  let body: { message?: unknown; category?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const category = typeof body.category === 'string' ? body.category : 'general';

  if (!message || message.length > 2000) {
    return NextResponse.json(
      { ok: false, error: 'Feedback must be between 1 and 2000 characters.' },
      { status: 400 },
    );
  }

  const validCategories = ['general', 'feature_request', 'bug', 'praise'];
  if (!validCategories.includes(category)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid category.' },
      { status: 400 },
    );
  }

  logServerEvent('info', 'feedback.submitted', {
    userId: auth.auth.walletUserId,
    category,
    messageLength: message.length,
    // Do not log the message body — may contain PII
  });

  return NextResponse.json({ ok: true });
}
