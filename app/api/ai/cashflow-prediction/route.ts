import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { predictCashFlow } from '@/lib/server/engines/cashFlowEngine';

export async function GET(request: NextRequest) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const authResult = await enforceApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const result = await predictCashFlow(authResult.auth.walletUserId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Cash flow prediction failed.';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
