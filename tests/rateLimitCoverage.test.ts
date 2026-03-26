import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return results;

  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'route.ts') {
        results.push(full.replace(ROOT + '/', ''));
      }
    }
  }
  walk(abs);
  return results.sort();
}

// ── Webhook routes are excluded from rate limiting ──────────────────────────
const WEBHOOK_ROUTES = new Set([
  'app/api/connect/transactions/webhook/route.ts',
  'app/api/stripe/webhook/route.ts',
  'app/api/stripe/webhooks/route.ts',
  'app/api/webhooks/stripe/route.ts',
]);

// ── OAuth routes have rate limiting in their controller, not the route file ─
const OAUTH_ROUTES = new Set([
  'app/api/auth/google/login/route.ts',
  'app/api/auth/google/callback/route.ts',
  'app/api/auth/apple/login/route.ts',
  'app/api/auth/apple/callback/route.ts',
]);

test('every non-webhook API route has enforceRateLimit', () => {
  const routes = findRouteFiles('app/api');
  const missing: string[] = [];

  for (const route of routes) {
    if (WEBHOOK_ROUTES.has(route)) continue;
    if (OAUTH_ROUTES.has(route)) continue;

    const source = read(route);
    if (!source.includes('enforceRateLimit')) {
      missing.push(route);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Routes missing enforceRateLimit:\n${missing.join('\n')}`,
  );
});

test('OAuth controller routes have rate limiting in their controllers', () => {
  const googleCtrl = read('auth/oauth/googleOAuthController.ts');
  const appleCtrl = read('auth/oauth/appleOAuthController.ts');

  assert.match(googleCtrl, /enforceRateLimit/, 'Google OAuth controller must have enforceRateLimit');
  assert.match(appleCtrl, /enforceRateLimit/, 'Apple OAuth controller must have enforceRateLimit');
});

test('auth rate limit window is at least 15 minutes', () => {
  const source = read('security/rateLimiter.ts');
  // The auth config should have windowMs >= 900000 (15 * 60 * 1000)
  const authMatch = source.match(/auth:\s*\{[^}]*windowMs:\s*(\d[\d_*\s]*)/s);
  assert.ok(authMatch, 'auth rate limit config must exist');

  // Evaluate the expression (e.g., "15 * 60_000")
  const windowExpr = authMatch[1].replace(/_/g, '');
  const windowMs = Function(`return ${windowExpr}`)();
  assert.ok(windowMs >= 900_000, `auth windowMs must be >= 900000 (15min), got ${windowMs}`);
});

test('auth rate limit allows max 5 requests', () => {
  const source = read('security/rateLimiter.ts');
  const authMatch = source.match(/auth:\s*\{[^}]*maxRequests:\s*(\d+)/s);
  assert.ok(authMatch, 'auth rate limit config must exist');
  const max = parseInt(authMatch[1], 10);
  assert.ok(max <= 5, `auth maxRequests must be <= 5, got ${max}`);
});

test('webhook routes have signature verification instead of rate limiting', () => {
  for (const route of WEBHOOK_ROUTES) {
    if (!existsSync(join(ROOT, route))) continue;
    const source = read(route);
    // Re-export routes (e.g., stripe/webhooks -> stripe/webhook) inherit verification
    const isReExport = /export\s*\{.*POST.*\}\s*from/.test(source);
    const hasVerification = source.includes('stripe-signature')
      || source.includes('plaid-verification')
      || source.includes('verifyWebhookSecret')
      || isReExport;
    assert.ok(hasVerification, `Webhook route ${route} must have signature verification or re-export`);
  }
});

test('request body size limit is enforced in validator', () => {
  const source = read('security/requestValidator.ts');
  assert.match(source, /MAX_BODY_BYTES/, 'requestValidator must define MAX_BODY_BYTES');
  assert.match(source, /413/, 'requestValidator must return 413 for oversized bodies');
});
