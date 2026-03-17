import { NextRequest, NextResponse } from 'next/server';
import { enforceEntitlement } from '@/security/entitlementGuard';
import { predictCashFlow } from '@/lib/server/engines/cashFlowEngine';

export async function GET(request: NextRequest) {
  const guard = await enforceEntitlement(request, {
    requiredFeature: 'cashflow_forecast',
    rateLimitScope: 'ai_cashflow',
  });
  if (!guard.ok) return guard.response;

  try {
    const result = await predictCashFlow(guard.ctx.auth.walletUserId);
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
