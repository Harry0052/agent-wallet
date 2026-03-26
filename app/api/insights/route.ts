import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError } from '@/lib/server/auth';
import { query } from '@/lib/server/db';
import { apiError, logServerEvent } from '@/lib/server/observability';
import { enforceEntitlement } from '@/security/entitlementGuard';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'insights' });
  if (rateLimited) return rateLimited;

  const guard = await enforceEntitlement(req, {
    requiredFeature: 'basic_insights',
    rateLimitScope: 'insights',
  });
  if (!guard.ok) return guard.response;

  try {
    const userId = guard.ctx.auth.walletUserId;
    const result = await query(
      `SELECT * FROM insights WHERE user_id = $1 AND status = 'active' ORDER BY generated_at DESC LIMIT 50`,
      [userId],
    );

    const insights = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      userId: row.user_id,
      insightType: row.insight_type,
      title: row.title,
      summary: row.summary,
      detail: row.detail ?? {},
      severity: row.severity,
      status: row.status,
      relatedMerchant: row.related_merchant,
      amountImpact: row.amount_impact ? Number(row.amount_impact) : undefined,
      generatedAt: row.generated_at,
      dismissedAt: row.dismissed_at,
    }));

    return NextResponse.json({ ok: true, insights });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to load insights';
    logServerEvent('error', 'insights.list.failed', { message });
    return NextResponse.json(apiError('VALIDATION_ERROR', message, true), { status: 500 });
  }
}

const PatchSchema = z.object({
  id: z.string().trim().min(1),
  action: z.enum(['dismiss', 'act']),
});

export async function PATCH(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'insights' });
  if (rateLimited) return rateLimited;

  const guard = await enforceEntitlement(req, {
    requiredFeature: 'basic_insights',
    rateLimitScope: 'insights',
  });
  if (!guard.ok) return guard.response;

  try {
    const userId = guard.ctx.auth.walletUserId;
    const body = PatchSchema.parse(await req.json());

    const newStatus = body.action === 'dismiss' ? 'dismissed' : 'acted_on';
    await query(
      `UPDATE insights SET status = $1, dismissed_at = NOW() WHERE id = $2 AND user_id = $3`,
      [newStatus, body.id, userId],
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to update insight';
    logServerEvent('error', 'insights.patch.failed', { message });
    return NextResponse.json(apiError('VALIDATION_ERROR', message, true), { status: 500 });
  }
}
