import 'server-only';

const REQUIRED_SERVER_ENV_KEYS = [
  'DATABASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

type RequiredServerEnvKey = (typeof REQUIRED_SERVER_ENV_KEYS)[number];

function readRequiredServerEnv(key: RequiredServerEnvKey): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing required server env var: ${key}`);
  }
  return value;
}

export function getDatabaseUrl(): string {
  return readRequiredServerEnv('DATABASE_URL');
}

export function getStripeSecretKey(): string {
  return readRequiredServerEnv('STRIPE_SECRET_KEY');
}

export function getStripeWebhookSecret(): string {
  return readRequiredServerEnv('STRIPE_WEBHOOK_SECRET');
}

export function validateCriticalServerEnv(): Record<RequiredServerEnvKey, string> {
  return {
    DATABASE_URL: getDatabaseUrl(),
    STRIPE_SECRET_KEY: getStripeSecretKey(),
    STRIPE_WEBHOOK_SECRET: getStripeWebhookSecret(),
  };
}

