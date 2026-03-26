import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { createCheckoutSession, PLANS, type PlanId } from '@/lib/server/billing';
import { apiError, logServerEvent } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CheckoutSchema = z.object({
  plan: z.enum(['starter', 'pro', 'autonomous']),
});

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'billing' });
  if (rateLimited) return rateLimited;

  try {
    const user = await requireAuthenticatedUser();

    const body = await req.json();
    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Invalid plan selected', false),
        { status: 400 },
      );
    }

    const { plan } = parsed.data;

    if (!PLANS[plan as PlanId]) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Unknown plan', false),
        { status: 400 },
      );
    }

    const origin = req.headers.get('origin') || req.nextUrl.origin;
    // After first checkout, route to onboarding. For upgrades, route to settings.
    const { isOnboardingComplete } = await import('@/lib/server/onboarding');
    const onboardingDone = await isOnboardingComplete(user.appUserId);
    const successUrl = onboardingDone
      ? `${origin}/settings?billing=success`
      : `${origin}/onboarding?billing=success`;
    const cancelUrl = onboardingDone
      ? `${origin}/settings?billing=cancelled`
      : `${origin}/plans?billing=cancelled`;

    const checkoutUrl = await createCheckoutSession({
      userId: user.appUserId,
      email: user.email,
      plan: plan as PlanId,
      successUrl,
      cancelUrl,
    });

    logServerEvent('info', 'billing.checkout.created', {
      userId: user.appUserId,
      plan,
    });

    return NextResponse.json({ ok: true, url: checkoutUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Checkout failed';
    logServerEvent('error', 'billing.checkout.failed', { error: message });

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
