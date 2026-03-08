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
