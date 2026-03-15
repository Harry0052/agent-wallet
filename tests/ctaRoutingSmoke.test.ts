import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}


// All user-facing component files (excluding landing page, legacy)
const COMPONENT_FILES = [
  'components/home/SmartWalletHome.tsx',
  'components/accounts/AccountsView.tsx',
  'components/transactions/TransactionsView.tsx',
  'components/subscriptions/SubscriptionsView.tsx',
  'components/cashflow/CashFlowView.tsx',
  'components/budgets/BudgetsView.tsx',
  'components/goals/GoalsView.tsx',
  'components/reports/ReportsView.tsx',
  'components/insights/InsightsView.tsx',
  'components/settings/SettingsPage.tsx',
  'components/onboarding/OnboardingFlow.tsx',
  'components/connect/ConnectWorkspace.tsx',
  'components/AppNav.tsx',
  'components/AppLayoutShell.tsx',
];

const VALID_APP_ROUTES = [
  '/home',
  '/accounts',
  '/transactions',
  '/recurring',
  '/cashflow',
  '/budgets',
  '/goals',
  '/investments',
  '/reports',
  '/subscriptions',
  '/insights',
  '/settings',
  '/connect',
  '/login',
  '/signup',
  '/onboarding',
  '/pricing',
];

// ── Test 1: No debug/internal text in user-facing components ──────────────────

test('no internal debug text in user-facing components', () => {
  const FORBIDDEN_STRINGS = [
    'Validation Debug',
    'Trust + Capability',
    'Funding Infrastructure',
    'Connected Apps (Secondary)',
    'trust state',
    'capability',
    'debug telemetry',
    'agent wallet',
    'tinyfish',
    'procurement',
    'sourcing',
  ];

  for (const file of COMPONENT_FILES) {
    const source = read(file);
    for (const forbidden of FORBIDDEN_STRINGS) {
      const lower = source.toLowerCase();
      const idx = lower.indexOf(forbidden.toLowerCase());
      assert.equal(
        idx,
        -1,
        `Found "${forbidden}" in ${file} at char ${idx}. Internal text must not appear in user-facing components.`,
      );
    }
  }
});

// ── Test 2: Every href="/connect" is paired with a connect-related label ──────

test('all /connect links have connect-related labels', () => {
  const CONNECT_LABEL_PATTERN = /connect|link.*account|add.*account|manage.*account/i;

  for (const file of COMPONENT_FILES) {
    const source = read(file);
    // Find all href="/connect" and check surrounding ~200 chars for label
    let pos = 0;
    while (true) {
      const idx = source.indexOf('href="/connect"', pos);
      if (idx === -1) break;
      const context = source.slice(Math.max(0, idx - 50), idx + 250);
      // Extract text content between > and < after the href
      const labelMatch = context.match(/>\s*([^<]{1,60})\s*</g);
      const labels = (labelMatch ?? []).map(m => m.replace(/^>\s*/, '').replace(/\s*<$/, ''));
      const hasConnectLabel = labels.some(l => CONNECT_LABEL_PATTERN.test(l));
      assert.ok(
        hasConnectLabel,
        `${file}: href="/connect" link does not have a connect-related label. Labels found: ${JSON.stringify(labels)}`,
      );
      pos = idx + 1;
    }
  }
});

// ── Test 3: No non-connect button routes to /connect ──────────────────────────

test('no onClick handlers route to /connect unless connect-labeled', () => {
  const CONNECT_ROUTE_PATTERN = /window\.location\.href\s*=\s*["'"]\/connect["'"]/;
  const ROUTER_PUSH_CONNECT = /router\.(push|replace)\s*\(\s*["'"]\/connect["'"]/;

  for (const file of COMPONENT_FILES) {
    const source = read(file);
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (CONNECT_ROUTE_PATTERN.test(line) || ROUTER_PUSH_CONNECT.test(line)) {
        // Check surrounding lines for label context
        const context = lines.slice(Math.max(0, i - 5), i + 5).join('\n');
        const hasConnectLabel = /connect|manage.*account|link.*account/i.test(context);
        assert.ok(
          hasConnectLabel,
          `${file}:${i + 1}: Routes to /connect but nearby context has no connect-related label.`,
        );
      }
    }
  }
});

// ── Test 4: Navigation links point to valid routes ────────────────────────────

test('sidebar/nav links point to valid app routes', () => {
  const navSource = read('components/AppNav.tsx');
  const hrefMatches = navSource.match(/href:\s*"([^"]+)"/g) ?? [];
  const hrefs = hrefMatches.map(m => {
    const match = m.match(/href:\s*"([^"]+)"/);
    return match ? match[1] : '';
  }).filter(Boolean);

  assert.ok(hrefs.length >= 5, `Expected at least 5 nav links, found ${hrefs.length}`);

  for (const href of hrefs) {
    assert.ok(
      VALID_APP_ROUTES.includes(href),
      `Nav link "${href}" is not in the valid app routes: ${VALID_APP_ROUTES.join(', ')}`,
    );
  }
});

// ── Test 5: Home CTA routing is correct ───────────────────────────────────────

test('Home page CTAs route correctly', () => {
  // SmartWalletHome delegates to CustomizableDashboard which renders widgets.
  // "Connect an account" CTAs live in individual dashboard widgets.
  const widgetSource = read('components/dashboard/TransactionsWidget.tsx');
  assert.match(widgetSource, /Connect an account/);
  assert.match(widgetSource, /\/connect/);

  // Transactions routing exists in the transactions widget
  assert.match(widgetSource, /\/transactions/);

  // Should NOT have any router.push to /connect in home
  const homeSource = read('components/home/SmartWalletHome.tsx');
  assert.doesNotMatch(homeSource, /router\.push.*\/connect/);
});

