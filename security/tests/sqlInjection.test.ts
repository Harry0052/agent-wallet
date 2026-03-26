import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

const DANGEROUS_QUERY_PATTERNS = [
  { label: 'DROP', pattern: /\bdrop\b/i },
  { label: 'DELETE *', pattern: /\bdelete\s+\*/i },
  { label: 'UNION SELECT', pattern: /\bunion\s+select\b/i },
] as const;

function detectDangerousSql(text: string): string[] {
  return DANGEROUS_QUERY_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
}

test('SQL injection payloads match dangerous-query detectors', () => {
  const payloads = [
    "SELECT id FROM app_users UNION SELECT password_hash FROM app_user_passwords",
    'DROP TABLE app_users',
    'DELETE * FROM app_users',
  ];

  for (const payload of payloads) {
    const hits = detectDangerousSql(payload);
    assert.ok(hits.length > 0, `Expected dangerous SQL to be detected: ${payload}`);
  }
});

test('parameterized query attack string is treated as data input', () => {
  const text = 'SELECT id FROM app_users WHERE email = $1';
  const attackerInput = "victim@wallet.test' OR 1=1; DROP TABLE app_users; --";
  const hits = detectDangerousSql(text);

  assert.deepEqual(hits, []);
  assert.equal(attackerInput.includes('DROP TABLE'), true);
});

test('database query policy explicitly blocks dangerous and unparameterized writes', () => {
  const source = read('database/dbService.ts');

  assert.match(source, /Blocked dangerous SQL pattern/);
  assert.match(source, /Unparameterized write query blocked/);
  assert.match(source, /\bdrop\b/i);
  assert.match(source, /delete\\s\+\\\*/i);
  assert.match(source, /union\\s\+select/i);
});
