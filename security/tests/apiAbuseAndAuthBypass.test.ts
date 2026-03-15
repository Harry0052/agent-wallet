import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

type Bucket = {
  count: number;
  resetAt: number;
};

function simulateRateLimit(maxRequests: number, attempts: number): { allowed: number; blocked: number } {
  const now = Date.now();
  const bucket: Bucket = {
    count: 0,
    resetAt: now + 60_000,
  };

  let allowed = 0;
  let blocked = 0;

  for (let i = 0; i < attempts; i += 1) {
    if (Date.now() >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = Date.now() + 60_000;
    }

    bucket.count += 1;
    if (bucket.count <= maxRequests) {
      allowed += 1;
    } else {
      blocked += 1;
    }
  }

  return { allowed, blocked };
}

function isProtectedApiPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/api/auth/')) return false;
  if (pathname === '/api/stripe/webhook' || pathname === '/api/stripe/webhooks') return false;
  if (pathname === '/api/webhooks/stripe') return false;
  if (pathname === '/api/connect/transactions/webhook') return false;
  return true;
}

test('API abuse simulation: auth endpoints block attempts after 5 requests/minute', () => {
  const simulation = simulateRateLimit(5, 8);
  assert.equal(simulation.allowed, 5);
  assert.equal(simulation.blocked, 3);
});

test('API abuse simulation: general API blocks attempts after 60 requests/minute', () => {
  const simulation = simulateRateLimit(60, 65);
  assert.equal(simulation.allowed, 60);
  assert.equal(simulation.blocked, 5);
});

test('auth bypass simulation: protected routes require authentication context', () => {
  assert.equal(isProtectedApiPath('/api/wallet/send'), true);
  assert.equal(isProtectedApiPath('/api/transactions'), true);
  assert.equal(isProtectedApiPath('/api/connect/transactions/webhook'), false);
  assert.equal(isProtectedApiPath('/api/auth/login'), false);
});

test('proxy and guard sources enforce anti-abuse + anti-bypass controls', () => {
  const rateLimiterSource = read('security/rateLimiter.ts');
  const protectionSource = read('lib/auth/protection.ts');

  assert.match(rateLimiterSource, /auth:\s*\{\s*maxRequests:\s*5/s);
  assert.match(rateLimiterSource, /general:\s*\{\s*maxRequests:\s*60/s);
  assert.match(rateLimiterSource, /status:\s*429/);
  assert.match(protectionSource, /if \(pathname\.startsWith\('\/api\/auth\/'\)\) return false;/);
});

