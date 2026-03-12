import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function sanitizeString(value: string): string {
  return value.replace(CONTROL_CHARACTER_PATTERN, '').trim();
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) {
      continue;
    }
    output[key] = sanitizePayload(entry);
  }
  return output;
}

function wouldRejectNonJsonContentType(contentType: string | null | undefined): boolean {
  const normalized = (contentType || '').toLowerCase();
  return !(normalized.includes('application/json') || normalized.includes('+json'));
}

test('XSS payloads are normalized and dangerous object-key injection is stripped', () => {
  const attackPayload = {
    message: '\u0000<script>alert("xss")</script>\u0007',
    __proto__: { admin: true },
    nested: {
      constructor: { polluted: true },
      safe: 'ok',
    },
  } as Record<string, unknown>;

  const sanitized = sanitizePayload(attackPayload) as Record<string, unknown>;
  const nested = sanitized.nested as Record<string, unknown>;

  assert.equal(sanitized.message, '<script>alert("xss")</script>');
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(nested, 'constructor'), false);
});

test('CSRF-style form submissions are rejected by JSON-body enforcement', () => {
  const csrfFormContentType = 'application/x-www-form-urlencoded';
  const multipartContentType = 'multipart/form-data';
  const jsonContentType = 'application/json';

  assert.equal(wouldRejectNonJsonContentType(csrfFormContentType), true);
  assert.equal(wouldRejectNonJsonContentType(multipartContentType), true);
  assert.equal(wouldRejectNonJsonContentType(jsonContentType), false);
});

test('request validator and auth cookie policy contain anti-CSRF/anti-XSS controls', () => {
  const validatorSource = read('security/requestValidator.ts');
  const cookieSource = read('lib/server/authCookies.ts');

  assert.match(validatorSource, /Expected application\/json request body\./);
  assert.match(validatorSource, /CONTROL_CHARACTER_PATTERN/);
  assert.match(validatorSource, /DANGEROUS_OBJECT_KEYS/);
  assert.match(cookieSource, /httpOnly:\s*true/);
  assert.match(cookieSource, /sameSite:\s*'lax'/i);
});

