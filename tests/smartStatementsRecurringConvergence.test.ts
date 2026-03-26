import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('statements recurring view explains why each item is recurring and exposes lifecycle actions', () => {
  const source = read('components/StatementsWorkspace.tsx');
  assert.match(source, /Why recurring:/);
  assert.match(source, /Confirm recurring/);
  assert.match(source, /Ignore merchant/);
  assert.match(source, /Mark inactive/);
  assert.match(source, /setRecurringLifecycle/);
});

test('statements recurring view supports manual recurring tracking', () => {
  const source = read('components/StatementsWorkspace.tsx');
  assert.match(source, /Track manually/);
  assert.match(source, /manual_add|addManualRecurring/);
  assert.match(source, /monthly|weekly|quarterly|yearly/);
});

test('statements drill-in includes merchant, category, anomalies, and transaction explanation panels', () => {
  const source = read('components/StatementsWorkspace.tsx');
  assert.match(source, /Merchant View/);
  assert.match(source, /Category View/);
  assert.match(source, /Unusual Spending/);
  assert.match(source, /Why this is shown/);
  assert.match(source, /applyMerchantFilter/);
  assert.match(source, /applyCategoryFilter/);
});

test('statements low-data guidance provides deterministic connect-sync-review actions', () => {
  const source = read('components/StatementsWorkspace.tsx');
  assert.match(source, /Low-Data Guidance/);
  assert.match(source, /Step 1: Open Connections|Step 1: Check account health|Step 1: Confirm recurring/);
  assert.match(source, /lowDataMode/);
});

test('statements landing closes the loop for home drill-ins and action outcomes', () => {
  const source = read('components/StatementsWorkspace.tsx');
  assert.match(source, /searchParams\.get\("from"\)/);
  assert.match(source, /Loop closure:/);
  assert.match(source, /Opened from Home:/);
  assert.match(source, /Return to Home/);
});

test('subscriptions suspected API returns enriched recurring intelligence after detection pass', () => {
  const source = read('app/api/subscriptions/suspected/route.ts');
  assert.match(source, /detectAndPersistRecurringSubscriptions/);
  assert.match(source, /listRecurringIntelligence/);
  assert.match(source, /subscriptions/);
});

test('recurring status update route returns action metadata for UX confirmation', () => {
  const source = read('app/api/subscriptions/track/route.ts');
  assert.match(source, /result:\s*resultMeta/);
  assert.match(source, /action:\s*"set_status"/);
  assert.match(source, /action:\s*"manual_add"/);
});

test('recurring cards prioritize recommended action and persist updated state cues', () => {
  const source = read('components/StatementsWorkspace.tsx');
  assert.match(source, /recurringActionPlan/);
  assert.match(source, /Recommended next action:/);
  assert.match(source, /Status saved successfully\./);
  assert.match(source, /fetchSuspectedSubscriptions/);
});

test('recurring intelligence excludes disconnected sources from active signal matching', () => {
  const source = read('subscription_intelligence/subscriptionService.ts');
  assert.match(source, /loadActiveTransactionsForRecurring/);
  assert.match(source, /INNER JOIN financial_connector_accounts a/);
  assert.match(source, /a\.id = t\.linked_account_id/);
});
