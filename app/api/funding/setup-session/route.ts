import { NextRequest, NextResponse } from 'next/server';
import { getWalletUserId } from '@/lib/server/ledger';
import { createSetupCheckoutSession } from '@/lib/server/fundingStripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      consentSource?: string;
      consentVersion?: string;
    };

    const userId = await getWalletUserId();
    const session = await createSetupCheckoutSession({
      userId,
      origin: req.nextUrl.origin,
      consentMetadata: {
        consentSource: body.consentSource || 'wallet_page',
        consentVersion: body.consentVersion || 'v1',
      },
    });

    return NextResponse.json({
      ok: true,
      checkoutUrl: session.checkoutUrl,
      sessionId: session.sessionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create setup session';
    const classified = classifyTaskError({ message });
    const errorCode = classified === 'UNKNOWN_FAILURE' ? 'STRIPE_FAILURE' : classified;
    logServerEvent('error', 'funding.setup_session.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
