export const PROTECTED_PAGE_PREFIXES = [
  '/onboarding',
  '/operator',
  '/execution',
  '/tools',
  '/wallet',
  '/subscriptions',
  '/settings',
  '/refunds',
  '/dashboard/reconciliation',
] as const;

export function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isProtectedApi(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;

  if (pathname.startsWith('/api/auth/')) return false;
  if (pathname === '/api/stripe/webhook' || pathname === '/api/stripe/webhooks') return false;
  if (pathname === '/api/webhooks/stripe') return false;
  if (pathname === '/api/connect/transactions/webhook') return false;
  return true;
}
