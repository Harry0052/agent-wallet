import type { UserAutofillProfile } from '@/lib/types';

function toError(body: { error?: string }): Error {
  return new Error(body.error || 'Request failed');
}

export async function fetchProfile(): Promise<UserAutofillProfile | null> {
  const response = await fetch('/api/wallet/profile', {
    method: 'GET',
    cache: 'no-store',
  });

  const body = (await response.json()) as {
    profile?: UserAutofillProfile | null;
    error?: string;
  };

  if (!response.ok) {
    throw toError(body);
  }

  return body.profile || null;
}

export async function updateProfile(
  patch: Partial<Omit<UserAutofillProfile, 'userId' | 'createdAt' | 'updatedAt'>>,
): Promise<UserAutofillProfile> {
  const response = await fetch('/api/wallet/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  const body = (await response.json()) as {
    profile?: UserAutofillProfile;
    error?: string;
  };

  if (!response.ok || !body.profile) {
    throw toError(body);
  }

  return body.profile;
}
