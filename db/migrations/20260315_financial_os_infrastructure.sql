-- Financial OS infrastructure
-- Adds sync hardening runs/leases, actionable notifications, and secure document hooks.

CREATE TABLE IF NOT EXISTS financial_sync_leases (
  user_id TEXT NOT NULL,
  plaid_item_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, plaid_item_id)
);

CREATE TABLE IF NOT EXISTS financial_sync_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plaid_item_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  cursor_start TEXT,
  cursor_end TEXT,
  added_count INTEGER NOT NULL DEFAULT 0,
  modified_count INTEGER NOT NULL DEFAULT 0,
  removed_count INTEGER NOT NULL DEFAULT 0,
  pages INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_sync_runs_user_started
ON financial_sync_runs (user_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_sync_runs_idempotent
ON financial_sync_runs (user_id, plaid_item_id, idempotency_key);

CREATE TABLE IF NOT EXISTS financial_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  deep_link TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  cooldown_until TIMESTAMPTZ,
  throttled_count INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_financial_notifications_user_status_updated
ON financial_notifications (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS financial_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  status TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  source_hash TEXT,
  storage_provider TEXT,
  encrypted_ref TEXT,
  ref_key_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_documents_user_created
ON financial_documents (user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_financial_sync_runs_status') THEN
    ALTER TABLE financial_sync_runs
      ADD CONSTRAINT chk_financial_sync_runs_status
      CHECK (status IN ('processing', 'completed', 'failed', 'skipped')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_financial_notifications_priority') THEN
    ALTER TABLE financial_notifications
      ADD CONSTRAINT chk_financial_notifications_priority
      CHECK (priority IN ('low', 'medium', 'high', 'critical')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_financial_notifications_status') THEN
    ALTER TABLE financial_notifications
      ADD CONSTRAINT chk_financial_notifications_status
      CHECK (status IN ('active', 'dismissed', 'suppressed')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_financial_documents_type') THEN
    ALTER TABLE financial_documents
      ADD CONSTRAINT chk_financial_documents_type
      CHECK (document_type IN ('statement', 'bill', 'receipt', 'confirmation')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_financial_documents_status') THEN
    ALTER TABLE financial_documents
      ADD CONSTRAINT chk_financial_documents_status
      CHECK (status IN ('hooked', 'processed', 'failed')) NOT VALID;
  END IF;
END $$;
