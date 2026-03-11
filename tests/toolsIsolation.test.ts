import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('tool vault queries are user-scoped for CRUD operations', () => {
  const source = read('lib/server/toolsVault.ts');
  assert.match(source, /WHERE ut\.user_id = \$1\s+AND ut\.id = \$2/);
  assert.match(source, /WHERE id = \$2\s+AND user_id = \$3/);
  assert.match(source, /WHERE id = \$1\s+AND user_id = \$2/);
});

test('runtime credential resolution requires userId and returns references only', () => {
  const source = read('lib/server/toolsVault.ts');
  const start = source.indexOf('export async function resolveRuntimeCredentialReference');
  assert.notEqual(start, -1);
  const snippet = source.slice(start, Math.min(source.length, start + 3200));
  assert.match(snippet, /input: \{\s*userId: string;/);
  assert.match(snippet, /resolved:\s*true[\s\S]*hasMetadata: Boolean\(vault\.encrypted_metadata\)/);
  assert.doesNotMatch(snippet, /credentialText:|credential:/);
});

test('tool config API enforces authenticated user scoped access', () => {
  const source = read('app/api/tools/[id]/config/route.ts');
  assert.match(source, /const userId = await getWalletUserId\(\)/);
  assert.match(source, /getToolConfigForUser\(\{[\s\S]*userId,[\s\S]*userToolId: id/);
  assert.match(source, /upsertToolConfigForUser\(\{[\s\S]*userId,[\s\S]*userToolId: id/);
});

test('tool config storage is encrypted at rest', () => {
  const dbSchema = read('db/schema.sql');
  const vaultSource = read('lib/server/toolsVault.ts');
  assert.match(dbSchema, /CREATE TABLE IF NOT EXISTS user_tool_configs/);
  assert.match(dbSchema, /encrypted_config TEXT NOT NULL/);
  assert.match(vaultSource, /encryptVaultValue\(input\.config\)/);
  assert.match(vaultSource, /decryptVaultValue\(row\.encrypted_config, row\.key_version\)/);
});
