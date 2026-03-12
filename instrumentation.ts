import 'server-only';

import { startDataRetentionScheduler } from '@/security/dataRetention';
import { installSecretRedaction } from '@/security/redactSecrets';
import { validateRequiredSecretsAtStartup } from '@/security/secretsManager';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  installSecretRedaction();
  validateRequiredSecretsAtStartup();
  startDataRetentionScheduler();
}
