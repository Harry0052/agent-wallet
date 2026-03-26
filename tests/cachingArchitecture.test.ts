import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function read(path: string): string { return readFileSync(join(ROOT, path), 'utf8'); }

// ── 1. cache.ts exports the required public API ────────────────────────────

test('cache.ts exports fetchWithCache, readFromCache, writeToCache, invalidateCache, clearAllCaches, setCacheUserId, FRESHNESS, onCacheRevalidate', () => {
  const src = read('lib/cache.ts');
  const requiredExports = [
    'fetchWithCache',
    'readFromCache',
    'writeToCache',
    'invalidateCache',
    'clearAllCaches',
    'setCacheUserId',
    'FRESHNESS',
    'onCacheRevalidate',
  ];
  for (const name of requiredExports) {
    assert.ok(
      new RegExp(`export\\s+(function|const|async\\s+function)\\s+${name}\\b`).test(src),
      `cache.ts must export "${name}"`,
    );
  }
});

// ── 2. cache.ts user-scopes all keys with userId prefix pattern ─────────────

test('cache.ts user-scopes keys with userId prefix pattern', () => {
  const src = read('lib/cache.ts');
  // The cache must build keys that include the userId so different users
  // never share cached data. Look for userId in key-building logic.
  assert.ok(
    /userId|currentUserId|user_id/.test(src),
    'cache.ts must reference userId for key scoping',
  );
  // Verify a key-building function or template literal includes userId
  assert.ok(
    /calico:cache:/.test(src) || /`[^`]*\$\{[^}]*(userId|currentUserId)[^}]*\}/.test(src),
    'cache.ts must include userId in the cache key namespace',
  );
});

// ── 3. cache.ts clearAllCaches removes calico:cache: prefix entries ─────────

test('cache.ts clearAllCaches removes calico:cache: prefix entries', () => {
  const src = read('lib/cache.ts');
  assert.ok(
    /clearAllCaches/.test(src),
    'cache.ts must define clearAllCaches',
  );
  assert.ok(
    /calico:cache:/.test(src),
    'cache.ts must use "calico:cache:" prefix for localStorage keys',
  );
  // clearAllCaches should iterate localStorage and remove matching keys
  assert.ok(
    /localStorage\.removeItem|localStorage\.clear|\.delete/.test(src),
    'clearAllCaches must remove entries from storage',
  );
});

// ── 4. useCachedFetch.ts exports useCachedFetch hook ────────────────────────

test('useCachedFetch.ts exports useCachedFetch hook', () => {
  const src = read('lib/useCachedFetch.ts');
  assert.ok(
    /export\s+function\s+useCachedFetch/.test(src),
    'useCachedFetch.ts must export useCachedFetch',
  );
});

// ── 5. useFinancialData.ts imports from cache module ────────────────────────

test('useFinancialData.ts imports readFromCache or writeToCache from cache module', () => {
  const src = read('lib/useFinancialData.ts');
  assert.ok(
    /import\s+\{[^}]*(readFromCache|writeToCache)[^}]*\}\s+from\s+['"]@\/lib\/cache['"]/.test(src),
    'useFinancialData.ts must import readFromCache or writeToCache from @/lib/cache',
  );
});

// ── 6. cacheInvalidation.ts exports invalidation helpers ────────────────────

test('cacheInvalidation.ts exports onTransactionSyncComplete, onCategoryCorrected, onBudgetUpdated, onAccountChanged', () => {
  const src = read('lib/cacheInvalidation.ts');
  const required = [
    'onTransactionSyncComplete',
    'onCategoryCorrected',
    'onBudgetUpdated',
    'onAccountChanged',
  ];
  for (const name of required) {
    assert.ok(
      new RegExp(`export\\s+function\\s+${name}\\b`).test(src),
      `cacheInvalidation.ts must export "${name}"`,
    );
  }
});

// ── 7. auth.ts imports clearAllCaches for logout ────────────────────────────

test('auth.ts calls clearAllCaches on logout', () => {
  const src = read('services/auth.ts');
  assert.ok(
    /clearAllCaches/.test(src),
    'auth.ts must reference clearAllCaches',
  );
  assert.ok(
    /clearAllCaches\s*\(/.test(src),
    'auth.ts must call clearAllCaches()',
  );
});

// ── 8. FRESHNESS object defines policies for key domains ────────────────────

test('FRESHNESS object defines policies for dashboard, transactions, accounts, balances, budgets, subscriptions, statements', () => {
  const src = read('lib/cache.ts');
  const domains = [
    'dashboard',
    'transactions',
    'accounts',
    'balances',
    'budgets',
    'subscriptions',
    'statements',
  ];
  for (const domain of domains) {
    assert.ok(
      new RegExp(`${domain}\\s*:`).test(src),
      `FRESHNESS must define a policy for "${domain}"`,
    );
  }
});

// ── 9. No sensitive data in cache key patterns ──────────────────────────────

test('No sensitive data in cache key patterns (no tokens, passwords in cache keys)', () => {
  const src = read('lib/cache.ts');
  // Cache key building logic should never include tokens or passwords
  assert.ok(
    !/password|secret|api_key|access_token|refresh_token/.test(src.toLowerCase()),
    'cache.ts must not reference passwords, secrets, or tokens in key patterns',
  );
});

// ── 10. Cache entries are scoped — key contains userId segment ──────────────

test('Cache entries are scoped — key contains userId segment', () => {
  const src = read('lib/cache.ts');
  // The buildKey or cacheKey function should embed userId into the key string
  // Look for a function that builds keys with userId included
  const keyBuildPattern = /function\s+\w*[Kk]ey\b[^{]*\{[^}]*userId|currentUserId/s;
  const templatePattern = /`[^`]*(userId|currentUserId)[^`]*`/;
  const concatPattern = /(userId|currentUserId)\s*[+,]/;
  assert.ok(
    keyBuildPattern.test(src) || templatePattern.test(src) || concatPattern.test(src),
    'Cache key building must include userId for per-user scoping',
  );
});
