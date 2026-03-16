-- User persona: stores AI-built financial profile from onboarding conversation.
CREATE TABLE IF NOT EXISTS user_personas (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  age_range TEXT,
  occupation TEXT,
  income_range TEXT,
  financial_goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  money_stressors JSONB NOT NULL DEFAULT '[]'::jsonb,
  spending_style TEXT,
  saving_style TEXT,
  debt_status TEXT,
  investing_interest TEXT,
  risk_tolerance TEXT,
  onboarding_summary TEXT,
  raw_conversation TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Financial memory timeline: stores extracted traits and observations over time.
CREATE TABLE IF NOT EXISTS user_financial_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_financial_memory_user_created
ON user_financial_memory (user_id, created_at DESC);
