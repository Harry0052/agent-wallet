import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { redactSecretsInString } from '@/security/redactSecrets';

export type SecurityRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityEvent {
  timestamp: string;
  user_id: string;
  event_type: string;
  risk_level: SecurityRiskLevel;
  ip: string;
  details?: Record<string, unknown>;
}

type CounterBucket = {
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

type BlockEntry = {
  ip: string;
  reason: string;
  riskLevel: SecurityRiskLevel;
  blockedAt: number;
  blockedUntil: number;
};

const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;
const FAILED_LOGIN_ALERT_THRESHOLD = 5;
const FAILED_LOGIN_BLOCK_THRESHOLD = 8;

const API_ABUSE_WINDOW_MS = 10 * 60_000;
const API_ABUSE_ALERT_THRESHOLD = 8;
const API_ABUSE_BLOCK_THRESHOLD = 12;

const ACCOUNT_LINK_WINDOW_MS = 10 * 60_000;
const ACCOUNT_LINK_ALERT_THRESHOLD = 6;
const ACCOUNT_LINK_BLOCK_THRESHOLD = 10;

const GUARDRAIL_VIOLATION_WINDOW_MS = 10 * 60_000;
const GUARDRAIL_VIOLATION_BLOCK_THRESHOLD = 10;

const BLOCK_DURATION_MS = 6 * 60 * 60_000;
const BLOCK_DURATION_SEVERE_MS = 24 * 60 * 60_000;

const SECURITY_LOG_PATH = 'security/securityEvents.log';

declare global {
  var __agentWalletSecurityCounters: Map<string, CounterBucket> | undefined;
  var __agentWalletBlockedIps: Map<string, BlockEntry> | undefined;
  var __agentWalletSecurityLogQueue: Promise<void> | undefined;
}

function counters(): Map<string, CounterBucket> {
  if (!globalThis.__agentWalletSecurityCounters) {
    globalThis.__agentWalletSecurityCounters = new Map<string, CounterBucket>();
  }
  return globalThis.__agentWalletSecurityCounters;
}

function blockedIps(): Map<string, BlockEntry> {
  if (!globalThis.__agentWalletBlockedIps) {
    globalThis.__agentWalletBlockedIps = new Map<string, BlockEntry>();
  }
  return globalThis.__agentWalletBlockedIps;
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

function normalizeUserId(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized || 'anonymous';
}

function nowMs(): number {
  return Date.now();
}

function nowIso(): string {
  return new Date().toISOString();
}

function bucketKey(parts: Array<string | null | undefined>): string {
  return parts.map((part) => (part || '').trim().toLowerCase()).join(':');
}

function incrementBucket(key: string, windowMs: number): number {
  const timestamp = nowMs();
  const existing = counters().get(key);
  if (!existing || timestamp - existing.firstSeenAt > windowMs) {
    counters().set(key, {
      count: 1,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    });
    return 1;
  }

  const next = {
    count: existing.count + 1,
    firstSeenAt: existing.firstSeenAt,
    lastSeenAt: timestamp,
  };
  counters().set(key, next);
  return next.count;
}

function clearBucket(key: string): void {
  counters().delete(key);
}

async function appendSecurityEventLogLine(line: string): Promise<void> {
  if (!isNodeRuntime()) return;

  const queue = globalThis.__agentWalletSecurityLogQueue || Promise.resolve();
  globalThis.__agentWalletSecurityLogQueue = queue
    .catch(() => undefined)
    .then(async () => {
      const [{ mkdir, appendFile }, path] = await Promise.all([
        import('node:fs/promises'),
        import('node:path'),
      ]);

      const absPath = path.resolve(process.cwd(), SECURITY_LOG_PATH);
      await mkdir(path.dirname(absPath), { recursive: true });
      await appendFile(absPath, line, 'utf8');
    })
    .catch((error) => {
      console.error('[SECURITY_ALERT] failed to append security event log', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

  await globalThis.__agentWalletSecurityLogQueue;
}

function emitSecurityAlert(event: SecurityEvent): void {
  const payload = redactSecretsInString(JSON.stringify(event));
  console.warn('[SECURITY_ALERT]', payload);
  void appendSecurityEventLogLine(`${payload}\n`);
}

export function resolveClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const candidate = forwardedFor.split(',')[0]?.trim();
    if (candidate) return candidate;
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflareIp) return cloudflareIp;

  const reqWithIp = request as NextRequest & { ip?: string };
  if (reqWithIp.ip?.trim()) return reqWithIp.ip.trim();

  return 'unknown';
}

export function recordSecurityEvent(input: {
  userId?: string | null;
  eventType: string;
  riskLevel: SecurityRiskLevel;
  ip?: string | null;
  details?: Record<string, unknown>;
}): SecurityEvent {
  const event: SecurityEvent = {
    timestamp: nowIso(),
    user_id: normalizeUserId(input.userId),
    event_type: input.eventType,
    risk_level: input.riskLevel,
    ip: input.ip?.trim() || 'unknown',
    ...(input.details ? { details: input.details } : {}),
  };
  emitSecurityAlert(event);
  return event;
}

export function getIpBlockStatus(ip: string): { blocked: boolean; entry?: BlockEntry } {
  const normalizedIp = ip.trim();
  if (!normalizedIp) return { blocked: false };

  const entry = blockedIps().get(normalizedIp);
  if (!entry) return { blocked: false };

  if (entry.blockedUntil <= nowMs()) {
    blockedIps().delete(normalizedIp);
    return { blocked: false };
  }

  return { blocked: true, entry };
}

export function blockIp(input: {
  ip: string;
  reason: string;
  riskLevel: SecurityRiskLevel;
  durationMs?: number;
  userId?: string | null;
  eventType?: string;
}): void {
  const normalizedIp = input.ip.trim();
  if (!normalizedIp || normalizedIp === 'unknown') return;

  const existing = getIpBlockStatus(normalizedIp);
  if (existing.blocked) return;

  const durationMs = input.durationMs ?? BLOCK_DURATION_MS;
  const blockedAt = nowMs();
  const blockedUntil = blockedAt + durationMs;

  blockedIps().set(normalizedIp, {
    ip: normalizedIp,
    reason: input.reason,
    riskLevel: input.riskLevel,
    blockedAt,
    blockedUntil,
  });

  recordSecurityEvent({
    userId: input.userId,
    eventType: input.eventType || 'ip_blocked',
    riskLevel: input.riskLevel,
    ip: normalizedIp,
    details: {
      reason: input.reason,
      blocked_until: new Date(blockedUntil).toISOString(),
      duration_ms: durationMs,
    },
  });
}

export function enforceSecurityIpBlock(request: NextRequest): NextResponse | null {
  const ip = resolveClientIp(request);
  const status = getIpBlockStatus(ip);
  if (!status.blocked || !status.entry) return null;

  recordSecurityEvent({
    eventType: 'blocked_request_attempt',
    riskLevel: 'high',
    ip,
    details: {
      path: request.nextUrl.pathname,
      blocked_until: new Date(status.entry.blockedUntil).toISOString(),
      reason: status.entry.reason,
    },
  });

  const retryAfterSeconds = Math.max(1, Math.ceil((status.entry.blockedUntil - nowMs()) / 1000));
  const response = NextResponse.json(
    {
      ok: false,
      error: 'Access temporarily blocked due to suspicious activity.',
    },
    { status: 403 },
  );
  response.headers.set('Retry-After', String(retryAfterSeconds));
  return response;
}

export function monitorFailedLoginAttempt(input: {
  ip: string;
  email?: string | null;
}): void {
  const normalizedIp = input.ip.trim() || 'unknown';
  const count = incrementBucket(bucketKey(['failed_login', normalizedIp]), FAILED_LOGIN_WINDOW_MS);
  incrementBucket(bucketKey(['failed_login_email', normalizeUserId(input.email)]), FAILED_LOGIN_WINDOW_MS);

  if (count >= FAILED_LOGIN_BLOCK_THRESHOLD) {
    blockIp({
      ip: normalizedIp,
      reason: 'Repeated failed login attempts',
      riskLevel: 'critical',
      durationMs: BLOCK_DURATION_SEVERE_MS,
      eventType: 'repeated_failed_login_attempts',
    });
    return;
  }

  if (count >= FAILED_LOGIN_ALERT_THRESHOLD) {
    recordSecurityEvent({
      userId: input.email,
      eventType: 'repeated_failed_login_attempts',
      riskLevel: 'high',
      ip: normalizedIp,
      details: {
        attempts_in_window: count,
        window_ms: FAILED_LOGIN_WINDOW_MS,
      },
    });
  }
}

export function clearLoginFailureSignals(input: {
  ip: string;
  email?: string | null;
}): void {
  clearBucket(bucketKey(['failed_login', input.ip]));
  if (input.email) {
    clearBucket(bucketKey(['failed_login_email', input.email]));
  }
}

export function monitorApiAbuse(input: {
  ip: string;
  path: string;
  reason?: string;
  userId?: string | null;
}): void {
  const normalizedIp = input.ip.trim() || 'unknown';
  const count = incrementBucket(bucketKey(['api_abuse', normalizedIp]), API_ABUSE_WINDOW_MS);

  if (count >= API_ABUSE_BLOCK_THRESHOLD) {
    blockIp({
      ip: normalizedIp,
      reason: `Repeated API abuse detected (${input.reason || 'rate limit'})`,
      riskLevel: 'critical',
      durationMs: BLOCK_DURATION_SEVERE_MS,
      userId: input.userId,
      eventType: 'api_abuse',
    });
    return;
  }

  if (count >= API_ABUSE_ALERT_THRESHOLD) {
    recordSecurityEvent({
      userId: input.userId,
      eventType: 'api_abuse',
      riskLevel: 'high',
      ip: normalizedIp,
      details: {
        attempts_in_window: count,
        window_ms: API_ABUSE_WINDOW_MS,
        path: input.path,
        reason: input.reason || 'rate_limited',
      },
    });
  }
}

export function monitorAccountLinkAttempt(input: {
  userId: string;
  ip: string;
  success: boolean;
  phase: 'create_link_token' | 'exchange_token';
}): void {
  const normalizedIp = input.ip.trim() || 'unknown';
  const key = bucketKey(['account_link_attempt', input.userId, normalizedIp]);
  const count = incrementBucket(key, ACCOUNT_LINK_WINDOW_MS);

  if (count >= ACCOUNT_LINK_BLOCK_THRESHOLD) {
    blockIp({
      ip: normalizedIp,
      reason: 'Rapid account linking attempts detected',
      riskLevel: 'high',
      durationMs: BLOCK_DURATION_MS,
      userId: input.userId,
      eventType: 'rapid_account_linking_attempts',
    });
    return;
  }

  if (count >= ACCOUNT_LINK_ALERT_THRESHOLD) {
    recordSecurityEvent({
      userId: input.userId,
      eventType: 'rapid_account_linking_attempts',
      riskLevel: 'medium',
      ip: normalizedIp,
      details: {
        attempts_in_window: count,
        window_ms: ACCOUNT_LINK_WINDOW_MS,
        phase: input.phase,
        success: input.success,
      },
    });
  }
}

function startOfDayMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function averageRecentSucceededDebitAmount(
  transactions: Array<{ amount: number; status: string; direction: string; createdAt: string }>,
): number {
  const recent = transactions
    .filter((tx) => tx.status === 'succeeded' && tx.direction === 'debit')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 20);

  if (recent.length === 0) return 0;
  const sum = recent.reduce((acc, tx) => acc + tx.amount, 0);
  return Math.round((sum / recent.length) * 100) / 100;
}

function sumTodaySucceededDebits(
  transactions: Array<{ amount: number; status: string; direction: string; createdAt: string }>,
): number {
  const dayStart = startOfDayMs();
  return Math.round(
    transactions.reduce((acc, tx) => {
      if (tx.status !== 'succeeded' || tx.direction !== 'debit') return acc;
      const createdAt = Date.parse(tx.createdAt);
      if (Number.isNaN(createdAt) || createdAt < dayStart) return acc;
      return acc + tx.amount;
    }, 0) * 100,
  ) / 100;
}

export function monitorTransactionBehavior(input: {
  userId: string;
  ip: string;
  amount: number;
  merchant?: string | null;
  category?: string | null;
  wallet: {
    balance: number;
    settings: {
      maxTransaction: number;
      dailyLimit: number;
    };
    transactions: Array<{ amount: number; status: string; direction: string; createdAt: string }>;
  };
}): void {
  const averageAmount = averageRecentSucceededDebitAmount(input.wallet.transactions);
  const todaySpent = sumTodaySucceededDebits(input.wallet.transactions);
  const projectedToday = Math.round((todaySpent + input.amount) * 100) / 100;

  const flags: string[] = [];
  if (input.amount > input.wallet.settings.maxTransaction * 1.5) {
    flags.push('exceeds_configured_max_transaction_by_50_percent');
  }
  if (averageAmount > 0 && input.amount >= averageAmount * 4) {
    flags.push('amount_is_4x_recent_average');
  }
  if (projectedToday > input.wallet.settings.dailyLimit * 1.5) {
    flags.push('projected_daily_spend_spike');
  }
  if (input.wallet.balance > 0 && input.amount >= input.wallet.balance * 0.9) {
    flags.push('near_full_balance_drain');
  }

  if (flags.length === 0) return;

  const risk: SecurityRiskLevel = flags.length >= 2 ? 'high' : 'medium';
  recordSecurityEvent({
    userId: input.userId,
    eventType: 'unusual_spending_spike',
    riskLevel: risk,
    ip: input.ip,
    details: {
      amount: input.amount,
      merchant: input.merchant || null,
      category: input.category || null,
      flags,
      average_recent_amount: averageAmount,
      today_spent: todaySpent,
      projected_today_spend: projectedToday,
      daily_limit: input.wallet.settings.dailyLimit,
    },
  });
}

export function monitorGuardrailViolation(input: {
  userId?: string | null;
  ip: string;
  context: string;
  reason: string;
  amount?: number;
  merchant?: string | null;
}): void {
  recordSecurityEvent({
    userId: input.userId,
    eventType: 'abnormal_transaction_behavior',
    riskLevel: 'high',
    ip: input.ip,
    details: {
      context: input.context,
      reason: input.reason,
      amount: input.amount ?? null,
      merchant: input.merchant || null,
    },
  });

  const violationCount = incrementBucket(
    bucketKey(['guardrail_violation', input.ip]),
    GUARDRAIL_VIOLATION_WINDOW_MS,
  );
  if (violationCount >= GUARDRAIL_VIOLATION_BLOCK_THRESHOLD) {
    blockIp({
      ip: input.ip,
      reason: 'Repeated blocked transaction attempts',
      riskLevel: 'high',
      durationMs: BLOCK_DURATION_MS,
      userId: input.userId,
      eventType: 'repeated_blocked_transaction_attempts',
    });
  }
}
