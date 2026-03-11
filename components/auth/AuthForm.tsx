"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { login, signup } from '@/services/auth';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === 'signup';

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    if (isSignup && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);
    try {
      let redirectTo = '/operator';
      if (isSignup) {
        const result = await signup({ email, password });
        redirectTo = result.redirectTo;
      } else {
        const result = await login({ email, password });
        redirectTo = result.redirectTo;
      }

      router.replace(redirectTo);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="aw-page mx-auto max-w-md py-10">
      <div className="aw-surface p-6 md:p-7">
        <p className="aw-kicker">Account</p>
        <h1 className="aw-page-title mt-1">{isSignup ? 'Create account' : 'Log in'}</h1>
        <p className="aw-page-subtitle mt-2">
          {isSignup
            ? 'Create your private Agent Wallet workspace.'
            : 'Sign in to your private Agent Wallet workspace.'}
        </p>

        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Email</span>
            <input
              className="aw-input h-10 text-sm"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Password</span>
            <input
              className="aw-input h-10 text-sm"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {!isSignup && (
            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-xs font-semibold text-[var(--aw-primary-strong)] hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="aw-button-primary h-10 w-full text-sm"
            disabled={isLoading}
          >
            {isLoading ? (isSignup ? 'Creating account...' : 'Logging in...') : (isSignup ? 'Create account' : 'Log in')}
          </button>
        </form>

        <p className="mt-4 text-xs text-[var(--aw-text-muted)]">
          {isSignup ? 'Already have an account?' : 'New to Agent Wallet?'}{' '}
          <Link
            href={isSignup ? '/login' : '/signup'}
            className="font-semibold text-[var(--aw-primary-strong)] hover:underline"
          >
            {isSignup ? 'Log in' : 'Create account'}
          </Link>
        </p>
      </div>
    </div>
  );
}
