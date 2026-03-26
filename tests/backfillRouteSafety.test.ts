import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'app/api/ai/backfill/route.ts'),
  'utf8',
);

test('backfill route remains admin-only and validates engine input', () => {
  assert.match(
    SOURCE,
    /enforceApiAuth\(request,\s*\{\s*requiredRoles:\s*\['admin'\]\s*\}\)/,
  );
  assert.match(
    SOURCE,
    /z\.enum\(\['insights',\s*'tasks',\s*'health',\s*'cashflow',\s*'all'\]\)/,
  );
});

test('backfill route requires explicit confirmation for cross-user runs', () => {
  assert.match(SOURCE, /confirmTargetUser/);
  assert.match(
    SOURCE,
    /confirmTargetUser=true is required when backfilling another user\./,
  );
});

test('backfill route returns typed result envelope for auditability', () => {
  assert.match(SOURCE, /type BackfillAllResult/);
  assert.match(SOURCE, /result,/);
  assert.match(SOURCE, /engine\.backfill\.api\.complete/);
});
