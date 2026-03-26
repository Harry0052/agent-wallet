-- ACP Phase 2/4: Add journal and rollback columns for action audit trail
-- Applied: 2026-03-25

-- Add journal columns to automation_action_events
ALTER TABLE automation_action_events ADD COLUMN IF NOT EXISTS rendered_goal TEXT;
ALTER TABLE automation_action_events ADD COLUMN IF NOT EXISTS tinyfish_result JSONB;

-- Add rollback columns to automation_actions
ALTER TABLE automation_actions ADD COLUMN IF NOT EXISTS rollback_possible BOOLEAN DEFAULT FALSE;
ALTER TABLE automation_actions ADD COLUMN IF NOT EXISTS rollback_notes TEXT;
