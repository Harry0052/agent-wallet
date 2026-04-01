import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

// ── .env.example completeness ───────────────────────────────────────

test('.env.example contains all required Plaid variables', () => {
  const example = read('.env.example');
  const required = ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV'];
  for (const key of required) {
    assert.ok(example.includes(key), `Missing ${key} in .env.example`);
  }
});

test('.env.example contains optional Plaid variables', () => {
  const example = read('.env.example');
  const optional = ['PLAID_WEBHOOK_URL', 'PLAID_REDIRECT_URI', 'PLAID_WEBHOOK_SHARED_SECRET'];
  for (const key of optional) {
    assert.ok(example.includes(key), `Missing ${key} in .env.example`);
  }
});

test('.env.example contains all startup-required secrets', () => {
  const example = read('.env.example');
  const required = [
    'DATABASE_URL',
    'AUTH_SESSION_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'PLAID_CLIENT_ID',
    'PLAID_SECRET',
    'DATA_ENCRYPTION_KEYRING',
    'OPENAI_API_KEY',
  ];
  for (const key of required) {
    assert.ok(example.includes(key), `Missing ${key} in .env.example`);
  }
});

// ── Plaid client config ─────────────────────────────────────────────

test('plaidClient uses getRequiredSecret for credentials', () => {
  const source = read('financial_connectors/plaidClient.ts');
  assert.match(source, /getRequiredSecret\("PLAID_CLIENT_ID"\)/);
  assert.match(source, /getRequiredSecret\("PLAID_SECRET"\)/);
});

test('plaidClient validates PLAID_ENV strictly', () => {
  const source = read('financial_connectors/plaidClient.ts');
  assert.match(source, /production/);
  assert.match(source, /development/);
  assert.match(source, /sandbox/);
  // Must reject invalid values
  assert.match(source, /Invalid or missing PLAID_ENV/);
});

test('plaidClient never exposes secrets in error messages', () => {
  const source = read('financial_connectors/plaidClient.ts');
  // The error message should reference PLAID_ENV value, not PLAID_SECRET
  assert.doesNotMatch(source, /secret.*error|error.*secret/i);
});

// ── Link token creation ─────────────────────────────────────────────

test('create-link-token route runs config check before Plaid call', () => {
  const source = read('app/api/connect/create-link-token/route.ts');
  const configCheckIdx = source.indexOf('checkPlaidConfig()');
  const createTokenIdx = source.indexOf('createUserLinkToken(');
  assert.ok(configCheckIdx !== -1, 'checkPlaidConfig() call not found');
  assert.ok(createTokenIdx !== -1, 'createUserLinkToken call not found');
  assert.ok(configCheckIdx < createTokenIdx, 'Config check must run before creating link token');
});

test('create-link-token route handles PlaidApiError with safe user message', () => {
  const source = read('app/api/connect/create-link-token/route.ts');
  assert.match(source, /PlaidApiError/);
  assert.match(source, /INVALID_API_KEYS/);
  // Must not expose internal Plaid error details to user
  assert.match(source, /temporarily unavailable/i);
});

// ── Exchange token ──────────────────────────────────────────────────

test('exchange-token route runs config check', () => {
  const source = read('app/api/connect/exchange-token/route.ts');
  assert.match(source, /checkPlaidConfig\(\)/);
});

test('exchange-token route validates public_token is non-empty', () => {
  const source = read('app/api/connect/exchange-token/route.ts');
  assert.match(source, /public_token.*min\(1\)|z\.string\(\).*trim\(\).*min\(1\)/);
});

// ── Frontend flow ───────────────────────────────────────────────────

test('connect service loads Plaid Link from official CDN', () => {
  const source = read('services/connect.ts');
  assert.match(source, /cdn\.plaid\.com\/link\/v2\/stable\/link-initialize\.js/);
});

test('connect service handles user cancel without showing error', () => {
  const source = read('services/connect.ts');
  assert.match(source, /USER_CANCELED/);
});

test('onboarding surfaces real Plaid error instead of generic message', () => {
  const source = read('components/onboarding/PersonaOnboarding.tsx');
  // Should log the error for diagnostics
  assert.match(source, /console\.error.*Plaid connect failed/i);
});

// ── OAuth redirect ──────────────────────────────────────────────────

test('OAuth page stores state ID and redirects to /connect', () => {
  const source = read('app/plaid/oauth/page.tsx');
  assert.match(source, /plaid_oauth_state_id/);
  assert.match(source, /window\.location\.replace.*\/connect/);
});

test('connect service consumes OAuth state ID from sessionStorage', () => {
  const source = read('services/connect.ts');
  assert.match(source, /consumePlaidOAuthStateId/);
  assert.match(source, /sessionStorage\.getItem.*plaid_oauth_state_id/);
  assert.match(source, /sessionStorage\.removeItem.*plaid_oauth_state_id/);
});

// ── Security ────────────────────────────────────────────────────────

test('Plaid secrets are loaded via secretsManager, not process.env directly', () => {
  const source = read('financial_connectors/plaidClient.ts');
  // PLAID_CLIENT_ID and PLAID_SECRET must use getRequiredSecret, not process.env
  assert.doesNotMatch(source, /process\.env\.PLAID_CLIENT_ID/);
  assert.doesNotMatch(source, /process\.env\.PLAID_SECRET/);
});

test('plaidClient uses server-only import', () => {
  const source = read('financial_connectors/plaidClient.ts');
  assert.match(source, /import "server-only"/);
});

test('linkService uses server-only import', () => {
  const source = read('financial_connectors/linkService.ts');
  assert.match(source, /import "server-only"/);
});

test('tokenVault uses server-only import', () => {
  const source = read('financial_connectors/tokenVault.ts');
  assert.match(source, /import "server-only"/);
});

// ── Config check utility ────────────────────────────────────────────

test('plaidConfigCheck module exists and exports checkPlaidConfig', () => {
  const source = read('lib/server/plaidConfigCheck.ts');
  assert.match(source, /export function checkPlaidConfig/);
  assert.match(source, /PlaidConfigStatus/);
  assert.match(source, /PLAID_CLIENT_ID/);
  assert.match(source, /PLAID_SECRET/);
  assert.match(source, /PLAID_ENV/);
});

test('plaidConfigCheck warns about missing PLAID_REDIRECT_URI in production', () => {
  const source = read('lib/server/plaidConfigCheck.ts');
  assert.match(source, /PLAID_REDIRECT_URI/);
  assert.match(source, /production/);
});
