"use client";

import Link from 'next/link';
import { useState } from 'react';
import { requestPasswordReset } from '@/services/auth';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [debugResetUrl, setDebugResetUrl] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setDebugResetUrl(null);

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await requestPasswordReset({ email: email.trim() });
      setMessage(result.message);
      setDebugResetUrl(result.resetUrl || null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to request password reset.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="aw-page mx-auto max-w-md py-10">
      <div className="aw-surface p-6 md:p-7">
        <p className="aw-kicker">Account</p>
        <h1 className="aw-page-title mt-1">Forgot password</h1>
        <p className="aw-page-subtitle mt-2">
          Enter your email and we&apos;ll send reset instructions if an account exists.
        </p>

        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Email</span>
            <input
              className="aw-input h-10 text-sm"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          {error && (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {error}
            </p>
          )}

          {message && (
            <p className="rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]">
              {message}
            </p>
          )}

          {debugResetUrl && (
            <p className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2 text-xs text-[var(--aw-text-soft)]">
              Dev reset URL: <a href={debugResetUrl} className="underline">{debugResetUrl}</a>
            </p>
          )}

          <button
            type="submit"
            className="aw-button-primary h-10 w-full text-sm"
            disabled={isLoading}
          >
            {isLoading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>

        <p className="mt-4 text-xs text-[var(--aw-text-muted)]">
          Remembered your password?{' '}
          <Link href="/login" className="font-semibold text-[var(--aw-primary-strong)] hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
