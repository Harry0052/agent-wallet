import test from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedApi, isProtectedPage } from '../lib/auth/protection.ts';

test('protected page detection covers app surfaces', () => {
  assert.equal(isProtectedPage('/onboarding'), true);
  assert.equal(isProtectedPage('/operator'), true);
  assert.equal(isProtectedPage('/wallet'), true);
  assert.equal(isProtectedPage('/dashboard/reconciliation'), true);
  assert.equal(isProtectedPage('/login'), false);
  assert.equal(isProtectedPage('/forgot-password'), false);
  assert.equal(isProtectedPage('/reset-password'), false);
  assert.equal(isProtectedPage('/'), false);
});

test('protected API detection excludes auth and webhooks', () => {
  assert.equal(isProtectedApi('/api/wallet'), true);
  assert.equal(isProtectedApi('/api/tools/connect'), true);
  assert.equal(isProtectedApi('/api/auth/login'), false);
  assert.equal(isProtectedApi('/api/stripe/webhook'), false);
  assert.equal(isProtectedApi('/api/webhooks/stripe'), false);
});
