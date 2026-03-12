import 'server-only';

import { getKnownSecretValues } from '@/security/secretsManager';

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret[_-]?key|client[_-]?secret|password|authorization|database[_-]?url)/i;
const KEY_VALUE_PATTERN = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret[_-]?key|client[_-]?secret|password|authorization|database[_-]?url)\b\s*([:=])\s*("([^"]*)"|'([^']*)'|[^\s,;]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/=]+\b/gi;

declare global {
  var __agentWalletSecretRedactionInstalled: boolean | undefined;
}

function redactWithKnownSecretValues(input: string): string {
  let output = input;
  for (const secret of getKnownSecretValues()) {
    if (!secret || secret.length < 4) continue;
    if (!output.includes(secret)) continue;
    output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

export function redactSecretsInString(input: string): string {
  if (!input) return input;

  const withoutBearer = input.replace(BEARER_PATTERN, 'Bearer [REDACTED]');
  const withoutKeyValues = withoutBearer.replace(
    KEY_VALUE_PATTERN,
    (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`,
  );

  return redactWithKnownSecretValues(withoutKeyValues);
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSecretsInString(value);
  }

  if (value instanceof Error) {
    const clone = new Error(redactSecretsInString(value.message));
    clone.name = value.name;
    if (value.stack) {
      clone.stack = redactSecretsInString(value.stack);
    }
    return clone;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = redactSecrets(item);
  }

  return output;
}

function sanitizeConsoleArg(arg: unknown): unknown {
  if (typeof arg === 'string') {
    return redactSecretsInString(arg);
  }

  if (arg instanceof Error) {
    return redactSecrets(arg);
  }

  if (arg && typeof arg === 'object') {
    return redactSecrets(arg);
  }

  return arg;
}

export function installSecretRedaction(): void {
  if (globalThis.__agentWalletSecretRedactionInstalled) {
    return;
  }

  const methods: Array<'log' | 'info' | 'warn' | 'error' | 'debug'> = [
    'log',
    'info',
    'warn',
    'error',
    'debug',
  ];

  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = ((...args: unknown[]) => {
      const sanitized = args.map((arg) => sanitizeConsoleArg(arg));
      original(...sanitized);
    }) as typeof console[typeof method];
  }

  globalThis.__agentWalletSecretRedactionInstalled = true;
}
