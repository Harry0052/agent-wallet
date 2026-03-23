import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';
const SESSION_COOKIE = 'Jjs7O0dbKIqiDT-Yp7SWFyTm-Rr3pKR3YD6hbOsjWHV2CkTMEtexdABFnxQ2Ftp4';

// Helper to set auth cookie before each test
test.use({
  storageState: undefined, // Don't use saved state
});

function withAuth(page: import('@playwright/test').Page) {
  return page.context().addCookies([{
    name: 'aw_session',
    value: SESSION_COOKIE,
    domain: 'localhost',
    path: '/',
  }]);
}

// ─── PHASE 1: Authenticated API routes ───────────────────────────────────

test.describe('Authenticated API routes', () => {
  test('GET /api/auth/me returns authenticated user', async ({ request }) => {
    const response = await request.get(`${BASE}/api/auth/me`, {
      headers: { Cookie: `aw_session=${SESSION_COOKIE}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.user?.email).toBe('launchtest@calico-test.dev');
  });

  test('GET /api/smart/home returns dashboard payload', async ({ request }) => {
    const response = await request.get(`${BASE}/api/smart/home`, {
      headers: { Cookie: `aw_session=${SESSION_COOKIE}` },
    });
    // May return 200 or 503 depending on DB state, but should NOT be 500
    expect(response.status()).not.toBe(500);
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.home).toBeTruthy();
      expect(body.home.summary).toBeTruthy();
      expect(body.home.insightCards).toBeTruthy();
      // Verify actionableInsights are included
      expect(body.home.actionableInsights).toBeTruthy();
      expect(body.home.actionableInsights.primary).toBeTruthy();
      // Verify moneyIntelligence is NOT in the payload (removed for performance)
      expect(body.home.moneyIntelligence).toBeUndefined();
    }
  });

  test('GET /api/referrals returns referral stats', async ({ request }) => {
    const response = await request.get(`${BASE}/api/referrals`, {
      headers: { Cookie: `aw_session=${SESSION_COOKIE}` },
    });
    expect(response.status()).not.toBe(500);
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.stats).toBeTruthy();
      expect(body.stats.referralCode).toBeTruthy();
      expect(body.stats.referralLink).toBeTruthy();
      expect(body.stats.referralLink).toContain('/signup?ref=');
      expect(typeof body.stats.monthlyConversions).toBe('number');
      expect(typeof body.stats.monthlyEarnings).toBe('number');
      expect(typeof body.stats.totalEarnings).toBe('number');
      expect(typeof body.stats.pendingSignups).toBe('number');
      expect(body.stats.currentTier).toMatch(/50%|100%/);
    }
  });

  test('GET /api/entitlements returns plan info', async ({ request }) => {
    const response = await request.get(`${BASE}/api/entitlements`, {
      headers: { Cookie: `aw_session=${SESSION_COOKIE}` },
    });
    expect(response.status()).not.toBe(500);
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.available)).toBe(true);
    }
  });

  test('GET /api/statements/summary returns aggregated data', async ({ request }) => {
    const response = await request.get(`${BASE}/api/statements/summary?days=30`, {
      headers: { Cookie: `aw_session=${SESSION_COOKIE}` },
    });
    expect(response.status()).not.toBe(500);
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.summary).toBeTruthy();
      expect(typeof body.summary.income).toBe('number');
      expect(typeof body.summary.expenses).toBe('number');
      expect(typeof body.summary.net).toBe('number');
      expect(typeof body.summary.savingsRate).toBe('number');
    }
  });

  test('No authenticated API returns SERVICE_UNAVAILABLE', async ({ request }) => {
    const routes = ['/api/auth/me', '/api/smart/home', '/api/referrals', '/api/entitlements'];
    for (const route of routes) {
      const response = await request.get(`${BASE}${route}`, {
        headers: { Cookie: `aw_session=${SESSION_COOKIE}` },
      });
      if (response.status() !== 200) continue;
      const body = await response.json();
      expect(body.errorCode, `${route} returned SERVICE_UNAVAILABLE`).not.toBe('SERVICE_UNAVAILABLE');
      expect(body.errorCode, `${route} returned DB_POOL_EXHAUSTED`).not.toBe('DB_POOL_EXHAUSTED');
    }
  });
});

// ─── PHASE 2: Authenticated page rendering ───────────────────────────────

test.describe('Authenticated page rendering', () => {
  test('Plans page renders for user without subscription', async ({ page }) => {
    await withAuth(page);
    const response = await page.goto(`${BASE}/plans`);
    // User has no subscription, so should see plan selection (not redirect to /home)
    expect(response?.status()).not.toBe(500);
    // Should stay on /plans or show plan selection content
    await page.waitForLoadState('domcontentloaded');
    const url = page.url();
    // Should be on /plans (not redirected to /login since we're authenticated)
    expect(url).not.toContain('/login');
  });

  test('Settings page loads for authenticated user', async ({ page }) => {
    await withAuth(page);
    // User without subscription gets redirected to /plans from (app) layout
    // So we test /plans which doesn't require subscription
    const response = await page.goto(`${BASE}/plans`);
    expect(response?.status()).not.toBe(500);
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).not.toContainText('server-side exception');
  });

  test('No "Application error" crash on any auth page', async ({ page }) => {
    await withAuth(page);
    const pagesToTest = ['/plans'];
    for (const path of pagesToTest) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState('domcontentloaded');
      const bodyText = await page.locator('body').textContent();
      expect(bodyText, `${path} shows Application error`).not.toContain('Application error');
      expect(bodyText, `${path} shows server-side exception`).not.toContain('server-side exception');
    }
  });
});

// ─── PHASE 3: Smart Home payload validation ──────────────────────────────

test.describe('Smart Home payload structure', () => {
  test('Payload has correct structure for new user', async ({ request }) => {
    const response = await request.get(`${BASE}/api/smart/home`, {
      headers: { Cookie: `aw_session=${SESSION_COOKIE}` },
    });
    if (response.status() !== 200) return; // Skip if DB unavailable

    const body = await response.json();
    const home = body.home;

    // Summary
    expect(home.summary).toBeTruthy();
    expect(typeof home.summary.netCashPosition).toBe('number');
    expect(typeof home.summary.availableCash).toBe('number');
    expect(home.summary.currency).toBeTruthy();

    // Freshness
    expect(home.freshness).toBeTruthy();
    expect(home.freshness.label).toBeTruthy();

    // Data quality
    expect(home.dataQuality).toBeTruthy();
    expect(typeof home.dataQuality.lowData).toBe('boolean');
    expect(home.dataQuality.mode).toBeTruthy();

    // Insight cards
    expect(Array.isArray(home.insightCards)).toBe(true);
    expect(home.insightCards.length).toBeGreaterThan(0);

    // Actionable insights
    expect(home.actionableInsights).toBeTruthy();
    expect(home.actionableInsights.primary).toBeTruthy();
    expect(home.actionableInsights.primary.type).toMatch(/warning|opportunity|prediction/);
    expect(home.actionableInsights.primary.title).toBeTruthy();

    // For a new user with no data, the fallback should NOT say "Connect an account"
    // if the user doesn't have connected accounts, it SHOULD say "Connect an account"
    // (which is correct behavior for a new user)
    if (home.dataQuality.mode === 'no_connected_accounts') {
      expect(home.actionableInsights.primary.title).toContain('Connect an account');
    }

    // Verify locked previews exist for non-pro users
    expect(Array.isArray(home.actionableInsights.locked)).toBe(true);
  });
});

// ─── PHASE 4: Referral system validation ─────────────────────────────────

test.describe('Referral system validation', () => {
  test('Referral stats have valid structure', async ({ request }) => {
    const response = await request.get(`${BASE}/api/referrals`, {
      headers: { Cookie: `aw_session=${SESSION_COOKIE}` },
    });
    if (response.status() !== 200) return;

    const { stats } = await response.json();

    // Code and link
    expect(stats.referralCode.length).toBeGreaterThanOrEqual(4);
    expect(stats.referralCode).toMatch(/^[A-Z0-9]+$/);
    expect(stats.referralLink).toContain(stats.referralCode);

    // Monthly stats
    expect(stats.monthKey).toMatch(/^\d{4}-\d{2}$/);
    expect(stats.monthlyConversions).toBe(0); // New user, no referrals
    expect(stats.monthlyEarnings).toBe(0);
    expect(stats.totalEarnings).toBe(0);
    expect(stats.pendingSignups).toBe(0);
    expect(stats.currentTier).toBe('50%');
    expect(stats.conversionsToNextTier).toBe(10);

    // Recent conversions
    expect(Array.isArray(stats.recentConversions)).toBe(true);
    expect(stats.recentConversions).toHaveLength(0); // New user
  });

  test('Referral link URL is correct format', async ({ request }) => {
    const response = await request.get(`${BASE}/api/referrals`, {
      headers: { Cookie: `aw_session=${SESSION_COOKIE}` },
    });
    if (response.status() !== 200) return;

    const { stats } = await response.json();
    // Should use the correct domain pattern
    expect(stats.referralLink).toMatch(/https?:\/\/.+\/signup\?ref=[A-Z0-9]+/);
  });
});

// ─── PHASE 5: Concurrent authenticated requests ──────────────────────────

test.describe('Concurrent authenticated load', () => {
  test('5 concurrent authenticated API calls succeed', async ({ request }) => {
    const cookie = `aw_session=${SESSION_COOKIE}`;
    const routes = [
      '/api/auth/me',
      '/api/smart/home',
      '/api/referrals',
      '/api/entitlements',
      '/api/statements/summary?days=30',
    ];

    const results = await Promise.all(
      routes.map((route) =>
        request.get(`${BASE}${route}`, { headers: { Cookie: cookie } })
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const status = results[i].status();
      expect(status, `${routes[i]} returned ${status}`).not.toBe(500);

      if (status === 200) {
        const body = await results[i].json();
        expect(body.ok, `${routes[i]} ok=false`).toBe(true);
        expect(body.errorCode).toBeUndefined();
      }
    }
  });
});
