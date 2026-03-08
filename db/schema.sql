CREATE TABLE IF NOT EXISTS wallet_users (
  user_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'usd',
  settings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_recipients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stripe_account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stripe_account_id TEXT NOT NULL,
  default_currency TEXT NOT NULL DEFAULT 'usd',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipients_user_name
ON recipients (user_id, lower(name));

CREATE TABLE IF NOT EXISTS user_autofill_profiles (
  user_id TEXT PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  company_name TEXT,
  billing_name TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state_region TEXT,
  postal_code TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  provider_reference_id TEXT,
  description TEXT NOT NULL,
  source_url TEXT,
  merchant TEXT,
  recipient_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_created_at
ON ledger_entries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_provider_reference
ON ledger_entries (provider_reference_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO recipients (id, user_id, name, stripe_account_id, default_currency, created_at)
SELECT id, user_id, name, stripe_account_id, 'usd', created_at
FROM wallet_recipients
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS web_action_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT,
  action_type TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_action_logs_task_created_at
ON web_action_logs (task_id, created_at ASC);

CREATE TABLE IF NOT EXISTS approval_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procurement_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  goal TEXT NOT NULL,
  budget_limit NUMERIC(12, 2),
  category TEXT,
  target_vendors JSONB,
  comparison_criteria JSONB,
  must_have_features JSONB,
  findings JSONB,
  recommendation JSONB,
  planning_output JSONB NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_tasks_user_created_at
ON procurement_tasks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS procurement_findings (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  pricing_page_url TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  monthly_price NUMERIC(12, 2),
  annual_price NUMERIC(12, 2),
  billing_frequency TEXT NOT NULL,
  content_availability TEXT,
  notes TEXT,
  notable_features JSONB NOT NULL,
  extraction_timestamp TIMESTAMPTZ NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_findings_task_created_at
ON procurement_findings (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  evidence_urls JSONB NOT NULL,
  projected_savings NUMERIC(12, 2),
  projected_savings_basis TEXT,
  currency TEXT,
  renewal_date TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_actions_user_task_created_at
ON subscription_actions (user_id, task_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_actions_running_operation
ON subscription_actions (user_id, task_id, operation)
WHERE status = 'running';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_procurement_tasks_status') THEN
    ALTER TABLE procurement_tasks
      ADD CONSTRAINT chk_procurement_tasks_status
      CHECK (status IN (
        'planning',
        'planned',
        'needs_clarification',
        'researching',
        'researched',
        'comparing',
        'awaiting_approval',
        'purchase_preparing',
        'purchase_prepared',
        'rejected',
        'failed'
      )) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_actions_status') THEN
    ALTER TABLE subscription_actions
      ADD CONSTRAINT chk_subscription_actions_status
      CHECK (status IN ('running', 'completed', 'blocked', 'failed')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_actions_operation') THEN
    ALTER TABLE subscription_actions
      ADD CONSTRAINT chk_subscription_actions_operation
      CHECK (operation IN ('inspect_billing', 'renewal_check', 'downgrade', 'cancel', 'switch_billing')) NOT VALID;
  END IF;
END $$;
