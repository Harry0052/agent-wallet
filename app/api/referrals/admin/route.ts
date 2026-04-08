import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { logServerEvent } from '@/lib/server/observability';
import {
  getAdminReferralRecords,
  updatePayoutStatus,
  flagReferralForReview,
} from '@/lib/server/referrals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/referrals/admin — List all referral records for admin review
// Query params: limit, offset, status (optional filter)
export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'referrals-admin' });
  if (rateLimited) return rateLimited;

  // Require admin role
  const auth = await enforceApiAuth(req, { requiredRoles: ['admin'] });
  if (!auth.ok) return auth.response;

  try {
    const limit = Number(req.nextUrl.searchParams.get('limit') || '50');
    const offset = Number(req.nextUrl.searchParams.get('offset') || '0');
    const status = req.nextUrl.searchParams.get('status') || undefined;

    const result = await getAdminReferralRecords({ limit, offset, status });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load admin referral data';
    logServerEvent('error', 'referrals.admin.list.failed', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// PATCH /api/referrals/admin — Update payout status or flag for review
const PatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_payout_status'),
    payoutId: z.string().min(1),
    newStatus: z.enum(['pending_review', 'approved', 'paid', 'rejected']),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('flag_for_review'),
    conversionId: z.string().min(1),
    reviewFlag: z.boolean(),
    notes: z.string().max(500).optional(),
  }),
]);

export async function PATCH(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'referrals-admin' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req, { requiredRoles: ['admin'] });
  if (!auth.ok) return auth.response;

  try {
    const body = PatchSchema.parse(await req.json());

    if (body.action === 'update_payout_status') {
      const result = await updatePayoutStatus({
        payoutId: body.payoutId,
        newStatus: body.newStatus,
        notes: body.notes,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'flag_for_review') {
      const result = await flagReferralForReview({
        conversionId: body.conversionId,
        reviewFlag: body.reviewFlag,
        notes: body.notes,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : 'Admin action failed';
    logServerEvent('error', 'referrals.admin.patch.failed', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
