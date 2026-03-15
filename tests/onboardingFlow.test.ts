import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('onboarding persistence schema exists with per-user ownership', () => {
  const schema = read('db/schema.sql');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS app_user_onboarding_states/);
  assert.match(schema, /user_id TEXT PRIMARY KEY/);
  assert.match(schema, /onboarding_step TEXT NOT NULL DEFAULT 'welcome'/);
  assert.match(schema, /onboarding_completed_at TIMESTAMPTZ/);
  assert.match(schema, /FOREIGN KEY \(user_id\)[\s\S]*REFERENCES app_users\(id\)[\s\S]*ON DELETE CASCADE/);
});

test('protected app layout requires authenticated app access with onboarding gating', () => {
  const source = read('app/(app)/layout.tsx');
  assert.match(source, /await requireAuthenticatedAppAccess\(/);
  assert.match(source, /loginRedirect:\s*'\/login'/);
  assert.match(source, /onboardingRedirect:\s*'\/onboarding'/);
});

test('auth routes return redirect destination based on onboarding state', () => {
  const signupRoute = read('app/api/auth/signup/route.ts');
  const loginRoute = read('app/api/auth/login/route.ts');
  assert.match(signupRoute, /redirectTo:\s*await getPostAuthRedirectPath\(created\.appUserId\)/);
  assert.match(loginRoute, /redirectTo:\s*await getPostAuthRedirectPath\(user\.appUserId\)/);
});

test('onboarding API is authenticated and exposes wallet/profile setup state', () => {
  const source = read('app/api/onboarding/route.ts');
  assert.match(source, /requireAuthenticatedUser\(\)/);
  assert.match(source, /getWallet\(user\.walletUserId\)/);
  assert.match(source, /getUserAutofillProfile\(user\.walletUserId\)/);
  assert.match(source, /completeOnboarding\(/);
  assert.match(source, /updateOnboardingState\(/);
});

test('onboarding UI initializes wallet, saves profile, and supports skip flow', () => {
  const source = read('components/onboarding/OnboardingFlow.tsx');
  assert.match(source, /fetch\(["']\/api\/wallet\/init["']/);
  assert.match(source, /fetch\(["']\/api\/wallet\/profile["']/);
  assert.match(source, /fetch\(["']\/api\/onboarding["']/);
  assert.match(source, /Connect account/);
  assert.match(source, /Skip for now/);
});

test('onboarding page redirects completed users to home', () => {
  const source = read('app/onboarding/page.tsx');
  assert.match(source, /requirePendingOnboarding\('\/home'\)/);
});
