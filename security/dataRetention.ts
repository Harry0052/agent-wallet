import 'server-only';

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '@/lib/server/db';
import { assertNodeRuntime } from '@/lib/server/runtimeGuard';

assertNodeRuntime();

const SECURITY_EVENTS_LOG_PATH = 'security/securityEvents.log';
const MIN_SCHEDULE_INTERVAL_MS = 60_000;
const DEFAULT_SCHEDULE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_REVOKED_SESSION_RETENTION_DAYS = 1;
const DEFAULT_LOG_RETENTION_DAYS = 30;
const DEFAULT_TOKEN_RETENTION_DAYS = 7;
const DEFAULT_UNUSED_CONNECTOR_TOKEN_RETENTION_DAYS = 30;

declare global {
  var __agentWalletDataRetentionTimer: NodeJS.Timeout | undefined;
  var __agentWalletDataRetentionInFlight: Promise<DataRetentionResult> | undefined;
}

export type DataRetentionConfig = {
  scheduleIntervalMs: number;
  revokedSessionRetentionDays: number;
  logRetentionDays: number;
  tokenRetentionDays: number;
  unusedConnectorTokenRetentionDays: number;
};

export type DataRetentionResult = {
  ranAt: string;
  config: DataRetentionConfig;
  removed: {
    expiredSessions: number;
    stalePasswordResetTokens: number;
    staleEmailVerificationTokens: number;
    oldAuditLogs: number;
    unusedFinancialConnectorTokens: number;
    oldSecurityLogEntries: number;
  };
};

function parsePositiveInt(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePositiveMs(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_SCHEDULE_INTERVAL_MS) {
    return fallback;
  }
  return parsed;
}

function resolveDataRetentionConfig(overrides: Partial<DataRetentionConfig> = {}): DataRetentionConfig {
  const scheduleIntervalMs = overrides.scheduleIntervalMs
    ?? parsePositiveMs(process.env.DATA_RETENTION_INTERVAL_MS, DEFAULT_SCHEDULE_INTERVAL_MS);

  const revokedSessionRetentionDays = overrides.revokedSessionRetentionDays
    ?? parsePositiveInt(process.env.DATA_RETENTION_REVOKED_SESSION_DAYS, DEFAULT_REVOKED_SESSION_RETENTION_DAYS);

  const logRetentionDays = overrides.logRetentionDays
    ?? parsePositiveInt(process.env.DATA_RETENTION_LOG_DAYS, DEFAULT_LOG_RETENTION_DAYS);

  const tokenRetentionDays = overrides.tokenRetentionDays
    ?? parsePositiveInt(process.env.DATA_RETENTION_TOKEN_DAYS, DEFAULT_TOKEN_RETENTION_DAYS);

  const unusedConnectorTokenRetentionDays = overrides.unusedConnectorTokenRetentionDays
    ?? parsePositiveInt(
      process.env.DATA_RETENTION_UNUSED_CONNECTOR_TOKEN_DAYS,
      DEFAULT_UNUSED_CONNECTOR_TOKEN_RETENTION_DAYS,
    );

  return {
    scheduleIntervalMs,
    revokedSessionRetentionDays,
    logRetentionDays,
    tokenRetentionDays,
    unusedConnectorTokenRetentionDays,
  };
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = await query<{ table_name: string | null }>(
    `SELECT to_regclass($1) AS table_name`,
    [`public.${tableName}`],
  );
  return Boolean(result.rows[0]?.table_name);
}

async function runDeleteReturningCount(text: string, params: unknown[] = []): Promise<number> {
  const result = await query<{ id: string }>(text, params);
  return result.rowCount ?? result.rows.length;
}

function parseSecurityLogTimestamp(line: string): number | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as { timestamp?: unknown };
    if (typeof parsed.timestamp === 'string') {
      const parsedMs = Date.parse(parsed.timestamp);
      if (Number.isFinite(parsedMs)) return parsedMs;
    }
  } catch {
    // Keep lines with unparseable timestamps to avoid accidental log loss.
  }

  return null;
}

