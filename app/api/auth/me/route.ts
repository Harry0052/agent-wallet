import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { getOnboardingState } from '@/lib/server/onboarding';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({
      ok: false,
      authenticated: false,
    }, { status: 401 });
  }

  const onboarding = await getOnboardingState(user.appUserId);

  return NextResponse.json({
    ok: true,
    authenticated: true,
    user: {
      appUserId: user.appUserId,
      walletUserId: user.walletUserId,
      email: user.email,
      expiresAt: user.expiresAt,
      onboarding: {
        step: onboarding.step,
        completedAt: onboarding.completedAt,
        skippedToolSetup: onboarding.skippedToolSetup,
      },
    },
  });
}
