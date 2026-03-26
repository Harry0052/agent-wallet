import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireAuthenticatedUser } from '@/lib/server/auth';
import { getUserAutofillProfile, getWallet } from '@/lib/server/ledger';
import {
  completeOnboarding,
  getOnboardingState,
  updateOnboardingState,
  type OnboardingStep,
} from '@/lib/server/onboarding';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  step: z.enum(['welcome', 'wallet', 'profile', 'tools']).optional(),
  complete: z.boolean().optional(),
  skippedToolSetup: z.boolean().optional(),
  preferencesPatch: z.record(z.string(), z.unknown()).optional(),
});

function payloadStatusToCode(error: unknown): number {
  if (error instanceof z.ZodError) return 400;
  if (isAuthError(error)) return error.status;
  return 500;
}

function payloadErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join('; ');
  }
  if (isAuthError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'onboarding' });
  if (rateLimited) return rateLimited;

  try {
    const user = await requireAuthenticatedUser();
    const [onboarding, profile, wallet] = await Promise.all([
      getOnboardingState(user.appUserId),
      getUserAutofillProfile(user.walletUserId),
      getWallet(user.walletUserId),
    ]);

    const profileReady = Boolean(profile?.fullName || profile?.email);

    return NextResponse.json({
      ok: true,
      onboarding: {
        step: onboarding.step,
        completedAt: onboarding.completedAt,
        skippedToolSetup: onboarding.skippedToolSetup,
        preferences: onboarding.preferences,
      },
      user: {
        email: user.email,
      },
      setup: {
        walletInitialized: Boolean(wallet),
        profileReady,
      },
      profile,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: payloadErrorMessage(error, 'Failed to load onboarding state'),
    }, { status: payloadStatusToCode(error) });
  }
}

export async function PATCH(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'onboarding' });
  if (rateLimited) return rateLimited;

  try {
    const user = await requireAuthenticatedUser();
    const body = PatchSchema.parse(await req.json());

    const state = body.complete
      ? await completeOnboarding({
        appUserId: user.appUserId,
        skippedToolSetup: body.skippedToolSetup,
        preferencesPatch: body.preferencesPatch,
      })
      : await updateOnboardingState({
        appUserId: user.appUserId,
        step: body.step as Exclude<OnboardingStep, 'complete'> | undefined,
        skippedToolSetup: body.skippedToolSetup,
        preferencesPatch: body.preferencesPatch,
      });

    return NextResponse.json({
      ok: true,
      onboarding: {
        step: state.step,
        completedAt: state.completedAt,
        skippedToolSetup: state.skippedToolSetup,
        preferences: state.preferences,
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: payloadErrorMessage(error, 'Failed to update onboarding state'),
    }, { status: payloadStatusToCode(error) });
  }
}
