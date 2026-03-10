import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { getDatabaseUrl } from '@/lib/server/env';

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

  const connectionString = getDatabaseUrl();
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
    return await getPool().query<T>(text, params);
  } catch (error) {
    if (!isRetryableMaxClientsError(error)) {
      throw error;
    }

    // Brief backoff helps when Supabase session mode is saturated momentarily.
    await wait(150);
    return getPool().query<T>(text, params);
  }
}

export async function withTransaction<T>(fn: (client: Pool) => Promise<T>): Promise<T> {
  await ensureSchema();
  return fn(getPool());
}

export async function ensureSchema(): Promise<void> {
  if (schemaInitPromise) {
    return schemaInitPromise;
  }

  schemaInitPromise = (async () => {
    const p = getPool();

    await p.query(`
      CREATE TABLE IF NOT EXISTS wallet_users (
        user_id TEXT PRIMARY KEY,
        currency TEXT NOT NULL DEFAULT 'usd',
        settings JSONB NOT NULL,
        stripe_customer_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await p.query(`
      ALTER TABLE wallet_users
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
    `);

    await p.query(`
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

    await p.query(`
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

    await p.query(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    await p.query(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS send_method TEXT NOT NULL DEFAULT 'stripe_connected';
    `);

    await p.query(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS cash_app_cashtag TEXT;
    `);

    await p.query(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS bank_reference TEXT;
    `);

    await p.query(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    await p.query(`
      ALTER TABLE recipients
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    await p.query(`
      ALTER TABLE recipients
      ALTER COLUMN stripe_account_id DROP NOT NULL;
    `);

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_recipients_user_name
      ON recipients (user_id, lower(name));
    `);

    await p.query(`
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

    await p.query(`
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

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_created_at
      ON ledger_entries (user_id, created_at DESC);
    `);

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_ledger_entries_provider_reference
      ON ledger_entries (provider_reference_id);
    `);

    await p.query(`
      ALTER TABLE ledger_entries
      ADD COLUMN IF NOT EXISTS stripe_event_id TEXT;
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await p.query(`
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

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_payment_methods_user_updated
      ON wallet_payment_methods (user_id, updated_at DESC);
    `);

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_payment_methods_customer
      ON wallet_payment_methods (stripe_customer_id, stripe_payment_method_id);
    `);

    await p.query(`
      INSERT INTO recipients (id, user_id, name, stripe_account_id, default_currency, created_at)
      SELECT id, user_id, name, stripe_account_id, 'usd', created_at
      FROM wallet_recipients
      ON CONFLICT (id) DO NOTHING;
    `);

    await p.query(`
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

    await p.query(`
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

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_web_action_logs_task_created_at
      ON web_action_logs (task_id, created_at ASC);
    `);

    await p.query(`
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

    await p.query(`
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

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_procurement_tasks_user_created_at
      ON procurement_tasks (user_id, created_at DESC);
    `);

    await p.query(`
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

    await p.query(`
      ALTER TABLE procurement_findings
      ADD COLUMN IF NOT EXISTS content_availability TEXT;
    `);

    await p.query(`
      ALTER TABLE procurement_findings
      ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_procurement_findings_task_created_at
      ON procurement_findings (task_id, created_at DESC);
    `);

    await p.query(`
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

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_subscription_actions_user_task_created_at
      ON subscription_actions (user_id, task_id, created_at DESC);
    `);

    await p.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_actions_running_operation
      ON subscription_actions (user_id, task_id, operation)
      WHERE status = 'running';
    `);

    await p.query(`
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

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_tools_catalog_key
      ON tools_catalog (key);
    `);

    await p.query(`
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

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_user_tools_user_updated
      ON user_tools (user_id, updated_at DESC);
    `);

    await p.query(`
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

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_entries_user_tool_updated
      ON vault_entries (user_tool_id, updated_at DESC);
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS user_tool_events (
        id TEXT PRIMARY KEY,
        user_tool_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_user_tool_events_user_tool_created
      ON user_tool_events (user_tool_id, created_at DESC);
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS tool_run_links (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        user_tool_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_tool_run_links_run
      ON tool_run_links (run_id, created_at DESC);
    `);

    await p.query(`
      DO $$
      BEGIN
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
      END $$;
    `);

    await p.query(`
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

    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_actions_status') THEN
          ALTER TABLE subscription_actions
            ADD CONSTRAINT chk_subscription_actions_status
            CHECK (status IN ('running', 'completed', 'blocked', 'failed')) NOT VALID;
        END IF;
      END $$;
    `);

    await p.query(`
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
