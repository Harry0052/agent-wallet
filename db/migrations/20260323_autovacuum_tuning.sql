-- Lower autovacuum thresholds on high-churn tables to prevent dead tuple buildup.
-- Default is 50 + 20% of table size; these tables are small but heavily updated.

ALTER TABLE app_user_sessions SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE financial_connector_accounts SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE app_user_onboarding_states SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE agent_memory SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE user_autofill_profiles SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE user_tools SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE financial_sync_runs SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE app_user_settings SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.05);
