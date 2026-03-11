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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_onboarding_states_user_id') THEN
    ALTER TABLE app_user_onboarding_states
      ADD CONSTRAINT fk_app_user_onboarding_states_user_id
      FOREIGN KEY (user_id)
      REFERENCES app_users(id)
      ON DELETE CASCADE;
  END IF;
END $$;
