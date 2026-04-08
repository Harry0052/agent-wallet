-- Referral payouts table and review flags
-- Required by: lib/server/referrals.ts (referral payout workflow, admin review)

-- Add review_flag and notes columns to referral_conversions for fraud detection
ALTER TABLE referral_conversions ADD COLUMN IF NOT EXISTS review_flag BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE referral_conversions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE referral_conversions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Referral payouts: tracks the admin-reviewed payout lifecycle
CREATE TABLE IF NOT EXISTS referral_payouts (
    id TEXT PRIMARY KEY,
    referrer_user_id TEXT NOT NULL,
    referral_conversion_id TEXT NOT NULL UNIQUE,
    amount NUMERIC(14, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'pending_review',  -- pending_review | approved | paid | rejected
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referral_payouts_referrer
    ON referral_payouts (referrer_user_id);

CREATE INDEX IF NOT EXISTS idx_referral_payouts_status
    ON referral_payouts (status);

-- RLS
ALTER TABLE referral_payouts ENABLE ROW LEVEL SECURITY;
