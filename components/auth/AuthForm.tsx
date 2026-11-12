"use client";

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { login, signup } from '@/services/auth';

const easeOut = [0.16, 0.7, 0.2, 1] as const;

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupComplete, setSignupComplete] = useState(false);

  const isSignup = mode === 'signup';
  const oauthError = searchParams.get('oauth_error');
  const signupSuccess = searchParams.get('signup');
  const nextPath = searchParams.get('next');
  // Referral code: prefer URL param, fall back to localStorage so the code
  // survives navigation between screens before signup completes.
  const urlRefCode = searchParams.get('ref');
  const [refCode, setRefCode] = useState<string | null>(urlRefCode);

  useEffect(() => {
    if (urlRefCode) {
      try { localStorage.setItem('calico.referral_code', urlRefCode); } catch {}
      setRefCode(urlRefCode);
    } else if (!refCode) {
      // No ref in URL — check localStorage for a previously captured code
      try {
        const stored = localStorage.getItem('calico.referral_code');
        if (stored) setRefCode(stored);
      } catch {}
    }
  }, [urlRefCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const googleOauthHref = useMemo(() => {
    const params = new URLSearchParams();
    if (nextPath) params.set('next', nextPath);
    if (refCode) params.set('ref', refCode);
    const qs = params.toString();
    return qs ? `/api/auth/google/login?${qs}` : '/api/auth/google/login';
  }, [nextPath, refCode]);
  const appleOauthHref = useMemo(() => {
    const params = new URLSearchParams();
    if (nextPath) params.set('next', nextPath);
    if (refCode) params.set('ref', refCode);
    const qs = params.toString();
    return qs ? `/api/auth/apple/login?${qs}` : '/api/auth/apple/login';
  }, [nextPath, refCode]);

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

    const formData = new FormData(event.currentTarget);
    const submittedEmail = String(formData.get('email') ?? email).trim();
    const submittedPassword = String(formData.get('password') ?? password);

    setEmail(submittedEmail);
    setPassword(submittedPassword);

    if (!submittedEmail || !submittedPassword) {
      setError('Email and password are required.');
      return;
    }

    if (isSignup && submittedPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);
    try {
      if (isSignup) {
        await signup({ email: submittedEmail, password: submittedPassword, ...(refCode ? { referralCode: refCode } : {}) });
        // Show success state briefly before transitioning to login
        setSignupComplete(true);
        setTimeout(() => {
          router.replace('/login?signup=success');
          router.refresh();
        }, 1200);
        return;
      }

      const result = await login({ email: submittedEmail, password: submittedPassword });
      router.replace(result.redirectTo);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed');
    } finally {
      if (!isSignup) setIsLoading(false);
    }
  };

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"
      style={{ background: "linear-gradient(160deg, #FFF7ED 0%, #FFFCF8 100%)" }}
    >
      {/* Ambient background glow */}
      <div
        className="calico-ambient-glow pointer-events-none absolute"
        style={{
          width: 480,
          height: 480,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(253,186,116,0.15) 0%, transparent 70%)",
          top: "10%",
          right: "-10%",
          filter: "blur(60px)",
        }}
      />
      <div
        className="calico-ambient-glow pointer-events-none absolute"
        style={{
          width: 360,
          height: 360,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(251,207,232,0.12) 0%, transparent 70%)",
          bottom: "5%",
          left: "-5%",
          filter: "blur(50px)",
        }}
      />

      <AnimatePresence mode="wait">
        {signupComplete ? (
          <motion.div
            key="signup-success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02, filter: "blur(4px)" }}
            transition={{ duration: 0.4, ease: easeOut }}
            className="relative z-10 w-full max-w-md text-center"
          >
            <div
              style={{
                borderRadius: 28,
                background: "rgba(255, 252, 248, 0.88)",
                backdropFilter: "blur(32px)",
                WebkitBackdropFilter: "blur(32px)",
                border: "1px solid rgba(242, 222, 204, 0.6)",
                boxShadow: "0 24px 80px rgba(17, 17, 17, 0.1), inset 0 1px 0 rgba(255,255,255,0.9)",
                padding: "48px 36px",
              }}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.15, duration: 0.4, ease: [0.16, 0.7, 0.2, 1] }}
                className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{ background: "rgba(22, 163, 74, 0.12)" }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--aw-success, #16A34A)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </motion.div>
              <motion.h2
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.35 }}
                style={{ fontSize: 22, fontWeight: 700, color: "#111", fontFamily: "'DM Sans', sans-serif" }}
              >
                Account created
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.35 }}
                style={{ marginTop: 10, fontSize: 15, color: "#3A332E", lineHeight: 1.6 }}
              >
                Taking you to sign in...
              </motion.p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={`auth-${mode}`}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.5, ease: easeOut }}
            className="relative z-10 w-full max-w-md"
          >
            {/* Agent Wallet logo */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="mb-6 flex items-center justify-center gap-2"
            >
              <img
                src="/calico-icon.png"
                alt="Agent Wallet"
                style={{ width: 32, height: 32, borderRadius: 8 }}
              />
              <span style={{ fontSize: 18, fontWeight: 700, color: "#111", fontFamily: "'DM Sans', sans-serif" }}>
                Agent Wallet
              </span>
            </motion.div>

            <div
              style={{
                borderRadius: 24,
                background: "rgba(255, 252, 248, 0.82)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
                border: "1px solid rgba(242, 222, 204, 0.6)",
                boxShadow: "0 16px 64px rgba(17, 17, 17, 0.08), inset 0 1px 0 rgba(255,255,255,0.85)",
                padding: "32px 28px",
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.35 }}
              >
                <p className="aw-kicker" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, color: "var(--aw-text-muted)" }}>
                  Account
                </p>
                <h1 style={{ marginTop: 4, fontSize: 24, fontWeight: 700, color: "#111", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.2 }}>
                  {isSignup ? 'Create account' : 'Log in'}
                </h1>
                <p style={{ marginTop: 8, fontSize: 15, color: "#3A332E", lineHeight: 1.6 }}>
                  {isSignup
                    ? 'Create your private Agent Wallet workspace.'
                    : 'Sign in to your private Agent Wallet workspace.'}
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25, duration: 0.35 }}
                className="mt-5"
              >
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
              </motion.div>

              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--aw-border)]" />
                <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">or</span>
                <div className="h-px flex-1 bg-[var(--aw-border)]" />
              </div>

              <motion.form
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.35 }}
                className="space-y-4"
                onSubmit={onSubmit}
              >
                <label className="space-y-1">
                  <span className="text-xs text-[var(--aw-text-muted)]">Email</span>
                  <input
                    className="aw-input h-10 text-sm"
                    name="email"
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
                    name="password"
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

                <AnimatePresence>
                  {!isSignup && signupSuccess === 'success' && !error && (
                    <motion.p
                      initial={{ opacity: 0, y: -4, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden rounded-lg border border-[var(--aw-success)]/25 bg-[var(--aw-success)]/10 px-3 py-2 text-xs text-[var(--aw-success)]"
                    >
                      Account created! Please sign in.
                    </motion.p>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, y: -4, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]"
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  className="aw-button-primary h-10 w-full text-sm"
                  disabled={isLoading}
                >
                  {isLoading ? (isSignup ? 'Creating account...' : 'Logging in...') : (isSignup ? 'Create account' : 'Log in')}
                </button>

                {isSignup ? (
                  <p className="mt-3 text-center text-[11px] leading-relaxed text-[var(--aw-text-muted)]">
                    By creating an account, you agree to our{' '}
                    <a
                      href="https://www.freeprivacypolicy.com/live/ab2b2a8a-1946-4178-ad49-1cde9a62f587"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-[var(--aw-text)]"
                    >
                      Privacy Policy
                    </a>.
                  </p>
                ) : null}
              </motion.form>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.3 }}
                className="mt-4 text-xs text-[var(--aw-text-muted)]"
              >
                {isSignup ? 'Already have an account?' : 'New to Agent Wallet?'}{' '}
                <Link
                  href={isSignup ? '/login' : '/signup'}
                  className="font-semibold text-[var(--aw-primary-strong)] hover:underline"
                >
                  {isSignup ? 'Log in' : 'Create account'}
                </Link>
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
