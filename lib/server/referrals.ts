import 'server-only';

import { randomBytes } from 'node:crypto';
import { query } from '@/lib/server/db';
import type { PlanId } from '@/lib/server/billing';
import { logServerEvent } from '@/lib/server/observability';

// ── Plan prices (must match billing.ts PLANS) ──────────────────────────────

const PLAN_PRICES: Record<PlanId, number> = {
  starter: 8.99,
  pro: 29.99,
  autonomous: 89.99,
};

// ── Referral code generation ────────────────────────────────────────────────

export function generateReferralCode(userId: string): string {
  // Deterministic from user ID — stable across calls
  return userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
}

// ── Attribution ─────────────────────────────────────────────────────────────

export async function attributeReferral(params: {
  referralCode: string;
  referredUserId: string;
}): Promise<void> {
  const { referralCode, referredUserId } = params;
  if (!referralCode || !referredUserId) return;

  // Find the referrer by their code
  // The code is derived from user ID, so we search app_users
  const result = await query<{ id: string }>(
    `SELECT id FROM app_users
     WHERE UPPER(REPLACE(id, '-', '')) LIKE $1 || '%'
     LIMIT 1`,
    [referralCode.toUpperCase().replace(/[^A-Z0-9]/g, '')],
  );

  // Fallback: try matching the code directly against all user IDs
  if (!result.rows[0]) {
    const allUsers = await query<{ id: string }>(
      `SELECT id FROM app_users`,
    );
    const match = allUsers.rows.find(
      (u) => generateReferralCode(u.id) === referralCode.toUpperCase(),
    );
    if (!match) {
      logServerEvent('info', 'referral.attribution.code_not_found', { referralCode });
      return;
    }
    result.rows[0] = match;
  }

  const referrerUserId = result.rows[0].id;

  // Block self-referrals
  if (referrerUserId === referredUserId) {
    logServerEvent('info', 'referral.attribution.self_referral_blocked', {
      userId: referredUserId,
      referralCode,
    });
    return;
  }

  // Insert attribution (UNIQUE on referred_user_id prevents overwrites)
  try {
    await query(
      `INSERT INTO referral_attributions (id, referrer_user_id, referred_user_id, referral_code, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (referred_user_id) DO NOTHING`,
      [
        `rattr_${randomBytes(12).toString('hex')}`,
        referrerUserId,
        referredUserId,
        referralCode,
      ],
    );

    logServerEvent('info', 'referral.attribution.created', {
      referrerUserId,
      referredUserId: referredUserId,
      referralCode,
    });
  } catch (error) {
    logServerEvent('warn', 'referral.attribution.failed', {
      referredUserId,
      referralCode,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

// ── Conversion tracking (called from webhook) ──────────────────────────────

export async function recordReferralConversion(params: {
  referredUserId: string;
  plan: PlanId;
  stripeEventId: string;
}): Promise<void> {
  const { referredUserId, plan, stripeEventId } = params;

  // Find attribution for this referred user
  const attr = await query<{ referrer_user_id: string }>(
    `SELECT referrer_user_id FROM referral_attributions WHERE referred_user_id = $1`,
    [referredUserId],
  );

  if (!attr.rows[0]) return; // Not a referred user

  const referrerUserId = attr.rows[0].referrer_user_id;

  // Check if already converted (UNIQUE on referred_user_id and stripe_event_id prevents dupes)
  const existing = await query<{ id: string }>(
    `SELECT id FROM referral_conversions WHERE referred_user_id = $1`,
    [referredUserId],
  );

  if (existing.rows[0]) {
    logServerEvent('info', 'referral.conversion.already_recorded', {
      referredUserId,
      stripeEventId,
    });
    return;
  }

  // Compute month key and referral number for this month
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM referral_conversions
     WHERE referrer_user_id = $1 AND month_key = $2`,
    [referrerUserId, monthKey],
  );

  const previousCount = Number(countResult.rows[0]?.count || '0');
  const referralNumber = previousCount + 1;

  // Commission: 50% for referrals 1-9, 100% for 10+
  const commissionRate = referralNumber >= 10 ? 1.0 : 0.5;
  const planPrice = PLAN_PRICES[plan] ?? PLAN_PRICES.starter;
  const payoutAmount = Math.round(planPrice * commissionRate * 100) / 100;

  try {
    await query(
      `INSERT INTO referral_conversions (
        id, referrer_user_id, referred_user_id, referred_plan,
        stripe_event_id, month_key, referral_number_for_month,
        commission_rate, plan_price, payout_amount, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW())
      ON CONFLICT (referred_user_id) DO NOTHING`,
      [
        `rconv_${randomBytes(12).toString('hex')}`,
        referrerUserId,
        referredUserId,
        plan,
        stripeEventId,
        monthKey,
        referralNumber,
        commissionRate,
        planPrice,
        payoutAmount,
      ],
    );

    logServerEvent('info', 'referral.conversion.recorded', {
      referrerUserId,
      referredUserId,
      plan,
      monthKey,
      referralNumber,
      commissionRate,
      payoutAmount,
    });
  } catch (error) {
    logServerEvent('error', 'referral.conversion.failed', {
      referredUserId,
      stripeEventId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

// ── Stats for frontend ──────────────────────────────────────────────────────

export interface ReferralStats {
  referralCode: string;
  referralLink: string;
  monthKey: string;
  monthlyConversions: number;
  currentTier: '50%' | '100%';
  conversionsToNextTier: number;
  monthlyEarnings: number;
  totalEarnings: number;
  pendingSignups: number;
  recentConversions: Array<{
    plan: string;
    payoutAmount: number;
    commissionRate: number;
    createdAt: string;
  }>;
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const referralCode = generateReferralCode(userId);

  // Monthly conversions
  const monthResult = await query<{ count: string; total: string }>(
    `SELECT COUNT(*)::text AS count, COALESCE(SUM(payout_amount), 0)::text AS total
     FROM referral_conversions
     WHERE referrer_user_id = $1 AND month_key = $2`,
    [userId, monthKey],
  );

  const monthlyConversions = Number(monthResult.rows[0]?.count || '0');
  const monthlyEarnings = Number(monthResult.rows[0]?.total || '0');

  // Total earnings (all time)
  const totalResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(payout_amount), 0)::text AS total
     FROM referral_conversions
     WHERE referrer_user_id = $1`,
    [userId],
  );
  const totalEarnings = Number(totalResult.rows[0]?.total || '0');

  // Pending signups (attributed but not yet converted)
  const pendingResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM referral_attributions ra
     WHERE ra.referrer_user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM referral_conversions rc
         WHERE rc.referred_user_id = ra.referred_user_id
       )`,
    [userId],
  );
  const pendingSignups = Number(pendingResult.rows[0]?.count || '0');

  // Recent conversions (last 10)
  const recentResult = await query<{
    referred_plan: string;
    payout_amount: string;
    commission_rate: string;
    created_at: string;
  }>(
    `SELECT referred_plan, payout_amount::text, commission_rate::text, created_at::text
     FROM referral_conversions
     WHERE referrer_user_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId],
  );

  const currentTier = monthlyConversions >= 10 ? '100%' : '50%';
  const conversionsToNextTier = monthlyConversions >= 10 ? 0 : 10 - monthlyConversions;

  // Use window.location.origin on client; hardcode base for server
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://calico.app';

  return {
    referralCode,
    referralLink: `${baseUrl}/signup?ref=${referralCode}`,
    monthKey,
    monthlyConversions,
    currentTier,
    conversionsToNextTier,
    monthlyEarnings: Math.round(monthlyEarnings * 100) / 100,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    pendingSignups,
    recentConversions: recentResult.rows.map((r) => ({
      plan: r.referred_plan,
      payoutAmount: Number(r.payout_amount),
      commissionRate: Number(r.commission_rate),
      createdAt: r.created_at,
    })),
  };
}
