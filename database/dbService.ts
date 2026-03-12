import 'server-only';

import type { QueryResult, QueryResultRow } from 'pg';
import { getRequiredSecret } from '@/security/secretsManager';
import { redactSecretsInString } from '@/security/redactSecrets';

const DANGEROUS_QUERY_PATTERNS = [
  { label: 'DROP', pattern: /\bdrop\b/i },
  { label: 'DELETE *', pattern: /\bdelete\s+\*/i },
  { label: 'UNION SELECT', pattern: /\bunion\s+select\b/i },
] as const;

const WRITE_STATEMENT_PATTERN = /^\s*(insert|update|delete)\b/i;
const TRANSACTION_CONTROL_PATTERN = /^\s*(begin|commit|rollback|savepoint|release)\b/i;
const SAFE_RAW_STATEMENT_PATTERN = /^\s*(create|alter|do|set|show|explain|analyze|vacuum|grant|revoke|comment)\b/i;
const PLACEHOLDER_PATTERN = /\$(\d+)/g;
const MULTI_STATEMENT_PATTERN = /;[\s\n\r]*\S/;
const NULL_BYTE_PATTERN = /\u0000/g;
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

declare global {
  var __agentWalletDbSecurityAlertFingerprints: Set<string> | undefined;
}

export type DbQueryOptions = {
  context?: string;
  allowRawSql?: boolean;
  allowDangerousQuery?: boolean;
};

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
};

export type SecureDbClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
    options?: DbQueryOptions,
  ): Promise<QueryResult<T>>;
};

function alertFingerprints(): Set<string> {
  if (!globalThis.__agentWalletDbSecurityAlertFingerprints) {
    globalThis.__agentWalletDbSecurityAlertFingerprints = new Set<string>();
  }
  return globalThis.__agentWalletDbSecurityAlertFingerprints;
}

function queryPreview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const clipped = compact.length > 240 ? `${compact.slice(0, 240)}...` : compact;
  return redactSecretsInString(clipped);
}

function logSecurityAlert(input: {
  event: string;
  text: string;
  context?: string;
  details?: Record<string, unknown>;
}): void {
  const fingerprint = `${input.event}:${input.context || 'default'}:${input.text}`;
  if (alertFingerprints().has(fingerprint)) return;
  alertFingerprints().add(fingerprint);

  console.error('[SECURITY_ALERT] database query policy triggered', {
    event: input.event,
    context: input.context || 'unspecified',
    query: queryPreview(input.text),
    ...input.details,
  });
}

function sanitizeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string') return value.replace(NULL_BYTE_PATTERN, '');
  if (typeof value === 'bigint') return value.toString();

  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('Unsupported SQL parameter type.');
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (value instanceof Date || Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (DANGEROUS_OBJECT_KEYS.has(key)) continue;
      sanitized[key] = sanitizeValue(entry);
    }
    return sanitized;
  }

  return value;
}

function sanitizeParams(params?: unknown[]): unknown[] {
  if (!params || params.length === 0) return [];
  return params.map((value) => sanitizeValue(value));
}

function highestPlaceholderIndex(text: string): number {
  let highest = 0;
  PLACEHOLDER_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > highest) {
      highest = value;
    }
  }

  return highest;
}

function assertQueryPolicy(input: {
  text: string;
  params: unknown[];
  options: DbQueryOptions;
}): void {
  const text = input.text.trim();
  if (!text) {
    throw new Error('Query text is required.');
  }

  const dangerousHits = DANGEROUS_QUERY_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);

  if (dangerousHits.length > 0) {
    logSecurityAlert({
      event: 'dangerous_query_pattern',
      text,
      context: input.options.context,
      details: {
        patterns: dangerousHits.join(', '),
      },
    });

    if (!input.options.allowDangerousQuery) {
      throw new Error(`Blocked dangerous SQL pattern: ${dangerousHits.join(', ')}`);
    }
  }

  if (MULTI_STATEMENT_PATTERN.test(text) && !input.options.allowRawSql) {
    logSecurityAlert({
      event: 'multiple_statements_blocked',
      text,
      context: input.options.context,
    });
    throw new Error('Blocked SQL containing multiple statements. Use a single statement per query call.');
  }

  const placeholderMax = highestPlaceholderIndex(text);
  const paramsCount = input.params.length;

  if (placeholderMax > 0 && paramsCount === 0) {
    throw new Error('Query includes placeholders but no parameters were provided.');
  }

  if (paramsCount > 0 && placeholderMax === 0) {
    throw new Error('Parameterized query enforcement failed: provide $1... placeholders for all values.');
  }

  if (placeholderMax > paramsCount) {
    throw new Error(`Missing query parameters: expected ${placeholderMax}, received ${paramsCount}.`);
  }

  if (placeholderMax > 0 && paramsCount > placeholderMax) {
    throw new Error(`Unexpected extra query parameters: expected ${placeholderMax}, received ${paramsCount}.`);
  }

  if (paramsCount === 0 && placeholderMax === 0 && !input.options.allowRawSql) {
    if (WRITE_STATEMENT_PATTERN.test(text)) {
      logSecurityAlert({
        event: 'raw_write_sql_blocked',
        text,
        context: input.options.context,
      });
      throw new Error('Unparameterized write query blocked. Use parameterized SQL with placeholders.');
    }

    if (!SAFE_RAW_STATEMENT_PATTERN.test(text) && !TRANSACTION_CONTROL_PATTERN.test(text)) {
      logSecurityAlert({
        event: 'raw_sql_detected',
        text,
        context: input.options.context,
      });
    }
  }
}

export async function executeDbQuery<T extends QueryResultRow = QueryResultRow>(
  queryable: Queryable,
  text: string,
  params?: unknown[],
  options: DbQueryOptions = {},
): Promise<QueryResult<T>> {
  const sanitizedParams = sanitizeParams(params);
  assertQueryPolicy({
    text,
    params: sanitizedParams,
    options,
  });
  return queryable.query<T>(text, sanitizedParams);
}

export function createSecureDbClient(
  queryable: Queryable,
  defaults: DbQueryOptions = {},
): SecureDbClient {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[],
      options: DbQueryOptions = {},
    ): Promise<QueryResult<T>> {
      return executeDbQuery<T>(queryable, text, params, {
        ...defaults,
        ...options,
      });
    },
  };
}

export function getDatabaseConnectionString(): string {
  return getRequiredSecret('DATABASE_URL');
}

