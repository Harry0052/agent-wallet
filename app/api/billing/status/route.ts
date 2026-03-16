import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { getUserSubscription, getBillingState, PLANS } from '@/lib/server/billing';
import { apiError } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireAuthenticatedUser();
    const sub = await getUserSubscription(user.appUserId);
    const billing = getBillingState(sub);

    return NextResponse.json({
      ok: true,
      billing: {
        ...billing,
        planName: billing.plan ? PLANS[billing.plan].name : null,
        priceMonthly: billing.plan ? PLANS[billing.plan].priceMonthly : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch billing status';

    if (message.includes('Authentication required')) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Please sign in first', false),
        { status: 401 },
      );
    }

    return NextResponse.json(
      apiError('UNKNOWN_FAILURE', message, true),
      { status: 500 },
    );
  }
}
