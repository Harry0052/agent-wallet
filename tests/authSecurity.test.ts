import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../lib/auth/password.ts';

test('hashPassword stores scrypt hash and verifyPassword validates it', async () => {
  process.env.AUTH_SESSION_SECRET = 'test-auth-session-secret-with-32-plus-chars';
  const hash = await hashPassword('very-strong-password');

  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(await verifyPassword('very-strong-password', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
});

test('hashPassword enforces minimum password length', async () => {
  await assert.rejects(
    hashPassword('short'),
    (error: unknown) => error instanceof Error && error.message.includes('at least'),
  );
});
