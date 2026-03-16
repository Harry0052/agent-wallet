import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('task center route is auth protected, rate-limited, and command-driven', () => {
  const source = read('app/api/tasks/center/route.ts');
  assert.match(source, /enforceApiAuth/);
  assert.match(source, /enforceRateLimit/);
  assert.match(source, /command:\s*z\.literal\('detect'\)/);
  assert.match(source, /command:\s*z\.literal\('attempt'\)/);
  assert.match(source, /command:\s*z\.literal\('policy_update'\)/);
});

test('task center UI and navigation are wired', () => {
  const page = read('app/(app)/tasks/page.tsx');
  const nav = read('components/AppNav.tsx');
  const view = read('components/tasks/TaskCenterView.tsx');
  assert.match(page, /TaskCenterView/);
  assert.match(nav, /"\/tasks"/);
  assert.match(view, /detectTaskCenterActions/);
  assert.match(view, /attemptTaskCenterAction/);
});

test('automation summary is exposed in smart home and unified statements surfaces', () => {
  const smartHome = read('lib/server/smartHome.ts');
  const statementsRoute = read('app/api/statements/unified/route.ts');
  const adviceWidget = read('components/dashboard/AdviceWidget.tsx');
  const statementsView = read('components/StatementsWorkspace.tsx');

  assert.match(smartHome, /getAutomationSummaryForUser/);
  assert.match(smartHome, /automation:/);
  assert.match(statementsRoute, /automation:/);
  assert.match(adviceWidget, /Open Task Center/);
  assert.match(statementsView, /Automation Task Center/);
});
