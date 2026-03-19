import { safeJson } from '@/services/safeFetch';

export type PlanId = 'starter' | 'pro' | 'autonomous';

export interface LockedFeature {
  key: string;
  label: string;
  description: string;
  minimumPlan: PlanId;
}

export interface TutorialStep {
  title: string;
  body: string;
  icon: string;
}

export interface EntitlementsResponse {
  plan: PlanId | null;
  isActive: boolean;
  available: string[];
  locked: LockedFeature[];
  tutorial: { heading: string; steps: TutorialStep[] } | null;
}

export async function fetchEntitlements(): Promise<EntitlementsResponse> {
  const res = await fetch('/api/entitlements', { cache: 'no-store' });
  const body = await safeJson<{ ok?: boolean; plan?: PlanId | null; isActive?: boolean; available?: string[]; locked?: LockedFeature[]; tutorial?: EntitlementsResponse['tutorial']; error?: string }>(res);
  if (!res.ok || !body.ok) {
    throw new Error(body.error || 'Failed to fetch entitlements');
  }
  return {
    plan: body.plan ?? null,
    isActive: body.isActive ?? false,
    available: body.available ?? [],
    locked: body.locked ?? [],
    tutorial: body.tutorial ?? null,
  };
}

export function hasFeature(available: string[], feature: string): boolean {
  return available.includes(feature);
}

export async function deleteAccount(input: {
  confirmText: string;
}): Promise<void> {
  const res = await fetch('/api/auth/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmText: input.confirmText,
    }),
  });
  const body = await safeJson<{ ok?: boolean; error?: string }>(res);
  if (!res.ok || !body.ok) {
    throw new Error(body.error || 'Account deletion failed');
  }
}
