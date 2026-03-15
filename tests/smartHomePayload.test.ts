import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('smart home API uses buildSmartHomePayload as source of truth', () => {
  const source = read('app/api/smart/home/route.ts');
  assert.match(source, /buildSmartHomePayload/);
  assert.match(source, /NextResponse\.json\(\{\s*ok:\s*true,\s*home:\s*payload/s);
});

test('smart home payload defines exactly five canonical insight card ids', () => {
  const source = read('lib/server/smartHome.ts');
  assert.match(source, /'found_money'/);
  assert.match(source, /'unusual_spending'/);
  assert.match(source, /'recurring_bills'/);
  assert.match(source, /'budget_risk'/);
  assert.match(source, /'connection_health'/);
  assert.match(source, /const cards: SmartHomeInsightCard\[\] = \[/);
  assert.match(source, /insightCards: cards/);
});

test('home payload includes top summary, freshness, trust, and drill-in strips', () => {
  const source = read('lib/server/smartHome.ts');
  assert.match(source, /summary:\s*\{/);
  assert.match(source, /netCashPosition/);
  assert.match(source, /availableCash/);
  assert.match(source, /upcomingBills7d/);
  assert.match(source, /outlook30dDelta/);
  assert.match(source, /freshness:\s*\{/);
  assert.match(source, /walletStrip:\s*\[/);
  assert.match(source, /statementsStrip:\s*\[/);
  assert.match(source, /trust:\s*\{/);
});

test('home payload includes explicit low-data mode and ordered next-best actions', () => {
  const source = read('lib/server/smartHome.ts');
  assert.match(source, /resolveLowDataMode/);
  assert.match(source, /mode:\s*lowDataMode/);
  assert.match(source, /nextBestActions:\s*lowDataNextBestActions/);
  assert.match(source, /Step 1:/);
  assert.match(source, /Step 2:/);
  assert.match(source, /Step 3:/);
});
