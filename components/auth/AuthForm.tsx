"use client";

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { login, signup } from '@/services/auth';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === 'signup';
  const oauthError = searchParams.get('oauth_error');
  const nextPath = searchParams.get('next');

  const googleOauthHref = useMemo(() => {
    if (!nextPath) return '/api/auth/google/login';
    return `/api/auth/google/login?next=${encodeURIComponent(nextPath)}`;
  }, [nextPath]);
  const appleOauthHref = useMemo(() => {
    if (!nextPath) return '/api/auth/apple/login';
    return `/api/auth/apple/login?next=${encodeURIComponent(nextPath)}`;
  }, [nextPath]);

  useEffect(() => {
    if (!oauthError) return;

    if (oauthError === 'google_denied') {
      setError('Google login was canceled. Please try again.');
      return;
    }

    if (oauthError === 'google_state_invalid') {
      setError('Google login session expired. Please try again.');
      return;
    }

    if (oauthError === 'google_auth_failed') {
      setError('Google authentication failed. Please try again.');
      return;
    }

    if (oauthError === 'google_auth_unavailable') {
      setError('Google login is not configured right now.');
      return;
    }

    if (oauthError === 'apple_denied') {
      setError('Apple login was canceled. Please try again.');
      return;
    }

    if (oauthError === 'apple_state_invalid') {
      setError('Apple login session expired. Please try again.');
      return;
    }

    if (oauthError === 'apple_auth_failed') {
      setError('Apple authentication failed. Please try again.');
      return;
    }

    if (oauthError === 'apple_auth_unavailable') {
      setError('Apple login is not configured right now.');
      return;
    }

    setError('OAuth authentication failed.');
  }, [oauthError]);

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
      let redirectTo = '/home';
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
            ? 'Create your private Calico workspace.'
            : 'Sign in to your private Calico workspace.'}
        </p>

        <div className="mt-5">
          <a
            href={googleOauthHref}
            className="aw-button-secondary flex h-10 w-full items-center justify-center text-sm"
          >
            Continue with Google
          </a>
          <a
            href={appleOauthHref}
            className="aw-button-secondary mt-2 flex h-10 w-full items-center justify-center text-sm"
          >
            Continue with Apple
          </a>
        </div>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--aw-border)]" />
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">or</span>
          <div className="h-px flex-1 bg-[var(--aw-border)]" />
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
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
          {isSignup ? 'Already have an account?' : 'New to Calico?'}{' '}
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
