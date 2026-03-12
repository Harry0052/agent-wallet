import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import {
  createSecureDbClient,
  executeDbQuery,
  getDatabaseConnectionString,
  type SecureDbClient,
} from '@/database/dbService';

declare global {
  var __agentWalletPgPool: Pool | undefined;
  var __agentWalletSchemaInitPromise: Promise<void> | undefined;
}

let pool: Pool | null = globalThis.__agentWalletPgPool || null;
let schemaInitPromise: Promise<void> | null = globalThis.__agentWalletSchemaInitPromise || null;

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolvePoolConfig(connectionString: string): PoolConfig {
  const configuredMax = parsePositiveInt(process.env.DATABASE_POOL_MAX);
  const max = configuredMax
    ?? (connectionString.includes('pooler.supabase.com') || process.env.VERCEL
      ? 1
      : 10);

  const idleTimeoutMillis = parsePositiveInt(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS)
    ?? (process.env.VERCEL ? 5_000 : 30_000);
  const connectionTimeoutMillis = parsePositiveInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS)
    ?? 10_000;

  return {
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    allowExitOnIdle: true,
  };
}

function isRetryableMaxClientsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('maxclientsinsessionmode')
    || message.includes('max clients reached')
    || message.includes('too many clients');
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getPool(): Pool {
  if (pool) return pool;

  if (globalThis.__agentWalletPgPool) {
    pool = globalThis.__agentWalletPgPool;
    return pool;
  }

  const connectionString = getDatabaseConnectionString();
  pool = new Pool(resolvePoolConfig(connectionString));
  globalThis.__agentWalletPgPool = pool;
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  await ensureSchema();
  try {
    return await executeDbQuery<T>(getPool(), text, params, {
      context: 'lib/server/db.query',
    });
  } catch (error) {
    if (!isRetryableMaxClientsError(error)) {
      throw error;
    }

    // Brief backoff helps when Supabase session mode is saturated momentarily.
    await wait(150);
    return executeDbQuery<T>(getPool(), text, params, {
      context: 'lib/server/db.query.retry',
    });
  }
}

