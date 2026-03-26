import 'server-only';

import { startDataRetentionScheduler } from '@/security/dataRetention';
import { installSecretRedaction } from '@/security/redactSecrets';
import { validateRequiredSecretsAtStartup } from '@/security/secretsManager';
import { initSentry } from '@/lib/server/sentry';

export async function registerNodeInstrumentation(): Promise<void> {
  // Secret redaction must always install — even if later steps fail
  installSecretRedaction();

  // Initialize Sentry early so it captures errors from all subsequent steps
  try {
    initSentry();
  } catch (error) {
    console.error(
      '[INSTRUMENTATION] Sentry init failed:',
      error instanceof Error ? error.message : error,
    );
  }

  // Validate secrets but never crash the server. Missing secrets are
  // logged as CRITICAL errors. Individual routes that need them will
  // fail with specific error messages at the point of use.
  try {
    validateRequiredSecretsAtStartup();
  } catch (error) {
    console.error(
      '[INSTRUMENTATION] Secret validation threw unexpectedly:',
      error instanceof Error ? error.message : error,
    );
  }

  // Data retention scheduler — non-critical
  try {
    startDataRetentionScheduler();
  } catch (error) {
    console.error(
      '[INSTRUMENTATION] Data retention scheduler failed to start:',
      error instanceof Error ? error.message : error,
    );
  }
}
