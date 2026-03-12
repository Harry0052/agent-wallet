import 'server-only';

import {
  getRequiredSecret,
  validateRequiredSecretsAtStartup,
} from '@/security/secretsManager';

const REQUIRED_SERVER_ENV_KEYS = [
  'DATABASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

type RequiredServerEnvKey = (typeof REQUIRED_SERVER_ENV_KEYS)[number];

function readRequiredServerEnv(key: RequiredServerEnvKey): string {
  return getRequiredSecret(key);
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
  validateRequiredSecretsAtStartup();
  return {
    DATABASE_URL: getDatabaseUrl(),
    STRIPE_SECRET_KEY: getStripeSecretKey(),
    STRIPE_WEBHOOK_SECRET: getStripeWebhookSecret(),
  };
}
