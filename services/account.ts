export interface AuthenticatedAccount {
  appUserId: string;
  walletUserId: string;
  email: string;
  expiresAt: string;
}

function toError(body: { error?: string }): Error {
  return new Error(body.error || 'Account request failed');
}

export async function fetchAuthenticatedAccount(): Promise<AuthenticatedAccount> {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    cache: 'no-store',
  });

  const body = (await response.json()) as {
    ok?: boolean;
    authenticated?: boolean;
    user?: AuthenticatedAccount;
    error?: string;
  };

  if (!response.ok || !body.ok || !body.authenticated || !body.user) {
    throw toError(body);
  }

  return body.user;
}

export async function deleteAuthenticatedAccount(input: {
  password: string;
  confirmText: string;
}): Promise<{ message: string }> {
  const response = await fetch('/api/auth/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    message?: string;
    error?: string;
  };

  if (!response.ok || !body.ok) {
    throw toError(body);
  }

  return {
    message: body.message || 'Account deleted successfully.',
  };
}
