import 'server-only';

import { redirect, unstable_rethrow } from 'next/navigation';
import { getAuthenticatedUser, type AuthenticatedUser } from '@/lib/server/auth';
import { getPostAuthRedirectPath, isOnboardingComplete } from '@/lib/server/onboarding';
import { getUserSubscription, getBillingState } from '@/lib/server/billing';

async function resolveAuthenticatedUserOrRedirect(loginRedirect: string): Promise<AuthenticatedUser> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      redirect(loginRedirect);
    }
    return user;
  } catch (error) {
    unstable_rethrow(error);
    console.error('[authGuards] failed to resolve authenticated user', error);
    redirect(loginRedirect);
  }
}

export async function requirePageAuth(loginRedirect = '/login'): Promise<void> {
  await resolveAuthenticatedUserOrRedirect(loginRedirect);
}

export async function redirectAuthenticatedUser(home = '/home'): Promise<void> {
  try {
    const user = await getAuthenticatedUser();
    if (user) {
      const target = home === '/home'
        ? await getPostAuthRedirectPath(user.appUserId)
        : home;
      redirect(target);
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error('[authGuards] failed to resolve post-auth redirect', error);
  }
}

export async function requireAuthenticatedAppAccess(input?: {
  loginRedirect?: string;
  onboardingRedirect?: string;
  plansRedirect?: string;
}): Promise<AuthenticatedUser> {
  const loginRedirect = input?.loginRedirect || '/login';
  const plansRedirect = input?.plansRedirect || '/plans';
  const onboardingRedirect = input?.onboardingRedirect || '/onboarding';
  const user = await resolveAuthenticatedUserOrRedirect(loginRedirect);

  try {
    // Check plan first — users must have an active subscription
    const sub = await getUserSubscription(user.appUserId);
    const billing = getBillingState(sub);
    if (!billing.isActive) {
      redirect(plansRedirect);
    }

    // Then check onboarding
    const complete = await isOnboardingComplete(user.appUserId);
    if (!complete) {
      redirect(onboardingRedirect);
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error('[authGuards] failed to resolve app access state', error);
    redirect(loginRedirect);
  }

  return user;
}

export async function requireOnboardingCompleted(redirectPath = '/onboarding'): Promise<void> {
  const user = await resolveAuthenticatedUserOrRedirect('/login');
  try {
    const complete = await isOnboardingComplete(user.appUserId);
    if (!complete) {
      redirect(redirectPath);
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error('[authGuards] failed to resolve onboarding state', error);
    redirect('/login');
  }
}

export async function requirePendingOnboarding(doneRedirect = '/home'): Promise<void> {
  const user = await resolveAuthenticatedUserOrRedirect('/login');
  try {
    const complete = await isOnboardingComplete(user.appUserId);
    if (complete) {
      redirect(doneRedirect);
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error('[authGuards] failed to resolve onboarding state', error);
    redirect('/login');
  }
}
