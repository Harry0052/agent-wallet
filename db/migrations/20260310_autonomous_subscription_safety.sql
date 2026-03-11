-- Autonomous subscription safety migration
-- Adds two-phase payment + refund orchestration tables used by signup flow safety.

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

