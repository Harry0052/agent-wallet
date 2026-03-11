CREATE TABLE IF NOT EXISTS wallet_users (
  user_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'usd',
  settings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_recipients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stripe_account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stripe_account_id TEXT NOT NULL,
  default_currency TEXT NOT NULL DEFAULT 'usd',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipients_user_name
ON recipients (user_id, lower(name));

CREATE TABLE IF NOT EXISTS user_autofill_profiles (
  user_id TEXT PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  company_name TEXT,
  billing_name TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state_region TEXT,
  postal_code TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  provider_reference_id TEXT,
  description TEXT NOT NULL,
  source_url TEXT,
  merchant TEXT,
  recipient_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_created_at
ON ledger_entries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_provider_reference
ON ledger_entries (provider_reference_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_flows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT,
  merchant TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  funding_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  requires_activation_verification BOOLEAN NOT NULL DEFAULT TRUE,
  idempotency_authorize_key TEXT NOT NULL,
  idempotency_capture_key TEXT,
  idempotency_void_key TEXT,
  metadata JSONB,
  activation_verified_at TIMESTAMPTZ,
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payment_flows_authorize UNIQUE (user_id, idempotency_authorize_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_flows_user_created
ON payment_flows (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_flows_status
ON payment_flows (status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_flows_capture_key
ON payment_flows (user_id, idempotency_capture_key)
WHERE idempotency_capture_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_flows_void_key
ON payment_flows (user_id, idempotency_void_key)
WHERE idempotency_void_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_flows_stripe_pi
ON payment_flows (stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_flow_events (
  id TEXT PRIMARY KEY,
  payment_flow_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  idempotency_key TEXT,
  reason TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_flow_events_flow_created
ON payment_flow_events (payment_flow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_flow_events_user_created
ON payment_flow_events (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_flow_events_idempotent
ON payment_flow_events (payment_flow_id, event_type, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_retry_jobs (
  id TEXT PRIMARY KEY,
  payment_flow_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_retry_jobs_due
ON payment_retry_jobs (status, next_retry_at ASC);

CREATE TABLE IF NOT EXISTS refund_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payment_flow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  merchant TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  activation_failure_reason TEXT,
  initiate_idempotency_key TEXT,
  merchant_adapter_id TEXT,
  merchant_reference_id TEXT,
  processor_reference_id TEXT,
  dispute_id TEXT,
  evidence_pack JSONB,
  user_explanation TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_refund_cases_payment UNIQUE (user_id, payment_flow_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_cases_initiate_key
ON refund_cases (user_id, initiate_idempotency_key)
WHERE initiate_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refund_cases_status_due
ON refund_cases (user_id, status, next_retry_at ASC);

CREATE INDEX IF NOT EXISTS idx_refund_cases_payment
ON refund_cases (payment_flow_id, created_at DESC);

CREATE TABLE IF NOT EXISTS refund_audit_logs (
  id TEXT PRIMARY KEY,
  refund_case_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  payment_flow_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_audit_case_created
ON refund_audit_logs (refund_case_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_refund_audit_user_created
ON refund_audit_logs (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_audit_idempotent
ON refund_audit_logs (refund_case_id, action, idempotency_key)
WHERE idempotency_key IS NOT NULL;

INSERT INTO recipients (id, user_id, name, stripe_account_id, default_currency, created_at)
SELECT id, user_id, name, stripe_account_id, 'usd', created_at
FROM wallet_recipients
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS web_action_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT,
  action_type TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_action_logs_task_created_at
ON web_action_logs (task_id, created_at ASC);

CREATE TABLE IF NOT EXISTS approval_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procurement_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  goal TEXT NOT NULL,
  budget_limit NUMERIC(12, 2),
  category TEXT,
  target_vendors JSONB,
  comparison_criteria JSONB,
  must_have_features JSONB,
  findings JSONB,
  recommendation JSONB,
  planning_output JSONB NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_tasks_user_created_at
ON procurement_tasks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS procurement_findings (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  pricing_page_url TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  monthly_price NUMERIC(12, 2),
  annual_price NUMERIC(12, 2),
  billing_frequency TEXT NOT NULL,
  content_availability TEXT,
  notes TEXT,
  notable_features JSONB NOT NULL,
  extraction_timestamp TIMESTAMPTZ NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_findings_task_created_at
ON procurement_findings (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  evidence_urls JSONB NOT NULL,
  projected_savings NUMERIC(12, 2),
  projected_savings_basis TEXT,
  currency TEXT,
  renewal_date TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_actions_user_task_created_at
ON subscription_actions (user_id, task_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_actions_running_operation
ON subscription_actions (user_id, task_id, operation)
WHERE status = 'running';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_procurement_tasks_status') THEN
    ALTER TABLE procurement_tasks
      ADD CONSTRAINT chk_procurement_tasks_status
      CHECK (status IN (
        'planning',
        'planned',
        'needs_clarification',
        'researching',
        'researched',
        'comparing',
        'awaiting_approval',
        'purchase_preparing',
        'purchase_prepared',
        'rejected',
        'failed'
      )) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_actions_status') THEN
    ALTER TABLE subscription_actions
      ADD CONSTRAINT chk_subscription_actions_status
      CHECK (status IN ('running', 'completed', 'blocked', 'failed')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_actions_operation') THEN
    ALTER TABLE subscription_actions
      ADD CONSTRAINT chk_subscription_actions_operation
      CHECK (operation IN ('inspect_billing', 'renewal_check', 'downgrade', 'cancel', 'switch_billing')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_flow_events_flow_id') THEN
    ALTER TABLE payment_flow_events
      ADD CONSTRAINT fk_payment_flow_events_flow_id
      FOREIGN KEY (payment_flow_id)
      REFERENCES payment_flows(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_retry_jobs_flow_id') THEN
    ALTER TABLE payment_retry_jobs
      ADD CONSTRAINT fk_payment_retry_jobs_flow_id
      FOREIGN KEY (payment_flow_id)
      REFERENCES payment_flows(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_refund_cases_payment_flow_id') THEN
    ALTER TABLE refund_cases
      ADD CONSTRAINT fk_refund_cases_payment_flow_id
      FOREIGN KEY (payment_flow_id)
      REFERENCES payment_flows(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_refund_audit_logs_case_id') THEN
    ALTER TABLE refund_audit_logs
      ADD CONSTRAINT fk_refund_audit_logs_case_id
      FOREIGN KEY (refund_case_id)
      REFERENCES refund_cases(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_flows_funding_mode') THEN
    ALTER TABLE payment_flows
      ADD CONSTRAINT chk_payment_flows_funding_mode
      CHECK (funding_mode IN ('STRIPE_AUTH_CAPTURE', 'PREPAID_BALANCE')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_flows_status') THEN
    ALTER TABLE payment_flows
      ADD CONSTRAINT chk_payment_flows_status
      CHECK (status IN (
        'authorization_pending',
        'activation_pending',
        'activated',
        'activation_failed',
        'capture_pending',
        'captured',
        'refund_pending',
        'refunded',
        'failed'
      )) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_flow_events_event_type') THEN
    ALTER TABLE payment_flow_events
      ADD CONSTRAINT chk_payment_flow_events_event_type
      CHECK (event_type IN (
        'reserved',
        'authorized',
        'captured',
        'activation_pending',
        'activated',
        'activation_failed',
        'refund_pending',
        'refunded'
      )) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_retry_jobs_operation') THEN
    ALTER TABLE payment_retry_jobs
      ADD CONSTRAINT chk_payment_retry_jobs_operation
      CHECK (operation IN ('capture', 'void')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_retry_jobs_status') THEN
    ALTER TABLE payment_retry_jobs
      ADD CONSTRAINT chk_payment_retry_jobs_status
      CHECK (status IN ('pending', 'processing', 'completed', 'failed')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_refund_cases_status') THEN
    ALTER TABLE refund_cases
      ADD CONSTRAINT chk_refund_cases_status
      CHECK (status IN (
        'payment_captured',
        'service_not_activated',
        'refund_requested',
        'refund_in_progress',
        'refund_completed',
        'dispute_prepared',
        'dispute_submitted'
      )) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_refund_audit_logs_to_state') THEN
    ALTER TABLE refund_audit_logs
      ADD CONSTRAINT chk_refund_audit_logs_to_state
      CHECK (to_state IN (
        'payment_captured',
        'service_not_activated',
        'refund_requested',
        'refund_in_progress',
        'refund_completed',
        'dispute_prepared',
        'dispute_submitted'
      )) NOT VALID;
  END IF;
END $$;

-- Agent memory (key-value with JSONB)
CREATE TABLE IF NOT EXISTS agent_memory (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_user_prefix
ON agent_memory (user_id, key text_pattern_ops);
