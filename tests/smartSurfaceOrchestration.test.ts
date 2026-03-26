import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('smart surface route uses unified intent->context->composition pipeline', () => {
  const source = read('app/api/smart/surface/route.ts');
  assert.match(source, /routeSmartSurfaceIntent/);
  assert.match(source, /assembleSmartSurfaceContext/);
  assert.match(source, /composeSmartSurfaceResult/);
  assert.match(source, /POST\(req: NextRequest\)/);
});

test('smart surface route does not expose research/general/task modes', () => {
  const source = read('app/api/smart/surface/route.ts');
  assert.doesNotMatch(source, /research/i);
  assert.doesNotMatch(source, /general chat/i);
  assert.doesNotMatch(source, /task mode/i);
});

test('smart surface context assembly pulls wallet, statements, recurring, and connection health', () => {
  const source = read('lib/server/smartSurface/contextAssembly.ts');
  assert.match(source, /getWallet/);
  assert.match(source, /listSavedFundingMethods/);
  assert.match(source, /listNormalizedTransactions/);
  assert.match(source, /detectAndPersistRecurringSubscriptions/);
  assert.match(source, /listConnectedAccounts/);
  assert.match(source, /listConnectedApps/);
  assert.match(source, /trust:/);
});

test('internal actions runtime remains behind explicit boundary flag', () => {
  const source = read('lib/server/smartSurface/actionsRuntimeBoundary.ts');
  assert.match(source, /SMART_WALLET_INTERNAL_ACTIONS_RUNTIME/);
});
