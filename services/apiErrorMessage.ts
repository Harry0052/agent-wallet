/**
 * Translates internal API error codes into user-friendly messages.
 * Used by client-side service modules to prevent raw DB/infra errors
 * from leaking into the UI.
 */

const DB_ERROR_CODES = new Set([
  'DB_FAILURE',
  'DB_POOL_EXHAUSTED',
  'DB_UNREACHABLE',
  'AUTH_INTERNAL_ERROR',
]);

const DB_ERROR_PATTERNS = [
  /maxclientsinsessionmode/i,
  /max clients reached/i,
  /too many clients/i,
  /pool.*timeout/i,
  /ECONNREFUSED/i,
  /connection.*terminated/i,
];

export function toUserFriendlyError(payload: {
  error?: string;
  errorCode?: string;
}): Error {
  const code = payload.errorCode || '';
  const msg = payload.error || '';

  // Known DB/infra error codes
  if (DB_ERROR_CODES.has(code)) {
    return new Error('Agent Wallet is temporarily busy. Please try again in a moment.');
  }

  // Fallback: check the message itself for DB pool indicators
  if (DB_ERROR_PATTERNS.some((p) => p.test(msg) || p.test(code))) {
    return new Error('Agent Wallet is temporarily busy. Please try again in a moment.');
  }

  // Pass through other errors as-is
  if (code && msg) return new Error(`${code}: ${msg}`);
  return new Error(msg || 'Something went wrong. Please try again.');
}
