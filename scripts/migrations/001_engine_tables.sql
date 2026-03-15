-- Phase 0: Engine infrastructure tables
-- Run against the primary database

-- Health score snapshots
CREATE TABLE IF NOT EXISTS health_score_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  overall_score NUMERIC(5, 2) NOT NULL,
  spending_score NUMERIC(5, 2),
  savings_score NUMERIC(5, 2),
  debt_score NUMERIC(5, 2),
  coverage_confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  contributing_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_transaction_ids TEXT[] NOT NULL DEFAULT '{}',
  dedup_key TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_snapshots_user_generated
  ON health_score_snapshots (user_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_snapshots_dedup
  ON health_score_snapshots (dedup_key);

-- Cash flow prediction snapshots
CREATE TABLE IF NOT EXISTS cashflow_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prediction JSONB NOT NULL DEFAULT '{}'::jsonb,
  coverage_confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  source_transaction_ids TEXT[] NOT NULL DEFAULT '{}',
  dedup_key TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cashflow_snapshots_user_generated
  ON cashflow_snapshots (user_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cashflow_snapshots_dedup
  ON cashflow_snapshots (dedup_key);

-- Insight generation log
CREATE TABLE IF NOT EXISTS insight_generation_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  insights_generated INTEGER NOT NULL DEFAULT 0,
  insights_suppressed INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  engine_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insight_log_user_generated
  ON insight_generation_log (user_id, generated_at DESC);

-- Task generation log
CREATE TABLE IF NOT EXISTS task_generation_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tasks_generated INTEGER NOT NULL DEFAULT 0,
  tasks_suppressed INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  engine_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_log_user_generated
  ON task_generation_log (user_id, generated_at DESC);

-- Add engine columns to agent_tasks if not present
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS engine_version TEXT,
  ADD COLUMN IF NOT EXISTS rules_version TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_status
  ON agent_tasks (user_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_snoozed
  ON agent_tasks (user_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;
