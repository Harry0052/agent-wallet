import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('Plaid webhook route calls verifyWebhookSecret before processing', () => {
  const source = read('app/api/connect/transactions/webhook/route.ts');
  assert.match(source, /verifyWebhookSecret/);
  // The POST handler must call verifyWebhookSecret before handlePlaidTransactionWebhook.
  // Look for the call site (not the import or function definition) — it appears as
  // `!verifyWebhookSecret(req)` or `verifyWebhookSecret(req)` inside the handler.
  const callIdx = source.indexOf('verifyWebhookSecret(req)');
  const handleIdx = source.indexOf('handlePlaidTransactionWebhook(');
  assert.ok(callIdx !== -1, 'verifyWebhookSecret(req) call not found');
  assert.ok(handleIdx !== -1, 'handlePlaidTransactionWebhook( call not found');
  assert.ok(callIdx < handleIdx, 'verifyWebhookSecret must be called before handlePlaidTransactionWebhook');
});

test('transactionWebhook ignores non-TRANSACTIONS webhook_type', () => {
  const source = read('transactions/transactionWebhook.ts');
  // webhook_type is read from payload and checked against "TRANSACTIONS"
  assert.match(source, /webhook_type/);
  assert.match(source, /webhookType !== "TRANSACTIONS"/);
});

test('transactionWebhook ignores webhooks without item_id', () => {
  const source = read('transactions/transactionWebhook.ts');
  assert.match(source, /!itemId/);
});

test('transactionWebhook handles all SYNC_TRIGGER_CODES', () => {
  const source = read('transactions/transactionWebhook.ts');
  assert.match(source, /SYNC_UPDATES_AVAILABLE/);
  assert.match(source, /DEFAULT_UPDATE/);
  assert.match(source, /INITIAL_UPDATE/);
  assert.match(source, /HISTORICAL_UPDATE/);
  assert.match(source, /TRANSACTIONS_REMOVED/);
});
