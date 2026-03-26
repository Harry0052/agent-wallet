import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/server/authCookies';
import { revokeCurrentSessionFromCookies, getAuthenticatedUser } from '@/lib/server/auth';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'auth_session' });
  if (rateLimited) return rateLimited;

  const meta = extractRequestMeta(req);
  const currentUser = await getAuthenticatedUser();

  await revokeCurrentSessionFromCookies();

  if (currentUser) {
    await recordAccountAuditEvent({
      userId: currentUser.appUserId,
      action: 'logout',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
