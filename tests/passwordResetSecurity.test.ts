import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('password reset tokens are HMAC-hashed with dedicated secret support', () => {
  const source = read('lib/server/auth.ts');
  assert.match(source, /function getPasswordResetSecret\(\)/);
  assert.match(source, /function hashPasswordResetToken\(token: string\)/);
  assert.match(source, /createHmac\('sha256', getPasswordResetSecret\(\)\)/);
});

test('password reset issuance stores hashed token with expiration and consumes prior active tokens', () => {
  const source = read('lib/server/auth.ts');
  assert.match(source, /UPDATE app_password_reset_tokens[\s\S]*consumed_at = NOW\(\)[\s\S]*user_id = \$1[\s\S]*consumed_at IS NULL/);
  assert.match(source, /INSERT INTO app_password_reset_tokens[\s\S]*token_hash[\s\S]*expires_at/);
  assert.match(source, /PASSWORD_RESET_TTL_MS/);
});

test('password reset confirmation enforces single-use valid token and revokes sessions', () => {
  const source = read('lib/server/auth.ts');
  assert.match(source, /UPDATE app_password_reset_tokens[\s\S]*token_hash = \$1[\s\S]*consumed_at IS NULL[\s\S]*expires_at > NOW\(\)/);
  assert.match(source, /INSERT INTO app_user_passwords[\s\S]*ON CONFLICT \(user_id\)[\s\S]*password_hash = EXCLUDED\.password_hash/);
  assert.match(source, /UPDATE app_user_sessions[\s\S]*revoked_at = NOW\(\)[\s\S]*user_id = \$1/);
});

test('forgot-password route avoids account enumeration and supports optional dev token echo', () => {
  const source = read('app/api/auth/forgot-password/route.ts');
  assert.match(source, /If an account exists for that email, reset instructions have been sent\./);
  assert.match(source, /AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN/);
  assert.match(source, /issued\.token \|\| randomBytes\(48\)\.toString\('base64url'\)/);
});

test('reset-password route validates password confirmation and clears session cookie on success', () => {
  const source = read('app/api/auth/reset-password/route.ts');
  assert.match(source, /confirmPassword/);
  assert.match(source, /Passwords do not match/);
  assert.match(source, /clearSessionCookie\(response\)/);
});
