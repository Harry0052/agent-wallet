import { NextRequest, NextResponse } from 'next/server';
import { getWalletUserId } from '@/lib/server/ledger';
import { createFundingSetupIntent } from '@/lib/server/fundingStripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

function getStripePublishableKey(): string {
  const fromPublic = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (fromPublic && fromPublic.trim()) return fromPublic.trim();

  const fromServer = process.env.STRIPE_PUBLISHABLE_KEY;
  if (fromServer && fromServer.trim()) return fromServer.trim();

  throw new Error('Missing Stripe publishable key');
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'funding' });
  if (rateLimited) return rateLimited;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      consentSource?: string;
      consentVersion?: string;
    };

    const userId = await getWalletUserId();
    const setup = await createFundingSetupIntent({
      userId,
      consentMetadata: {
        consentSource: body.consentSource || 'wallet_page',
        consentVersion: body.consentVersion || 'v1',
      },
    });

    return NextResponse.json({
      ok: true,
      clientSecret: setup.clientSecret,
      setupIntentId: setup.setupIntentId,
      publishableKey: getStripePublishableKey(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create setup intent';
    const classified = classifyTaskError({ message });
    const errorCode = classified === 'UNKNOWN_FAILURE' ? 'STRIPE_FAILURE' : classified;
    logServerEvent('error', 'funding.setup_intent.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
