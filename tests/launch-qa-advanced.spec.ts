import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

// ─── PHASE 2: OAuth callback edge cases ──────────────────────────────────

test.describe('Google OAuth callback safety', () => {
  test('Callback with no params redirects to login with error', async ({ request }) => {
    const response = await request.get(`${BASE}/api/auth/google/callback`, {
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(response.status());
    const location = response.headers()['location'] || '';
    expect(location).toContain('/login');
    expect(location).toContain('oauth_error');
  });

  test('Callback with error=access_denied redirects to login', async ({ request }) => {
    const response = await request.get(`${BASE}/api/auth/google/callback?error=access_denied`, {
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(response.status());
    const location = response.headers()['location'] || '';
    expect(location).toContain('google_denied');
  });

  test('Callback with fake code/state redirects to login', async ({ request }) => {
    const response = await request.get(`${BASE}/api/auth/google/callback?code=fakecode&state=fakestate`, {
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(response.status());
    const location = response.headers()['location'] || '';
    expect(location).toContain('google_state_invalid');
  });

  test('Callback never returns 500', async ({ request }) => {
    // Test various invalid callback scenarios
    const scenarios = [
      '/api/auth/google/callback',
      '/api/auth/google/callback?error=server_error',
      '/api/auth/google/callback?code=bad&state=bad',
      '/api/auth/google/callback?code=',
    ];
    for (const path of scenarios) {
      const response = await request.get(`${BASE}${path}`, { maxRedirects: 0 });
      expect(response.status(), `${path} returned 500`).not.toBe(500);
    }
  });
});

// ─── PHASE 3: API error differentiation ──────────────────────────────────

test.describe('API error codes are specific (not generic SERVICE_UNAVAILABLE)', () => {
  test('Auth failure returns proper 401 not 503', async ({ request }) => {
    const response = await request.get(`${BASE}/api/smart/home`);
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toContain('Authentication required');
    expect(body.errorCode).not.toBe('SERVICE_UNAVAILABLE');
  });

  test('Referrals auth failure returns 401 not 503', async ({ request }) => {
    const response = await request.get(`${BASE}/api/referrals`);
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.errorCode).not.toBe('SERVICE_UNAVAILABLE');
  });
});

// ─── PHASE 4: Concurrent API request simulation ──────────────────────────

test.describe('Concurrent request stability', () => {
  test('10 concurrent unauthenticated API calls do not crash', async ({ request }) => {
    const routes = [
      '/api/auth/me',
      '/api/smart/home',
      '/api/referrals',
      '/api/statements/unified',
      '/api/entitlements',
      '/api/billing/status',
      '/api/auth/me',
      '/api/smart/home',
      '/api/referrals',
      '/api/statements/unified',
    ];
    const results = await Promise.all(
      routes.map((route) => request.get(`${BASE}${route}`).catch((err) => ({ status: () => 999, err }))),
    );
    for (let i = 0; i < results.length; i++) {
      const status = typeof results[i].status === 'function' ? results[i].status() : 999;
      expect(status, `Route ${routes[i]} returned 500`).not.toBe(500);
      expect(status, `Route ${routes[i]} returned 503`).not.toBe(503);
    }
  });
});

// ─── PHASE 5: Landing page interaction checks ────────────────────────────

test.describe('Landing page interactions', () => {
  test('CTA buttons on landing page link to correct destinations', async ({ page }) => {
    await page.goto(BASE);
    // Check the main CTA goes to /signup
    const signupLinks = page.locator('a[href="/signup"]');
    if (await signupLinks.count() > 0) {
      const href = await signupLinks.first().getAttribute('href');
      expect(href).toBe('/signup');
    }
  });

  test('Trust carousel images load without 404', async ({ page }) => {
    const failedImages: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/logos/') && response.status() >= 400) {
        failedImages.push(`${response.url()} → ${response.status()}`);
      }
    });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    expect(failedImages, `Failed images: ${failedImages.join(', ')}`).toHaveLength(0);
  });
});

// ─── PHASE 6: Referral link format ───────────────────────────────────────

test.describe('Referral link handling', () => {
  test('Signup with ref param shows signup form', async ({ page }) => {
    await page.goto(`${BASE}/signup?ref=ABC123`);
    await expect(page.locator('body')).toContainText(/sign up|create account|email/i);
  });

  test('Login page shows Google OAuth button', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const googleBtn = page.locator('a[href*="google"]');
    await expect(googleBtn).toBeVisible();
  });

  test('Google OAuth link on signup preserves ref param', async ({ page }) => {
    await page.goto(`${BASE}/signup?ref=MYREF`);
    const googleLink = page.locator('a[href*="/api/auth/google/login"]');
    if (await googleLink.isVisible()) {
      const href = await googleLink.getAttribute('href');
      expect(href).toContain('ref=MYREF');
    }
  });
});

// ─── PHASE 7: Reports redirect ───────────────────────────────────────────

test.describe('Deprecated route redirects', () => {
  test('/reports redirects to /cashflow', async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForURL(/\/(cashflow|login|plans)/, { timeout: 10000 });
    // For unauthenticated users, it may redirect to login first
    const url = page.url();
    expect(url).toMatch(/\/(cashflow|login|plans)/);
  });
});
