CREATE TABLE IF NOT EXISTS user_tool_configs (
  id TEXT PRIMARY KEY,
  user_tool_id TEXT NOT NULL UNIQUE,
  encrypted_config TEXT NOT NULL,
  key_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_tool_configs_user_tool
ON user_tool_configs (user_tool_id, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_tool_configs_user_tool_id') THEN
    ALTER TABLE user_tool_configs
      ADD CONSTRAINT fk_user_tool_configs_user_tool_id
      FOREIGN KEY (user_tool_id)
      REFERENCES user_tools(id)
      ON DELETE CASCADE;
  END IF;
END $$;
