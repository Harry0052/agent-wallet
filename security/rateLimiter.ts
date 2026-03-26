import { NextRequest, NextResponse } from 'next/server';

export type RateLimitProfile = 'auth' | 'general';

type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  profile: RateLimitProfile;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const RATE_LIMITS: Record<RateLimitProfile, RateLimitConfig> = {
  auth: {
    maxRequests: 5,
    windowMs: 60_000,
  },
  general: {
    maxRequests: 60,
    windowMs: 60_000,
  },
};

const AUTH_RATE_LIMIT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]);

const CLEANUP_INTERVAL_MS = 5 * 60_000;
const BUCKET_TTL_MS = 10 * 60_000;

type RateLimitBucket = {
  count: number;
  resetAt: number;
  lastSeenAt: number;
};

declare global {
  var __agentWalletRateLimitBuckets: Map<string, RateLimitBucket> | undefined;
  var __agentWalletRateLimitLastCleanupAt: number | undefined;
}

function getBucketStore(): Map<string, RateLimitBucket> {
  if (!globalThis.__agentWalletRateLimitBuckets) {
    globalThis.__agentWalletRateLimitBuckets = new Map<string, RateLimitBucket>();
  }
  return globalThis.__agentWalletRateLimitBuckets;
}

function maybeCleanupBuckets(now: number): void {
  const lastCleanup = globalThis.__agentWalletRateLimitLastCleanupAt || 0;
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  const buckets = getBucketStore();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastSeenAt > BUCKET_TTL_MS) {
      buckets.delete(key);
    }
  }

  globalThis.__agentWalletRateLimitLastCleanupAt = now;
}

function resolveClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const candidate = forwardedFor.split(',')[0]?.trim();
    if (candidate) return candidate;
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflareIp) return cloudflareIp;

  const requestWithIp = request as NextRequest & { ip?: string };
  if (requestWithIp.ip?.trim()) return requestWithIp.ip.trim();

  return 'unknown';
}

function buildBucketKey(input: {
  ip: string;
  profile: RateLimitProfile;
  scope?: string;
}): string {
  const scope = input.scope?.trim() || 'global';
  return `${input.profile}:${scope}:${input.ip}`;
}

function toRateLimitResponse(result: RateLimitResult): NextResponse {
  const response = NextResponse.json(
    {
      ok: false,
      error: 'Too many requests. Please retry shortly.',
    },
    { status: 429 },
  );

  response.headers.set('Retry-After', String(result.retryAfterSeconds));
  response.headers.set('X-RateLimit-Limit', String(result.limit));
  response.headers.set('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
  response.headers.set('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)));
  return response;
}

function evaluateRateLimit(input: {
  profile: RateLimitProfile;
  ip: string;
  scope?: string;
}): RateLimitResult {
  const now = Date.now();
  maybeCleanupBuckets(now);

  const config = RATE_LIMITS[input.profile];
  const key = buildBucketKey({ ip: input.ip, profile: input.profile, scope: input.scope });
  const buckets = getBucketStore();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + config.windowMs;
    buckets.set(key, {
      count: 1,
      resetAt,
      lastSeenAt: now,
    });

    return {
      allowed: true,
      profile: input.profile,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      resetAt,
      retryAfterSeconds: Math.ceil(config.windowMs / 1000),
    };
  }

  existing.count += 1;
  existing.lastSeenAt = now;
  buckets.set(key, existing);

  const remaining = config.maxRequests - existing.count;
  const retryAfterMs = Math.max(0, existing.resetAt - now);

  return {
    allowed: existing.count <= config.maxRequests,
    profile: input.profile,
    limit: config.maxRequests,
    remaining,
    resetAt: existing.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

export function getRateLimitProfileForPath(pathname: string): RateLimitProfile | null {
  if (!pathname.startsWith('/api/')) return null;
  if (AUTH_RATE_LIMIT_PATHS.has(pathname)) return 'auth';
  return 'general';
}

export function enforceRateLimit(
  request: NextRequest,
  options: {
    profile?: RateLimitProfile;
    scope?: string;
  } = {},
): NextResponse | null {
  const profile = options.profile ?? getRateLimitProfileForPath(request.nextUrl.pathname);
  if (!profile) return null;

  const result = evaluateRateLimit({
    profile,
    ip: resolveClientIp(request),
    scope: options.scope || request.nextUrl.pathname,
  });

  if (result.allowed) return null;
  return toRateLimitResponse(result);
}