export async function withTransaction<T>(fn: (client: SecureDbClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = createSecureDbClient(getPool(), {
    context: 'lib/server/db.withTransaction',
  });
  return fn(client);
}

export async function withDbTransaction<T>(
  fn: (client: SecureDbClient) => Promise<T>,
): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  const secureClient = createSecureDbClient(client, {
    context: 'lib/server/db.withDbTransaction',
  });
  try {
    await client.query('BEGIN');
    const result = await fn(secureClient);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors and rethrow original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureSchema(): Promise<void> {
  if (schemaInitPromise) {
    return schemaInitPromise;
  }

  schemaInitPromise = (async () => {
    const p = getPool();
    const safePoolQuery = <T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[],
    ) => executeDbQuery<T>(p, text, params, {
      context: 'lib/server/db.ensureSchema',
      allowRawSql: true,
      allowDangerousQuery: true,
    });

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        wallet_user_id TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_app_users_email
      ON app_users (email);
    `);

    await safePoolQuery(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS oauth_provider_id TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS profile_picture TEXT;
    `);

    await safePoolQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_oauth_identity
      ON app_users (oauth_provider, oauth_provider_id)
      WHERE oauth_provider IS NOT NULL
        AND oauth_provider_id IS NOT NULL;
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS app_user_passwords (
        user_id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        hash_algo TEXT NOT NULL DEFAULT 'scrypt',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS app_user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        ip TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_app_user_sessions_user_id
      ON app_user_sessions (user_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_app_user_sessions_token_hash
      ON app_user_sessions (token_hash);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS app_password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_app_password_reset_tokens_user_expires
      ON app_password_reset_tokens (user_id, expires_at DESC)
      WHERE consumed_at IS NULL;
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_app_password_reset_tokens_expires
      ON app_password_reset_tokens (expires_at)
      WHERE consumed_at IS NULL;
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS app_email_verification_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_app_email_verification_tokens_user_expires
      ON app_email_verification_tokens (user_id, expires_at DESC)
      WHERE consumed_at IS NULL;
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS app_account_audit_events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_app_account_audit_events_user_created
      ON app_account_audit_events (user_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS app_user_onboarding_states (
        user_id TEXT PRIMARY KEY,
        onboarding_step TEXT NOT NULL DEFAULT 'welcome',
        onboarding_completed_at TIMESTAMPTZ,
        skipped_tool_setup BOOLEAN NOT NULL DEFAULT FALSE,
        preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_app_user_onboarding_states_step
      ON app_user_onboarding_states (onboarding_step, updated_at DESC);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS app_user_settings (
        user_id TEXT PRIMARY KEY,
        locale TEXT NOT NULL DEFAULT 'en-US',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        dashboard_default_view TEXT NOT NULL DEFAULT 'operator',
        security JSONB NOT NULL DEFAULT '{}'::jsonb,
        agent_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
        notifications JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_app_user_settings_updated
      ON app_user_settings (updated_at DESC);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS wallet_users (
        user_id TEXT PRIMARY KEY,
        currency TEXT NOT NULL DEFAULT 'usd',
        settings JSONB NOT NULL,
        stripe_customer_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      ALTER TABLE wallet_users
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE wallet_users
      ADD COLUMN IF NOT EXISTS stripe_customer_id_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE wallet_users
      ADD COLUMN IF NOT EXISTS stripe_customer_id_key_version TEXT;
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS wallet_recipients (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        stripe_account_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS recipients (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        send_method TEXT NOT NULL DEFAULT 'stripe_connected',
        stripe_account_id TEXT,
        cash_app_cashtag TEXT,
        bank_reference TEXT,
        aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
        default_currency TEXT NOT NULL DEFAULT 'usd',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS send_method TEXT NOT NULL DEFAULT 'stripe_connected';
    `);

    await safePoolQuery(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS cash_app_cashtag TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS bank_reference TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS bank_reference_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS bank_reference_key_version TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    await safePoolQuery(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    await safePoolQuery(`
      ALTER TABLE recipients
      ALTER COLUMN stripe_account_id DROP NOT NULL;
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_recipients_user_name
      ON recipients (user_id, lower(name));
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_created_at
      ON ledger_entries (user_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_ledger_entries_provider_reference
      ON ledger_entries (provider_reference_id);
    `);

    await safePoolQuery(`
      ALTER TABLE ledger_entries
      ADD COLUMN IF NOT EXISTS stripe_event_id TEXT;
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flows
      ADD COLUMN IF NOT EXISTS stripe_payment_intent_id_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flows
      ADD COLUMN IF NOT EXISTS stripe_payment_intent_id_key_version TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flows
      ADD COLUMN IF NOT EXISTS idempotency_authorize_key_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flows
      ADD COLUMN IF NOT EXISTS idempotency_authorize_key_key_version TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flows
      ADD COLUMN IF NOT EXISTS idempotency_capture_key_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flows
      ADD COLUMN IF NOT EXISTS idempotency_capture_key_key_version TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flows
      ADD COLUMN IF NOT EXISTS idempotency_void_key_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flows
      ADD COLUMN IF NOT EXISTS idempotency_void_key_key_version TEXT;
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_payment_flows_user_created
      ON payment_flows (user_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_payment_flows_status
      ON payment_flows (status, updated_at DESC);
    `);

    await safePoolQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_flows_capture_key
      ON payment_flows (user_id, idempotency_capture_key)
      WHERE idempotency_capture_key IS NOT NULL;
    `);

    await safePoolQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_flows_void_key
      ON payment_flows (user_id, idempotency_void_key)
      WHERE idempotency_void_key IS NOT NULL;
    `);

    await safePoolQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_flows_stripe_pi
      ON payment_flows (stripe_payment_intent_id)
      WHERE stripe_payment_intent_id IS NOT NULL;
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flow_events
      ADD COLUMN IF NOT EXISTS idempotency_key_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE payment_flow_events
      ADD COLUMN IF NOT EXISTS idempotency_key_key_version TEXT;
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_payment_flow_events_flow_created
      ON payment_flow_events (payment_flow_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_payment_flow_events_user_created
      ON payment_flow_events (user_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_flow_events_idempotent
      ON payment_flow_events (payment_flow_id, event_type, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      ALTER TABLE payment_retry_jobs
      ADD COLUMN IF NOT EXISTS idempotency_key_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE payment_retry_jobs
      ADD COLUMN IF NOT EXISTS idempotency_key_key_version TEXT;
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_payment_retry_jobs_due
      ON payment_retry_jobs (status, next_retry_at ASC);
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_cases_initiate_key
      ON refund_cases (user_id, initiate_idempotency_key)
      WHERE initiate_idempotency_key IS NOT NULL;
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_refund_cases_status_due
      ON refund_cases (user_id, status, next_retry_at ASC);
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_refund_cases_payment
      ON refund_cases (payment_flow_id, created_at DESC);
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_refund_audit_case_created
      ON refund_audit_logs (refund_case_id, created_at ASC);
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_refund_audit_user_created
      ON refund_audit_logs (user_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_audit_idempotent
      ON refund_audit_logs (refund_case_id, action, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS wallet_payment_methods (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        stripe_customer_id TEXT NOT NULL,
        stripe_payment_method_id TEXT NOT NULL,
        brand TEXT,
        last4 TEXT,
        exp_month INTEGER,
        exp_year INTEGER,
        funding TEXT,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'active',
        consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        consent_metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_wallet_payment_methods_user_pm UNIQUE (user_id, stripe_payment_method_id)
      );
    `);

    await safePoolQuery(`
      ALTER TABLE wallet_payment_methods
      ADD COLUMN IF NOT EXISTS stripe_customer_id_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE wallet_payment_methods
      ADD COLUMN IF NOT EXISTS stripe_customer_id_key_version TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE wallet_payment_methods
      ADD COLUMN IF NOT EXISTS stripe_payment_method_id_encrypted TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE wallet_payment_methods
      ADD COLUMN IF NOT EXISTS stripe_payment_method_id_key_version TEXT;
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_wallet_payment_methods_user_updated
      ON wallet_payment_methods (user_id, updated_at DESC);
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_wallet_payment_methods_customer
      ON wallet_payment_methods (stripe_customer_id, stripe_payment_method_id);
    `);

    await safePoolQuery(`
      INSERT INTO recipients (id, user_id, name, stripe_account_id, default_currency, created_at)
      SELECT id, user_id, name, stripe_account_id, 'usd', created_at
      FROM wallet_recipients
      ON CONFLICT (id) DO NOTHING;
    `);

    await safePoolQuery(`
      INSERT INTO app_user_onboarding_states (user_id, onboarding_step, skipped_tool_setup, preferences)
      SELECT id, 'welcome', FALSE, '{}'::jsonb
      FROM app_users
      ON CONFLICT (user_id) DO NOTHING;
    `);

    await safePoolQuery(`
      INSERT INTO app_user_settings (
        user_id,
        locale,
        timezone,
        dashboard_default_view,
        security,
        agent_defaults,
        notifications
      )
      SELECT
        id,
        'en-US',
        'UTC',
        'operator',
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb
      FROM app_users
      ON CONFLICT (user_id) DO NOTHING;
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_web_action_logs_task_created_at
      ON web_action_logs (task_id, created_at ASC);
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_procurement_tasks_user_created_at
      ON procurement_tasks (user_id, created_at DESC);
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      ALTER TABLE procurement_findings
      ADD COLUMN IF NOT EXISTS content_availability TEXT;
    `);

    await safePoolQuery(`
      ALTER TABLE procurement_findings
      ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_procurement_findings_task_created_at
      ON procurement_findings (task_id, created_at DESC);
    `);

    await safePoolQuery(`
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
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_subscription_actions_user_task_created_at
      ON subscription_actions (user_id, task_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_actions_running_operation
      ON subscription_actions (user_id, task_id, operation)
      WHERE status = 'running';
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS tools_catalog (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        category TEXT,
        icon_name TEXT,
        homepage_url TEXT,
        login_url TEXT,
        signup_url TEXT,
        supports_oauth BOOLEAN NOT NULL DEFAULT FALSE,
        supports_password_login BOOLEAN NOT NULL DEFAULT TRUE,
        supports_api_key BOOLEAN NOT NULL DEFAULT FALSE,
        default_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_tools_catalog_key
      ON tools_catalog (key);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS user_tools (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        connection_type TEXT NOT NULL,
        label TEXT,
        login_identifier_masked TEXT,
        last_used_at TIMESTAMPTZ,
        last_verified_at TIMESTAMPTZ,
        created_by TEXT NOT NULL DEFAULT 'manual',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_tools_user_tool UNIQUE (user_id, tool_id)
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_user_tools_user_updated
      ON user_tools (user_id, updated_at DESC);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS vault_entries (
        id TEXT PRIMARY KEY,
        user_tool_id TEXT NOT NULL,
        secret_type TEXT NOT NULL,
        encrypted_secret TEXT NOT NULL,
        encrypted_metadata TEXT,
        key_version TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_vault_entries_user_tool_secret UNIQUE (user_tool_id, secret_type)
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_vault_entries_user_tool_updated
      ON vault_entries (user_tool_id, updated_at DESC);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS user_tool_events (
        id TEXT PRIMARY KEY,
        user_tool_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_user_tool_events_user_tool_created
      ON user_tool_events (user_tool_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS tool_run_links (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        user_tool_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_tool_run_links_run
      ON tool_run_links (run_id, created_at DESC);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS user_tool_configs (
        id TEXT PRIMARY KEY,
        user_tool_id TEXT NOT NULL UNIQUE,
        encrypted_config TEXT NOT NULL,
        key_version TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_user_tool_configs_user_tool
      ON user_tool_configs (user_tool_id, updated_at DESC);
    `);

    await safePoolQuery(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, key)
      );
    `);

    await safePoolQuery(`
      CREATE INDEX IF NOT EXISTS idx_agent_memory_user_prefix
      ON agent_memory (user_id, key text_pattern_ops);
    `);

    await safePoolQuery(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_passwords_user_id') THEN
          ALTER TABLE app_user_passwords
            ADD CONSTRAINT fk_app_user_passwords_user_id
            FOREIGN KEY (user_id)
            REFERENCES app_users(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_sessions_user_id') THEN
          ALTER TABLE app_user_sessions
            ADD CONSTRAINT fk_app_user_sessions_user_id
            FOREIGN KEY (user_id)
            REFERENCES app_users(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_password_reset_tokens_user_id') THEN
          ALTER TABLE app_password_reset_tokens
            ADD CONSTRAINT fk_app_password_reset_tokens_user_id
            FOREIGN KEY (user_id)
            REFERENCES app_users(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_email_verification_tokens_user_id') THEN
          ALTER TABLE app_email_verification_tokens
            ADD CONSTRAINT fk_app_email_verification_tokens_user_id
            FOREIGN KEY (user_id)
            REFERENCES app_users(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_users_wallet_user_id') THEN
          ALTER TABLE app_users
            ADD CONSTRAINT fk_app_users_wallet_user_id
            FOREIGN KEY (wallet_user_id)
            REFERENCES wallet_users(user_id)
            ON DELETE RESTRICT
            NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_onboarding_states_user_id') THEN
          ALTER TABLE app_user_onboarding_states
            ADD CONSTRAINT fk_app_user_onboarding_states_user_id
            FOREIGN KEY (user_id)
            REFERENCES app_users(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_user_settings_user_id') THEN
          ALTER TABLE app_user_settings
            ADD CONSTRAINT fk_app_user_settings_user_id
            FOREIGN KEY (user_id)
            REFERENCES app_users(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_tools_user_id') THEN
          ALTER TABLE user_tools
            ADD CONSTRAINT fk_user_tools_user_id
            FOREIGN KEY (user_id)
            REFERENCES wallet_users(user_id)
            ON DELETE CASCADE
            NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_tools_tool_id') THEN
          ALTER TABLE user_tools
            ADD CONSTRAINT fk_user_tools_tool_id
            FOREIGN KEY (tool_id)
            REFERENCES tools_catalog(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vault_entries_user_tool_id') THEN
          ALTER TABLE vault_entries
            ADD CONSTRAINT fk_vault_entries_user_tool_id
            FOREIGN KEY (user_tool_id)
            REFERENCES user_tools(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_tool_events_user_tool_id') THEN
          ALTER TABLE user_tool_events
            ADD CONSTRAINT fk_user_tool_events_user_tool_id
            FOREIGN KEY (user_tool_id)
            REFERENCES user_tools(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tool_run_links_user_tool_id') THEN
          ALTER TABLE tool_run_links
            ADD CONSTRAINT fk_tool_run_links_user_tool_id
            FOREIGN KEY (user_tool_id)
            REFERENCES user_tools(id)
            ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_tool_configs_user_tool_id') THEN
          ALTER TABLE user_tool_configs
            ADD CONSTRAINT fk_user_tool_configs_user_tool_id
            FOREIGN KEY (user_tool_id)
            REFERENCES user_tools(id)
            ON DELETE CASCADE;
        END IF;

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
    `);

    await safePoolQuery(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipients_send_method') THEN
          ALTER TABLE recipients
            ADD CONSTRAINT chk_recipients_send_method
            CHECK (send_method IN ('cash_app', 'stripe_connected', 'bank')) NOT VALID;
        END IF;

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
    `);

    await safePoolQuery(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_actions_status') THEN
          ALTER TABLE subscription_actions
            ADD CONSTRAINT chk_subscription_actions_status
            CHECK (status IN ('running', 'completed', 'blocked', 'failed')) NOT VALID;
        END IF;
      END $$;
    `);

    await safePoolQuery(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_actions_operation') THEN
          ALTER TABLE subscription_actions
            ADD CONSTRAINT chk_subscription_actions_operation
            CHECK (operation IN ('inspect_billing', 'renewal_check', 'downgrade', 'cancel', 'switch_billing')) NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_tools_status') THEN
          ALTER TABLE user_tools
            ADD CONSTRAINT chk_user_tools_status
            CHECK (status IN ('connected', 'disconnected', 'pending', 'failed')) NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_tools_connection_type') THEN
          ALTER TABLE user_tools
            ADD CONSTRAINT chk_user_tools_connection_type
            CHECK (connection_type IN ('password', 'oauth', 'api_key', 'session')) NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_tools_created_by') THEN
          ALTER TABLE user_tools
            ADD CONSTRAINT chk_user_tools_created_by
            CHECK (created_by IN ('manual', 'signup_flow', 'oauth', 'imported')) NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_vault_entries_secret_type') THEN
          ALTER TABLE vault_entries
            ADD CONSTRAINT chk_vault_entries_secret_type
            CHECK (secret_type IN ('password', 'oauth_token', 'refresh_token', 'api_key', 'session')) NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_tool_events_type') THEN
          ALTER TABLE user_tool_events
            ADD CONSTRAINT chk_user_tool_events_type
            CHECK (event_type IN (
              'connected',
              'updated',
              'login_used',
              'login_failed',
              'disabled',
              'enabled',
              'removed',
              'signup_created'
            )) NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wallet_payment_methods_status') THEN
          ALTER TABLE wallet_payment_methods
            ADD CONSTRAINT chk_wallet_payment_methods_status
            CHECK (status IN ('active', 'removed')) NOT VALID;
        END IF;

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
    `);
  })().catch((error) => {
    // Allow retries on subsequent calls if first schema init failed transiently.
    schemaInitPromise = null;
    globalThis.__agentWalletSchemaInitPromise = undefined;
    throw error;
  });

  globalThis.__agentWalletSchemaInitPromise = schemaInitPromise;

  return schemaInitPromise;
}
