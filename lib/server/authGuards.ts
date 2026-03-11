import 'server-only';

import { redirect } from 'next/navigation';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { getPostAuthRedirectPath, isOnboardingComplete } from '@/lib/server/onboarding';

export async function requirePageAuth(loginRedirect = '/login'): Promise<void> {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect(loginRedirect);
  }
}

export async function redirectAuthenticatedUser(home = '/operator'): Promise<void> {
  const user = await getAuthenticatedUser();
  if (user) {
    const target = home === '/operator'
      ? await getPostAuthRedirectPath(user.appUserId)
      : home;
    redirect(target);
  }
}

export async function requireOnboardingCompleted(redirectPath = '/onboarding'): Promise<void> {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect('/login');
  }

  const complete = await isOnboardingComplete(user.appUserId);
  if (!complete) {
    redirect(redirectPath);
  }
}

export async function requirePendingOnboarding(doneRedirect = '/operator'): Promise<void> {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect('/login');
  }

  const complete = await isOnboardingComplete(user.appUserId);
  if (complete) {
    redirect(doneRedirect);
  }
}
