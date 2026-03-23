-- Optimize findSessionByToken: partial index on active (non-revoked, non-expired) sessions.
-- The existing idx_app_user_sessions_token_hash covers all rows including revoked/expired.
-- This partial index is much smaller and matches the exact WHERE clause in auth.ts.

CREATE INDEX IF NOT EXISTS idx_app_user_sessions_active_token
    ON app_user_sessions (token_hash)
    WHERE revoked_at IS NULL;

-- Analyze to update planner stats after index creation
ANALYZE app_user_sessions;
