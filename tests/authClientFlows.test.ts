import test from 'node:test';
import assert from 'node:assert/strict';
import {
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  signup,
} from '../services/auth.ts';

test('signup posts expected payload and succeeds on ok response', async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method || 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  await signup({ email: 'user@example.com', password: 'Password123' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/auth/signup');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body, JSON.stringify({ email: 'user@example.com', password: 'Password123' }));
});

test('login throws on authentication failure response', async () => {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid email or password.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  await assert.rejects(
    login({ email: 'user@example.com', password: 'bad' }),
    (error: unknown) => error instanceof Error && error.message.includes('Invalid email or password'),
  );
});

test('logout posts to logout endpoint', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  await logout();

  assert.equal(calls[0], '/api/auth/logout');
});

test('forgot password posts expected payload and returns generic message', async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method || 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    return new Response(JSON.stringify({
      ok: true,
      message: 'If an account exists for that email, reset instructions have been sent.',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const result = await requestPasswordReset({ email: 'user@example.com' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/auth/forgot-password');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body, JSON.stringify({ email: 'user@example.com' }));
  assert.match(result.message, /if an account exists/i);
});

test('reset password throws on invalid token response', async () => {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ ok: false, error: 'Reset token is invalid or expired.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  await assert.rejects(
    resetPassword({
      token: 'bad_token',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    }),
    (error: unknown) => error instanceof Error && error.message.includes('invalid or expired'),
  );
});
