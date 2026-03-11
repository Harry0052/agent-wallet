CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  wallet_user_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_email
ON app_users (email);

CREATE TABLE IF NOT EXISTS app_user_passwords (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  hash_algo TEXT NOT NULL DEFAULT 'scrypt',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_user_sessions_user_id
ON app_user_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_user_sessions_token_hash
ON app_user_sessions (token_hash);

CREATE TABLE IF NOT EXISTS app_password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_account_audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_account_audit_events_user_created
ON app_account_audit_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_user_onboarding_states (
  user_id TEXT PRIMARY KEY,
  onboarding_step TEXT NOT NULL DEFAULT 'welcome',
  onboarding_completed_at TIMESTAMPTZ,
  skipped_tool_setup BOOLEAN NOT NULL DEFAULT FALSE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_user_onboarding_states_step
ON app_user_onboarding_states (onboarding_step, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_passwords_user_id') THEN
    ALTER TABLE app_user_passwords
      ADD CONSTRAINT fk_app_user_passwords_user_id
      FOREIGN KEY (user_id)
      REFERENCES app_users(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_sessions_user_id') THEN
    ALTER TABLE app_user_sessions
      ADD CONSTRAINT fk_app_user_sessions_user_id
      FOREIGN KEY (user_id)
      REFERENCES app_users(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_password_reset_tokens_user_id') THEN
    ALTER TABLE app_password_reset_tokens
      ADD CONSTRAINT fk_app_password_reset_tokens_user_id
      FOREIGN KEY (user_id)
      REFERENCES app_users(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_email_verification_tokens_user_id') THEN
    ALTER TABLE app_email_verification_tokens
      ADD CONSTRAINT fk_app_email_verification_tokens_user_id
      FOREIGN KEY (user_id)
      REFERENCES app_users(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_users_wallet_user_id') THEN
    ALTER TABLE app_users
      ADD CONSTRAINT fk_app_users_wallet_user_id
      FOREIGN KEY (wallet_user_id)
      REFERENCES wallet_users(user_id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_onboarding_states_user_id') THEN
    ALTER TABLE app_user_onboarding_states
      ADD CONSTRAINT fk_app_user_onboarding_states_user_id
      FOREIGN KEY (user_id)
      REFERENCES app_users(id)
      ON DELETE CASCADE;
  END IF;
END $$;