async function pruneSecurityEventsLog(logRetentionDays: number): Promise<number> {
  const absolutePath = path.resolve(process.cwd(), SECURITY_EVENTS_LOG_PATH);
  if (!existsSync(absolutePath)) return 0;

  const cutoffMs = Date.now() - (logRetentionDays * 24 * 60 * 60 * 1000);
  const raw = await readFile(absolutePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return 0;

  const kept: string[] = [];
  let removed = 0;

  for (const line of lines) {
    const timestampMs = parseSecurityLogTimestamp(line);
    if (timestampMs !== null && timestampMs < cutoffMs) {
      removed += 1;
      continue;
    }
    kept.push(line);
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    kept.length > 0 ? `${kept.join('\n')}\n` : '',
    'utf8',
  );

  return removed;
}

async function runDataRetentionSweep(config: DataRetentionConfig): Promise<DataRetentionResult> {
  const expiredSessions = await runDeleteReturningCount(
    `
      DELETE FROM app_user_sessions
      WHERE expires_at < NOW()
         OR (
           revoked_at IS NOT NULL
           AND revoked_at < NOW() - make_interval(days => $1::int)
         )
      RETURNING id
    `,
    [config.revokedSessionRetentionDays],
  );

  const stalePasswordResetTokens = await runDeleteReturningCount(
    `
      DELETE FROM app_password_reset_tokens
      WHERE consumed_at IS NOT NULL
         OR expires_at < NOW() - make_interval(days => $1::int)
      RETURNING id
    `,
    [config.tokenRetentionDays],
  );

  const staleEmailVerificationTokens = await runDeleteReturningCount(
    `
      DELETE FROM app_email_verification_tokens
      WHERE consumed_at IS NOT NULL
         OR expires_at < NOW() - make_interval(days => $1::int)
      RETURNING id
    `,
    [config.tokenRetentionDays],
  );

  const oldAuditLogs = await runDeleteReturningCount(
    `
      DELETE FROM app_account_audit_events
      WHERE created_at < NOW() - make_interval(days => $1::int)
      RETURNING id
    `,
    [config.logRetentionDays],
  );

  let unusedFinancialConnectorTokens = 0;
  if (await tableExists('financial_connector_items') && await tableExists('financial_connector_accounts')) {
    unusedFinancialConnectorTokens = await runDeleteReturningCount(
      `
        DELETE FROM financial_connector_items i
        WHERE i.updated_at < NOW() - make_interval(days => $1::int)
          AND NOT EXISTS (
            SELECT 1
            FROM financial_connector_accounts a
            WHERE a.item_id = i.id
          )
        RETURNING i.id
      `,
      [config.unusedConnectorTokenRetentionDays],
    );
  }

  const oldSecurityLogEntries = await pruneSecurityEventsLog(config.logRetentionDays);

  return {
    ranAt: new Date().toISOString(),
    config,
    removed: {
      expiredSessions,
      stalePasswordResetTokens,
      staleEmailVerificationTokens,
      oldAuditLogs,
      unusedFinancialConnectorTokens,
      oldSecurityLogEntries,
    },
  };
}

export async function runDataRetentionJob(
  overrides: Partial<DataRetentionConfig> = {},
): Promise<DataRetentionResult> {
  if (globalThis.__agentWalletDataRetentionInFlight) {
    return globalThis.__agentWalletDataRetentionInFlight;
  }

  const config = resolveDataRetentionConfig(overrides);
  const runPromise = runDataRetentionSweep(config)
    .then((result) => {
      console.info('[SECURITY] data retention sweep completed', result);
      return result;
    })
    .finally(() => {
      globalThis.__agentWalletDataRetentionInFlight = undefined;
    });

  globalThis.__agentWalletDataRetentionInFlight = runPromise;
  return runPromise;
}

export function startDataRetentionScheduler(): void {
  if (process.env.DATA_RETENTION_DISABLED === 'true') {
    return;
  }

  if (globalThis.__agentWalletDataRetentionTimer) {
    return;
  }

  const config = resolveDataRetentionConfig();
  const timer = setInterval(() => {
    void runDataRetentionJob(config).catch((error) => {
      console.error('[SECURITY] data retention sweep failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, config.scheduleIntervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  globalThis.__agentWalletDataRetentionTimer = timer;

  void runDataRetentionJob(config).catch((error) => {
    console.error('[SECURITY] initial data retention sweep failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
