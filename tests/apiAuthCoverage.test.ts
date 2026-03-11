import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';
const API_ROOT = join(ROOT, 'app/api');

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...walk(full));
      continue;
    }
    if (entry === 'route.ts') files.push(full);
  }
  return files;
}

function toRepoPath(abs: string): string {
  return abs.replace(`${ROOT}/`, '');
}

function isPublicRoute(path: string): boolean {
  if (path.startsWith('app/api/auth/')) return true;
  if (path === 'app/api/stripe/webhook/route.ts') return true;
  if (path === 'app/api/stripe/webhooks/route.ts') return true;
  if (path === 'app/api/webhooks/stripe/route.ts') return true;
  return false;
}

test('all protected API routes enforce authenticated user context in-handler', () => {
  const files = walk(API_ROOT).map(toRepoPath).sort();
  const protectedFiles = files.filter((file) => !isPublicRoute(file));

  const offenders: string[] = [];
  for (const file of protectedFiles) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const hasAuthGuard = /getWalletUserId\(|requireAuthenticatedUser\(|getAuthenticatedUser\(/.test(source);
    if (!hasAuthGuard) offenders.push(file);
  }

  assert.deepEqual(offenders, []);
});
