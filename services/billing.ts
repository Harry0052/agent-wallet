export type PlanId = 'starter' | 'pro' | 'autonomous';

export interface BillingStatus {
  plan: PlanId | null;
  planName: string | null;
  priceMonthly: number | null;
  status: string;
  isActive: boolean;
  isTrial: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
}

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const response = await fetch('/api/billing/status', {
    method: 'GET',
    cache: 'no-store',
  });

  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(body.error || 'Failed to fetch billing status');
  }

  return body.billing;
}

export async function startCheckout(plan: PlanId): Promise<void> {
  const response = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });

  const body = await response.json();

  if (!response.ok || !body.ok) {
    if (response.status === 401) {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    throw new Error(body.error || 'Checkout failed');
  }

  if (!body.url || typeof body.url !== 'string') {
    throw new Error('No checkout URL returned. Please try again.');
  }

  window.location.href = body.url;
}

export async function openBillingPortal(): Promise<void> {
  const response = await fetch('/api/billing/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const body = await response.json();

  if (!response.ok || !body.ok) {
    if (response.status === 401) {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    throw new Error(body.error || 'Could not open billing portal');
  }

  window.location.href = body.url;
}
