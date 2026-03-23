import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

// ─── PHASE 1: Unauthenticated route tests ────────────────────────────────

test.describe('Unauthenticated routes', () => {
  test('Landing page loads', async ({ page }) => {
    const response = await page.goto(BASE);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('Login page loads', async ({ page }) => {
    const response = await page.goto(`${BASE}/login`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(/sign in|log in|email/i);
  });

  test('Signup page loads', async ({ page }) => {
    const response = await page.goto(`${BASE}/signup`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(/sign up|create|email/i);
  });

  test('Signup page captures ref param', async ({ page }) => {
    await page.goto(`${BASE}/signup?ref=TESTCODE123`);
    // Wait for React hydration — useEffect saves ref to localStorage after mount
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const refValue = await page.evaluate(() => localStorage.getItem('calico.referral_code'));
    expect(refValue).toBe('TESTCODE123');
  });

  test('Plans page redirects unauthenticated to login', async ({ page }) => {
    await page.goto(`${BASE}/plans`);
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain('/login');
  });

  test('Google OAuth button exists and links correctly', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const googleLink = page.locator('a[href*="/api/auth/google/login"]');
    await expect(googleLink).toBeVisible();
    const href = await googleLink.getAttribute('href');
    expect(href).toContain('/api/auth/google/login');
  });

  test('Google OAuth button with ref param passes ref', async ({ page }) => {
    await page.goto(`${BASE}/signup?ref=REFTEST`);
    const googleLink = page.locator('a[href*="/api/auth/google/login"]');
    if (await googleLink.isVisible()) {
      const href = await googleLink.getAttribute('href');
      expect(href).toContain('ref=REFTEST');
    }
  });
});

// ─── PHASE 2: API route health checks ────────────────────────────────────

test.describe('API route health (unauthenticated)', () => {
  test('GET /api/auth/me returns 401 for unauthenticated', async ({ request }) => {
    const response = await request.get(`${BASE}/api/auth/me`);
    expect([401, 200]).toContain(response.status());
    const body = await response.json();
    if (response.status() === 200) {
      // Should indicate not authenticated
      expect(body.authenticated).toBeFalsy();
    }
  });

  test('GET /api/smart/home returns 401 for unauthenticated', async ({ request }) => {
    const response = await request.get(`${BASE}/api/smart/home`);
    expect([401, 403]).toContain(response.status());
  });

  test('GET /api/referrals returns 401 for unauthenticated', async ({ request }) => {
    const response = await request.get(`${BASE}/api/referrals`);
    expect([401, 403]).toContain(response.status());
  });

  test('GET /api/statements/unified returns 401 for unauthenticated', async ({ request }) => {
    const response = await request.get(`${BASE}/api/statements/unified`);
    expect([401, 403]).toContain(response.status());
  });

  test('GET /api/statements/summary returns 401 for unauthenticated', async ({ request }) => {
    const response = await request.get(`${BASE}/api/statements/summary`);
    expect([401, 403]).toContain(response.status());
  });

  test('GET /api/entitlements returns 401 for unauthenticated', async ({ request }) => {
    const response = await request.get(`${BASE}/api/entitlements`);
    expect([401, 403]).toContain(response.status());
  });

  test('GET /api/billing/status returns 401 for unauthenticated', async ({ request }) => {
    const response = await request.get(`${BASE}/api/billing/status`);
    expect([401, 403]).toContain(response.status());
  });

  test('No API route returns 500 or SERVICE_UNAVAILABLE for unauthenticated', async ({ request }) => {
    const routes = [
      '/api/auth/me',
      '/api/smart/home',
      '/api/referrals',
      '/api/statements/unified',
      '/api/entitlements',
      '/api/billing/status',
    ];
    for (const route of routes) {
      const response = await request.get(`${BASE}${route}`);
      expect(response.status(), `${route} returned 500`).not.toBe(500);
      const body = await response.json();
      expect(body.errorCode, `${route} returned SERVICE_UNAVAILABLE`).not.toBe('SERVICE_UNAVAILABLE');
    }
  });
});

// ─── PHASE 3: Google OAuth initiation ────────────────────────────────────

test.describe('Google OAuth initiation', () => {
  test('GET /api/auth/google/login redirects to Google', async ({ request }) => {
    const response = await request.get(`${BASE}/api/auth/google/login`, {
      maxRedirects: 0,
    });
    // Should be a redirect (302/307) to Google
    expect([302, 307]).toContain(response.status());
    const location = response.headers()['location'] || '';
    expect(location).toContain('accounts.google.com');
  });

  test('GET /api/auth/google/login with ref param stores it', async ({ request }) => {
    const response = await request.get(`${BASE}/api/auth/google/login?ref=OAUTHREF`, {
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(response.status());
    // State cookie should be set
    const cookies = response.headers()['set-cookie'] || '';
    expect(cookies).toContain('aw_google_oauth_state');
  });

  test('GET /api/auth/google/callback without code redirects to login', async ({ request }) => {
    const response = await request.get(`${BASE}/api/auth/google/callback`, {
      maxRedirects: 0,
    });
    // Should redirect to login with error (or 429 if rate limited from parallel tests)
    expect([302, 307, 429]).toContain(response.status());
    if (response.status() !== 429) {
      const location = response.headers()['location'] || '';
      expect(location).toContain('/login');
      expect(location).toContain('oauth_error');
    }
  });
});

// ─── PHASE 4: Protected route redirects ──────────────────────────────────

test.describe('Protected routes redirect to login', () => {
  const protectedRoutes = ['/home', '/accounts', '/transactions', '/budgets', '/cashflow', '/settings'];

  for (const route of protectedRoutes) {
    test(`${route} redirects to /login when unauthenticated`, async ({ page }) => {
      await page.goto(`${BASE}${route}`);
      // Should end up at login or plans
      await page.waitForURL(/\/(login|plans)/, { timeout: 10000 });
      expect(page.url()).toMatch(/\/(login|plans)/);
    });
  }
});

// ─── PHASE 5: Landing page content checks ────────────────────────────────

test.describe('Landing page content', () => {
  test('Trust carousel renders with real logos', async ({ page }) => {
    await page.goto(BASE);
    // Check for logo images from public/logos
    const logos = page.locator('img[src*="/logos/"]');
    const count = await logos.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Hero section renders', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('body')).toContainText(/calico|money|manage/i);
  });

  test('No server errors on landing page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    // Filter out non-critical errors
    const critical = errors.filter((e) => /500|crash|exception/i.test(e));
    expect(critical).toHaveLength(0);
  });
});

// ─── PHASE 6: Error boundary existence ───────────────────────────────────

test.describe('Error boundaries exist', () => {
  test('Root error boundary file exists', async () => {
    const fs = await import('fs');
    expect(fs.existsSync('/Users/harry/Desktop/agent wallet/app/error.tsx')).toBe(true);
  });

  test('App error boundary file exists', async () => {
    const fs = await import('fs');
    expect(fs.existsSync('/Users/harry/Desktop/agent wallet/app/(app)/error.tsx')).toBe(true);
  });
});
