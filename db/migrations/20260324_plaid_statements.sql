-- Plaid Statement documents: metadata + archive tracking
CREATE TABLE IF NOT EXISTS statement_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  plaid_account_id TEXT,
  plaid_statement_id TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  account_mask TEXT,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  period_start DATE,
  period_end DATE,
  storage_path TEXT,
  checksum TEXT,
  download_status TEXT NOT NULL DEFAULT 'pending_download'
    CHECK (download_status IN ('pending_download','downloaded','failed_download')),
  parse_status TEXT NOT NULL DEFAULT 'pending_parse'
    CHECK (parse_status IN ('pending_parse','parsed','failed_parse')),
  reconcile_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (reconcile_status IN ('pending','reconciled','partially_reconciled','failed')),
  source_support_status TEXT NOT NULL DEFAULT 'supported'
    CHECK (source_support_status IN ('supported','unsupported','partial','unknown')),
  error_message TEXT,
  downloaded_at TIMESTAMPTZ,
  parsed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, plaid_statement_id)
);

CREATE INDEX IF NOT EXISTS idx_statement_docs_user_year_month
  ON statement_documents (user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_statement_docs_item
  ON statement_documents (item_id);
CREATE INDEX IF NOT EXISTS idx_statement_docs_download_status
  ON statement_documents (download_status) WHERE download_status = 'pending_download';

-- Statement-extracted transaction line items
CREATE TABLE IF NOT EXISTS statement_extracted_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  plaid_account_id TEXT,
  statement_document_id TEXT NOT NULL REFERENCES statement_documents(id) ON DELETE CASCADE,
  posted_date DATE NOT NULL,
  description_raw TEXT NOT NULL,
  description_normalized TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  running_balance NUMERIC(14, 2),
  extraction_confidence NUMERIC(4, 2),
  matched_live_transaction_id TEXT,
  match_quality TEXT CHECK (match_quality IN ('exact_match','likely_match','no_match','ambiguous')),
  category TEXT,
  visible_in_unified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stmt_txns_user_date
  ON statement_extracted_transactions (user_id, posted_date);
CREATE INDEX IF NOT EXISTS idx_stmt_txns_document
  ON statement_extracted_transactions (statement_document_id);
CREATE INDEX IF NOT EXISTS idx_stmt_txns_matched
  ON statement_extracted_transactions (matched_live_transaction_id)
  WHERE matched_live_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stmt_txns_unified
  ON statement_extracted_transactions (user_id, visible_in_unified, posted_date)
  WHERE visible_in_unified = TRUE;

-- Enable RLS (no policies — app uses superuser connection)
ALTER TABLE statement_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_extracted_transactions ENABLE ROW LEVEL SECURITY;
