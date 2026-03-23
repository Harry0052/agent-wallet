function formatError(body: { error?: string }): string {
  return body.error || 'Authentication request failed';
}

interface AuthSuccessBody {
  ok?: boolean;
  error?: string;
  redirectTo?: string;
}

export async function signup(input: {
  email: string;
  password: string;
  referralCode?: string;
}): Promise<{ signupComplete: true }> {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as AuthSuccessBody & { signupComplete?: boolean };

  if (!response.ok || !body.ok) {
    throw new Error(formatError(body));
  }

  return { signupComplete: true };
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<{ redirectTo: string }> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as AuthSuccessBody;

  if (!response.ok || !body.ok) {
    throw new Error(formatError(body));
  }

  return {
    redirectTo: typeof body.redirectTo === 'string' && body.redirectTo
      ? body.redirectTo
      : '/home',
  };
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function requestPasswordReset(input: {
  email: string;
}): Promise<{ message: string; resetToken?: string; resetUrl?: string }> {
  const response = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    error?: string;
    message?: string;
    resetToken?: string;
    resetUrl?: string;
  };

  if (!response.ok || (body.ok === false && response.status >= 400)) {
    throw new Error(formatError(body));
  }

  return {
    message: body.message || 'If an account exists for that email, reset instructions have been sent.',
    ...(typeof body.resetToken === 'string' ? { resetToken: body.resetToken } : {}),
    ...(typeof body.resetUrl === 'string' ? { resetUrl: body.resetUrl } : {}),
  };
}

export async function resetPassword(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<{ message: string }> {
  const response = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    error?: string;
    message?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatError(body));
  }

  return {
    message: body.message || 'Password updated successfully.',
  };
}
