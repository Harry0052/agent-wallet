"use client";

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { resetPassword } from '@/services/auth';

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromQuery = useMemo(() => searchParams.get('token') || '', [searchParams]);

  const [token, setToken] = useState(tokenFromQuery);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!token.trim()) {
      setError('Reset token is required.');
      return;
    }
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await resetPassword({
        token: token.trim(),
        password,
        confirmPassword,
      });
      setMessage(result.message);
      setTimeout(() => {
        router.replace('/login');
        router.refresh();
      }, 700);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="aw-page mx-auto max-w-md py-10">
      <div className="aw-surface p-6 md:p-7">
        <p className="aw-kicker">Account</p>
        <h1 className="aw-page-title mt-1">Reset password</h1>
        <p className="aw-page-subtitle mt-2">
          Enter your reset token and choose a new password.
        </p>

        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Reset token</span>
            <input
              className="aw-input h-10 text-sm"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">New password</span>
            <input
              className="aw-input h-10 text-sm"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Confirm password</span>
            <input
              className="aw-input h-10 text-sm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
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

          <button
            type="submit"
            className="aw-button-primary h-10 w-full text-sm"
            disabled={isLoading}
          >
            {isLoading ? 'Updating...' : 'Update password'}
          </button>
        </form>

        <p className="mt-4 text-xs text-[var(--aw-text-muted)]">
          Return to{' '}
          <Link href="/login" className="font-semibold text-[var(--aw-primary-strong)] hover:underline">
            login
          </Link>
        </p>
      </div>
    </div>
  );
}
