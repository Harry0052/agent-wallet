import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

// ── Launch Blocker #2: AI command route uses Zod + prompt guard ─────────────

test('ai command route uses validateJsonBody and assertPromptSafe', () => {
  const source = read('app/api/ai/command/route.ts');
  assert.match(source, /validateJsonBody/);
  assert.match(source, /assertPromptSafe/);
  assert.match(source, /z\.object/);
  assert.match(source, /CommandSchema/);
});

// ── Launch Blocker #3: Password reset token echo blocked in production ──────

test('forgot-password route blocks token echo in production', () => {
  const source = read('app/api/auth/forgot-password/route.ts');
  assert.match(source, /NODE_ENV.*!==.*production/);
  assert.match(source, /AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN/);
});

// ── Launch Blocker #4: Login route does not return raw error messages ────────

test('login route sanitizes internal error messages', () => {
  const source = read('app/api/auth/login/route.ts');
  assert.match(source, /database|pool|connection|timeout|internal/i);
  assert.match(source, /Service temporarily unavailable/);
});

// ── High Priority #5: Account remove route validates params with Zod ────────

test('account remove route validates route params with Zod', () => {
  const source = read('app/api/connect/accounts/[id]/remove/route.ts');
  assert.match(source, /ParamsSchema/);
  assert.match(source, /z\.object/);
  assert.match(source, /ParamsSchema\.parse/);
});

// ── High Priority #6: Security headers configured in next.config ────────────

test('next.config.js includes security headers', () => {
  const source = read('next.config.js');
  assert.match(source, /X-Content-Type-Options/);
  assert.match(source, /nosniff/);
  assert.match(source, /X-Frame-Options/);
  assert.match(source, /DENY/);
  assert.match(source, /Referrer-Policy/);
  assert.match(source, /Permissions-Policy/);
});

// ── Existing auth: session cache invalidation on revoke ─────────────────────

test('session revocation clears in-memory cache', () => {
  const source = read('lib/server/auth.ts');
  // revokeSessionByToken must delete from SESSION_CACHE
  assert.match(source, /revokeSessionByToken/);
  assert.match(source, /SESSION_CACHE\.delete/);
});

// ── Existing auth: password reset revokes all sessions ──────────────────────

test('password reset revokes all user sessions in database', () => {
  const source = read('lib/server/auth.ts');
  assert.match(source, /resetPasswordWithToken/);
  // Must UPDATE app_user_sessions SET revoked_at for the user
  assert.match(source, /UPDATE app_user_sessions\s+SET revoked_at = NOW\(\)/s);
});

// ── Existing auth: password reset tokens are single-use ─────────────────────

test('password reset tokens are consumed atomically', () => {
  const source = read('lib/server/auth.ts');
  // Must use CTE to atomically consume token
  assert.match(source, /WITH consumed AS/);
  assert.match(source, /SET consumed_at = NOW\(\)/);
  assert.match(source, /consumed_at IS NULL/);
  assert.match(source, /expires_at > NOW\(\)/);
});

// ── Existing auth: debug health endpoint requires auth ──────────────────────

test('debug health endpoint requires authentication', () => {
  const source = read('app/api/debug/health/route.ts');
  assert.match(source, /enforceApiAuth/);
});

// ── Error message sanitization in account removal ───────────────────────────

test('account removal route sanitizes error messages', () => {
  const source = read('app/api/connect/accounts/[id]/remove/route.ts');
  assert.match(source, /Service temporarily unavailable/);
});
