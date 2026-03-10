import type { SavedPaymentMethod } from '@/lib/types';

export interface FundingSession {
  checkoutUrl: string;
  sessionId: string;
}

export interface SavedPaymentMethodsResponse {
  ok: true;
  methods: SavedPaymentMethod[];
}

export interface SavedTopupResponse {
  ok: true;
  status: 'succeeded' | 'requires_action' | 'pending_checkout';
  amount: number;
  message: string;
  paymentIntentId?: string;
  checkoutUrl?: string;
  sessionId?: string;
  paymentMethod?: SavedPaymentMethod;
  paymentMethodLabel?: string;
  detachedAfterUse?: boolean;
}

export interface SetupIntentResponse {
  ok: true;
  clientSecret: string;
  setupIntentId: string;
  publishableKey: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const parsed = body as { error?: string; errorCode?: string };
    if (parsed.errorCode && parsed.error) {
      throw new Error(`${parsed.errorCode}: ${parsed.error}`);
    }
    throw new Error(parsed.error || 'Request failed');
  }
  return body as T;
}

export async function createFundingSession(amount: number): Promise<FundingSession> {
  const res = await fetch('/api/funding/create-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });

  return jsonOrThrow<FundingSession>(res);
}

export async function createFundingSetupSession(input?: {
  consentSource?: string;
  consentVersion?: string;
}): Promise<FundingSession> {
  const res = await fetch('/api/funding/setup-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consentSource: input?.consentSource || 'wallet_page',
      consentVersion: input?.consentVersion || 'v1',
    }),
  });

  const body = await jsonOrThrow<{ checkoutUrl: string; sessionId: string }>(res);
  return {
    checkoutUrl: body.checkoutUrl,
    sessionId: body.sessionId,
  };
}

export async function createFundingSetupIntent(input?: {
  consentSource?: string;
  consentVersion?: string;
}): Promise<SetupIntentResponse> {
  const res = await fetch('/api/funding/setup-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consentSource: input?.consentSource || 'wallet_page',
      consentVersion: input?.consentVersion || 'v1',
    }),
  });

  return jsonOrThrow<SetupIntentResponse>(res);
}

export async function confirmFundingSetupIntent(setupIntentId: string): Promise<SavedPaymentMethod> {
  const res = await fetch('/api/funding/setup-intent/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupIntentId }),
  });

  const body = await jsonOrThrow<{ ok: true; method: SavedPaymentMethod }>(res);
  return body.method;
}

export async function listSavedPaymentMethods(): Promise<SavedPaymentMethod[]> {
  const res = await fetch('/api/funding/payment-methods', { cache: 'no-store' });
  const body = await jsonOrThrow<SavedPaymentMethodsResponse>(res);
  return body.methods;
}

export async function removeSavedPaymentMethod(paymentMethodId: string): Promise<void> {
  const res = await fetch('/api/funding/payment-methods', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentMethodId }),
  });

  await jsonOrThrow<{ ok: true }>(res);
}

export async function topupWithSavedPaymentMethod(input: {
  amount: number;
  paymentMethodId?: string;
  approved: boolean;
  forgetAfterUse?: boolean;
}): Promise<SavedTopupResponse> {
  const res = await fetch('/api/funding/topup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  return jsonOrThrow<SavedTopupResponse>(res);
}
