import { createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isAuthError, requireAuthenticatedUser } from '@/lib/server/auth';

export const runtime = 'nodejs';

function referralCodeForUser(appUserId: string): string {
  const secret = process.env.REFERRAL_CODE_SECRET
    || process.env.AUTH_SESSION_SECRET
    || 'agent-wallet-referral-default';

  const digest = createHmac('sha256', secret)
    .update(appUserId)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();

  return `AW${digest}`;
}

function appOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, '');
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser();
    const code = referralCodeForUser(user.appUserId);
    const shareUrl = `${appOrigin(req)}/signup?ref=${encodeURIComponent(code)}`;

    return NextResponse.json({
      ok: true,
      referral: {
        code,
        shareUrl,
        status: 'pilot',
        rewardText: 'Pilot referral credits are reviewed manually during launch testing.',
        inviteMessage: `Join me on Agent Wallet using my referral link: ${shareUrl}`,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load referral program',
    }, { status: 500 });
  }
}
