-- Multi-tenant data foundation:
-- - fills schema drift for tool connection tables
-- - adds app-level per-user settings
-- - adds auth token lifecycle indexes
-- - backfills onboarding/settings rows for existing users

CREATE INDEX IF NOT EXISTS idx_app_password_reset_tokens_user_expires
ON app_password_reset_tokens (user_id, expires_at DESC)
WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_password_reset_tokens_expires
ON app_password_reset_tokens (expires_at)
WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_email_verification_tokens_user_expires
ON app_email_verification_tokens (user_id, expires_at DESC)
WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS app_user_settings (
  user_id TEXT PRIMARY KEY,
  locale TEXT NOT NULL DEFAULT 'en-US',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  dashboard_default_view TEXT NOT NULL DEFAULT 'operator',
  security JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
  notifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_user_settings_updated
ON app_user_settings (updated_at DESC);

CREATE TABLE IF NOT EXISTS tools_catalog (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT,
  icon_name TEXT,
  homepage_url TEXT,
  login_url TEXT,
  signup_url TEXT,
  supports_oauth BOOLEAN NOT NULL DEFAULT FALSE,
  supports_password_login BOOLEAN NOT NULL DEFAULT TRUE,
  supports_api_key BOOLEAN NOT NULL DEFAULT FALSE,
  default_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tools_catalog_key
ON tools_catalog (key);

CREATE TABLE IF NOT EXISTS user_tools (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  connection_type TEXT NOT NULL,
  label TEXT,
  login_identifier_masked TEXT,
  last_used_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_tools_user_tool UNIQUE (user_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tools_user_updated
ON user_tools (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS vault_entries (
  id TEXT PRIMARY KEY,
  user_tool_id TEXT NOT NULL,
  secret_type TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  encrypted_metadata TEXT,
  key_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_vault_entries_user_tool_secret UNIQUE (user_tool_id, secret_type)
);

CREATE INDEX IF NOT EXISTS idx_vault_entries_user_tool_updated
ON vault_entries (user_tool_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_tool_events (
  id TEXT PRIMARY KEY,
  user_tool_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_tool_events_user_tool_created
ON user_tool_events (user_tool_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tool_run_links (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_tool_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_run_links_run
ON tool_run_links (run_id, created_at DESC);

INSERT INTO app_user_onboarding_states (user_id, onboarding_step, skipped_tool_setup, preferences)
SELECT id, 'welcome', FALSE, '{}'::jsonb
FROM app_users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO app_user_settings (
  user_id,
  locale,
  timezone,
  dashboard_default_view,
  security,
  agent_defaults,
  notifications
)
SELECT
  id,
  'en-US',
  'UTC',
  'operator',
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb
FROM app_users
ON CONFLICT (user_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_settings_user_id') THEN
    ALTER TABLE app_user_settings
      ADD CONSTRAINT fk_app_user_settings_user_id
      FOREIGN KEY (user_id)
      REFERENCES app_users(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_tools_user_id') THEN
    ALTER TABLE user_tools
      ADD CONSTRAINT fk_user_tools_user_id
      FOREIGN KEY (user_id)
      REFERENCES wallet_users(user_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_tools_tool_id') THEN
    ALTER TABLE user_tools
      ADD CONSTRAINT fk_user_tools_tool_id
      FOREIGN KEY (tool_id)
      REFERENCES tools_catalog(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vault_entries_user_tool_id') THEN
    ALTER TABLE vault_entries
      ADD CONSTRAINT fk_vault_entries_user_tool_id
      FOREIGN KEY (user_tool_id)
      REFERENCES user_tools(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_tool_events_user_tool_id') THEN
    ALTER TABLE user_tool_events
      ADD CONSTRAINT fk_user_tool_events_user_tool_id
      FOREIGN KEY (user_tool_id)
      REFERENCES user_tools(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tool_run_links_user_tool_id') THEN
    ALTER TABLE tool_run_links
      ADD CONSTRAINT fk_tool_run_links_user_tool_id
      FOREIGN KEY (user_tool_id)
      REFERENCES user_tools(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_tools_status') THEN
    ALTER TABLE user_tools
      ADD CONSTRAINT chk_user_tools_status
      CHECK (status IN ('connected', 'disconnected', 'pending', 'failed')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_tools_connection_type') THEN
    ALTER TABLE user_tools
      ADD CONSTRAINT chk_user_tools_connection_type
      CHECK (connection_type IN ('password', 'oauth', 'api_key', 'session')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_tools_created_by') THEN
    ALTER TABLE user_tools
      ADD CONSTRAINT chk_user_tools_created_by
      CHECK (created_by IN ('manual', 'signup_flow', 'oauth', 'imported')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_vault_entries_secret_type') THEN
    ALTER TABLE vault_entries
      ADD CONSTRAINT chk_vault_entries_secret_type
      CHECK (secret_type IN ('password', 'oauth_token', 'refresh_token', 'api_key', 'session')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_tool_events_type') THEN
    ALTER TABLE user_tool_events
      ADD CONSTRAINT chk_user_tool_events_type
      CHECK (event_type IN (
        'connected',
        'updated',
        'login_used',
        'login_failed',
        'disabled',
        'enabled',
        'removed',
        'signup_created'
      )) NOT VALID;
  END IF;
END $$;
