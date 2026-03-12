import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/server/authCookies';
import { revokeCurrentSessionFromCookies, getAuthenticatedUser } from '@/lib/server/auth';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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
