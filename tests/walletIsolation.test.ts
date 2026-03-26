import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('wallet routes resolve wallet user id from authenticated context', () => {
  const walletRoutes = [
    'app/api/wallet/route.ts',
    'app/api/wallet/send/route.ts',
    'app/api/wallet/settings/route.ts',
    'app/api/wallet/recipients/route.ts',
    'app/api/wallet/profile/route.ts',
    'app/api/wallet/subscription-debit/route.ts',
    'app/api/wallet/init/route.ts',
  ];

  for (const route of walletRoutes) {
    const source = read(route);
    assert.match(source, /await\s+getWalletUserId\(|enforceApiAuth\(/, `${route} must resolve user-scoped wallet identity`);
  }
});

test('ledger wallet/transaction queries are user scoped', () => {
  const source = read('lib/server/ledger.ts');
  assert.match(source, /WHERE\s+user_id\s*=\s*\$1/);
  assert.match(source, /FROM\s+ledger_entries[\s\S]*WHERE\s+user_id\s*=\s*\$1/);
  assert.match(source, /INSERT INTO\s+ledger_entries[\s\S]*user_id/);
});

test('app user has explicit wallet ownership relation in schema', () => {
  const schema = read('db/schema.sql');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS app_users[\s\S]*wallet_user_id TEXT NOT NULL UNIQUE/);
  assert.match(schema, /ADD CONSTRAINT fk_app_users_wallet_user_id/);
  assert.match(schema, /FOREIGN KEY \(wallet_user_id\)[\s\S]*REFERENCES wallet_users\(user_id\)/);
});
