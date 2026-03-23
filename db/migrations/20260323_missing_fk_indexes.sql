-- Add missing foreign key indexes flagged by Supabase performance advisor

CREATE INDEX IF NOT EXISTS idx_financial_connector_accounts_item_id
    ON financial_connector_accounts (item_id);

CREATE INDEX IF NOT EXISTS idx_payment_retry_jobs_payment_flow_id
    ON payment_retry_jobs (payment_flow_id);

CREATE INDEX IF NOT EXISTS idx_tool_run_links_user_tool_id
    ON tool_run_links (user_tool_id);

CREATE INDEX IF NOT EXISTS idx_user_tools_tool_id
    ON user_tools (tool_id);
