import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { buildSmartHomePayload } from '@/lib/server/smartHome';
import { getUserSubscription, getBillingState } from '@/lib/server/billing';
import { generateActionableInsights } from '@/lib/server/actionableInsights';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'smart_home' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    // Sequential: smartHome uses the DB connection intensively (8 queries).
    // Running getUserSubscription in parallel would contend for the same connection.
    const payload = await withTimeout(
      buildSmartHomePayload(auth.auth.walletUserId),
      25_000,
      'buildSmartHomePayload',
    );

    let subscription = null;
    try {
      subscription = await getUserSubscription(auth.auth.walletUserId);
    } catch { /* use null — insights will show starter-tier defaults */ }

    const billing = getBillingState(subscription);
    payload.actionableInsights = generateActionableInsights(payload, billing.plan);

    return NextResponse.json({ ok: true, home: payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Agent Wallet home';
    const stack = error instanceof Error ? error.stack?.slice(0, 500) : undefined;
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'smart.home.failed', { errorCode, message, stack });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
