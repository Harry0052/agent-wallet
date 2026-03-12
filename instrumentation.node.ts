import 'server-only';

import { startDataRetentionScheduler } from '@/security/dataRetention';
import { installSecretRedaction } from '@/security/redactSecrets';
import { validateRequiredSecretsAtStartup } from '@/security/secretsManager';

export async function registerNodeInstrumentation(): Promise<void> {
  installSecretRedaction();
  validateRequiredSecretsAtStartup();
  startDataRetentionScheduler();
}
