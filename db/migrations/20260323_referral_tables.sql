-- Referral attribution and conversion tracking tables
-- Required by lib/server/referrals.ts (attributeReferral, recordReferralConversion, getReferralStats)

CREATE TABLE IF NOT EXISTS referral_attributions (
    id TEXT PRIMARY KEY,
    referrer_user_id TEXT NOT NULL,
    referred_user_id TEXT NOT NULL UNIQUE,
    referral_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer
    ON referral_attributions (referrer_user_id);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_code
    ON referral_attributions (referral_code);

CREATE TABLE IF NOT EXISTS referral_conversions (
    id TEXT PRIMARY KEY,
    referrer_user_id TEXT NOT NULL,
    referred_user_id TEXT NOT NULL UNIQUE,
    referred_plan TEXT NOT NULL,
    stripe_event_id TEXT NOT NULL UNIQUE,
    month_key TEXT NOT NULL,
    referral_number_for_month INTEGER NOT NULL,
    commission_rate NUMERIC(5, 2) NOT NULL,
    plan_price NUMERIC(14, 2) NOT NULL,
    payout_amount NUMERIC(14, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_conversions_referrer_month
    ON referral_conversions (referrer_user_id, month_key);

CREATE INDEX IF NOT EXISTS idx_referral_conversions_referred
    ON referral_conversions (referred_user_id);
