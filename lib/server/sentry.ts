import 'server-only';

import * as Sentry from '@sentry/nextjs';

let initialized = false;

/**
 * Initialize Sentry for server-side error tracking.
 * Safe to call multiple times — only initializes once.
 * Does nothing if SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN is not set.
 */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.warn('[SENTRY] No SENTRY_DSN configured — error tracking disabled.');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,

    // Sample 100% of errors, 10% of transactions in production
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Filter out noisy non-actionable errors
    beforeSend(event, hint) {
      const error = hint?.originalException;
      const message = error instanceof Error ? error.message : String(error || '');

      // Don't report expected auth failures
      if (error instanceof Error && error.name === 'AuthError') return null;

      // Don't report rate limit responses
      if (message.includes('Too many requests')) return null;

      return event;
    },
  });
}

/**
 * Capture an exception in Sentry with optional context.
 * No-ops gracefully if Sentry is not initialized.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  try {
    if (context) {
      Sentry.withScope((scope) => {
        scope.setExtras(context);
        Sentry.captureException(error);
      });
    } else {
      Sentry.captureException(error);
    }
  } catch {
    // Sentry itself should never break the app
  }
}