// ── Test 6: Transactions empty state routes correctly ─────────────────────────

test('Transactions empty state CTA routes to /connect with connect label', () => {
  const source = read('components/transactions/TransactionsView.tsx');
  assert.match(source, /Connect an account/);
  // Component uses window.location.href or href prop to route to /connect
  assert.match(source, /\/connect/);
  const connectCount = (source.match(/["']\/connect["']/g) ?? []).length;
  assert.ok(connectCount <= 2, `Expected at most 2 /connect references in Transactions, found ${connectCount}`);
});

// ── Test 7: Subscriptions empty state routes correctly ────────────────────────

test('Subscriptions empty state CTA routes to /connect with connect label', () => {
  const source = read('components/subscriptions/SubscriptionsView.tsx');
  assert.match(source, /Connect an account/);
  // Component uses window.location.href to route to /connect
  assert.match(source, /\/connect/);
  const connectCount = (source.match(/["']\/connect["']/g) ?? []).length;
  assert.ok(connectCount <= 2, `Expected at most 2 /connect references in Subscriptions, found ${connectCount}`);
});

// ── Test 8: Insights empty state routes correctly ─────────────────────────────

test('Insights empty state CTA routes to /connect with connect label', () => {
  const source = read('components/insights/InsightsView.tsx');
  assert.match(source, /Connect an account/);
  assert.match(source, /href="\/connect"/);
  const connectCount = (source.match(/href="\/connect"/g) ?? []).length;
  assert.ok(connectCount <= 1, `Expected at most 1 /connect link in Insights, found ${connectCount}`);
});

// ── Test 9: Settings buttons map to correct actions ───────────────────────────

test('Settings page has correct action mapping', () => {
  const source = read('components/settings/SettingsPage.tsx');

  // Profile opens edit-profile modal
  assert.match(source, /edit-profile/);
  assert.match(source, /EditProfileModal/);

  // Security opens security modal
  assert.match(source, /security/);
  assert.match(source, /SecuritySettingsModal/);

  // Notifications opens notification modal
  assert.match(source, /notifications/);
  assert.match(source, /NotificationSettingsModal/);

  // Connected Accounts goes to /connect
  assert.match(source, /\/connect/);

  // Logout calls logout function
  assert.match(source, /logout\(\)/);
});

// ── Test 10: Connect page is clean (no debug sections) ────────────────────────

test('Connect page has no debug/internal sections', () => {
  const source = read('components/connect/ConnectWorkspace.tsx');
  assert.doesNotMatch(source, /Validation Debug/i);
  assert.doesNotMatch(source, /Trust \+ Capability/i);
  assert.doesNotMatch(source, /Funding Infrastructure/i);
  assert.doesNotMatch(source, /Connected Apps.*Secondary/i);
  assert.doesNotMatch(source, /UNSUPPORTED_APPS/);
  assert.doesNotMatch(source, /fetchSmartTelemetry/);

  // Should have only Plaid-related account management
  assert.match(source, /connectAccountsViaSupportedFlow/);
  assert.match(source, /removeConnectedAccount/);
  assert.match(source, /Add account|Connect an account/);
});

// ── Test 11: Onboarding connect step routes correctly ─────────────────────────

test('Onboarding connect step routes to /connect with correct label', () => {
  const source = read('components/onboarding/OnboardingFlow.tsx');
  assert.match(source, /Connect account/);
  assert.match(source, /href="\/connect"/);
  assert.match(source, /Skip for now/);

  // Skip for now should NOT go to /connect
  const skipIndex = source.indexOf('Skip for now');
  const nearbyAfterSkip = source.slice(Math.max(0, skipIndex - 200), skipIndex + 200);
  assert.doesNotMatch(
    nearbyAfterSkip,
    /href="\/connect"/,
    'Skip for now must not route to /connect',
  );
});

// ── Test 12: No component has a catch-all fallback to /connect ────────────────

test('no component has a generic fallback routing to /connect', () => {
  for (const file of COMPONENT_FILES) {
    const source = read(file);
    // Check for patterns like: default: ... /connect or fallback ... /connect
    assert.doesNotMatch(
      source,
      /default:\s*['"]\/connect['"]/,
      `${file} has a default case routing to /connect`,
    );
    assert.doesNotMatch(
      source,
      /fallback.*['"]\/connect['"]/i,
      `${file} has a fallback routing to /connect`,
    );
  }
});

// ── Test 13: Button labels match their destinations ───────────────────────────

test('CTA labels match expected destinations across all components', () => {
  const LABEL_ROUTE_MAP: Array<{ label: RegExp; expectedRoute: RegExp; description: string }> = [
    { label: /Review transactions/i, expectedRoute: /\/transactions/, description: 'Review transactions should go to /transactions' },
    { label: /View transactions/i, expectedRoute: /\/transactions/, description: 'View transactions should go to /transactions' },
    { label: /View subscriptions/i, expectedRoute: /\/subscriptions/, description: 'View subscriptions should go to /subscriptions' },
    { label: /Review recurring/i, expectedRoute: /\/subscriptions/, description: 'Review recurring should go to /subscriptions' },
  ];

  for (const file of COMPONENT_FILES) {
    const source = read(file);
    for (const rule of LABEL_ROUTE_MAP) {
      if (rule.label.test(source)) {
        assert.match(
          source,
          rule.expectedRoute,
          `${file}: ${rule.description}`,
        );
      }
    }
  }
});
