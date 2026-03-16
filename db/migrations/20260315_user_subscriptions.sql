-- Calico billing: stores each user's Stripe subscription state.
-- One row per user. Updated by webhook events.

CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'incomplete',
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  last_webhook_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer
ON user_subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_sub
ON user_subscriptions (stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;
