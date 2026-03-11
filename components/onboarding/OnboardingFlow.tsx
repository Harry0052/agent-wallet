"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type OnboardingStep = 'welcome' | 'wallet' | 'profile' | 'tools' | 'complete';

interface OnboardingPayload {
  ok: boolean;
  onboarding?: {
    step: OnboardingStep;
    completedAt: string | null;
    skippedToolSetup: boolean;
    preferences?: Record<string, unknown>;
  };
  user?: {
    email: string;
  };
  setup?: {
    walletInitialized: boolean;
    profileReady: boolean;
  };
  profile?: {
    fullName?: string;
    companyName?: string;
    email?: string;
  } | null;
  error?: string;
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

export function OnboardingFlow() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [walletReady, setWalletReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [step, setStep] = useState<OnboardingStep>('welcome');

  const canFinish = walletReady && profileReady;
  const title = useMemo(() => {
    if (step === 'wallet') return 'Initialize your wallet';
    if (step === 'profile') return 'Set your profile';
    if (step === 'tools') return 'Connect tools';
    return 'Welcome to Agent Wallet';
  }, [step]);

  const loadState = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/onboarding', { cache: 'no-store' });
      const body = await readJson<OnboardingPayload>(response);
      if (!response.ok || !body.ok || !body.onboarding) {
        throw new Error(body.error || 'Failed to load onboarding');
      }

      setStep(body.onboarding.step);
      setEmail(body.user?.email || '');
      setWalletReady(Boolean(body.setup?.walletInitialized));
      setProfileReady(Boolean(body.setup?.profileReady));
      setFullName(body.profile?.fullName || '');
      setCompanyName(body.profile?.companyName || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load onboarding');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadState();
  }, []);

  const patchOnboarding = async (payload: Record<string, unknown>) => {
    const response = await fetch('/api/onboarding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await readJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok || !body.ok) {
      throw new Error(body.error || 'Failed to update onboarding');
    }
  };

  const onInitWallet = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const walletRes = await fetch('/api/wallet/init', { method: 'POST' });
      const walletBody = await readJson<{ ok?: boolean; error?: string }>(walletRes);
      if (!walletRes.ok || !walletBody.ok) {
        throw new Error(walletBody.error || 'Failed to initialize wallet');
      }

      await patchOnboarding({ step: 'wallet' });
      setWalletReady(true);
      setStep('profile');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to initialize wallet');
    } finally {
      setIsSaving(false);
    }
  };

  const onSaveProfile = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const profileRes = await fetch('/api/wallet/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
          ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        }),
      });
      const profileBody = await readJson<{ error?: string }>(profileRes);
      if (!profileRes.ok) {
        throw new Error(profileBody.error || 'Failed to save profile');
      }

      await patchOnboarding({ step: 'profile' });
      setProfileReady(true);
      setStep('tools');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  const onComplete = async (skippedToolSetup: boolean) => {
    setIsSaving(true);
    setError(null);
    try {
      await patchOnboarding({
        complete: true,
        skippedToolSetup,
        preferencesPatch: {
          onboardingCompletedFrom: 'onboarding_page',
        },
      });
      router.replace('/operator');
      router.refresh();
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : 'Failed to complete onboarding');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="aw-page mx-auto max-w-3xl">
        <div className="aw-surface p-6">
          <p className="aw-page-subtitle">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="aw-page mx-auto max-w-3xl">
      <div className="aw-page-header">
        <p className="aw-page-kicker">Onboarding</p>
        <h1 className="aw-page-title">{title}</h1>
        <p className="aw-page-subtitle">
          Set up your private Agent Wallet environment. You can skip tool setup and continue later.
        </p>
      </div>

      <div className="aw-surface space-y-5 p-5 md:p-6">
        <div className="grid gap-3 md:grid-cols-3">
          <div className={`rounded-xl border p-3 text-xs ${walletReady ? 'border-[var(--aw-success)] bg-[var(--aw-success)]/10' : 'border-[var(--aw-border)]'}`}>
            <p className="font-semibold">Wallet</p>
            <p className="mt-1 text-[var(--aw-text-muted)]">{walletReady ? 'Initialized' : 'Pending'}</p>
          </div>
          <div className={`rounded-xl border p-3 text-xs ${profileReady ? 'border-[var(--aw-success)] bg-[var(--aw-success)]/10' : 'border-[var(--aw-border)]'}`}>
            <p className="font-semibold">Profile</p>
            <p className="mt-1 text-[var(--aw-text-muted)]">{profileReady ? 'Saved' : 'Pending'}</p>
          </div>
          <div className={`rounded-xl border p-3 text-xs ${step === 'complete' ? 'border-[var(--aw-success)] bg-[var(--aw-success)]/10' : 'border-[var(--aw-border)]'}`}>
            <p className="font-semibold">Tools</p>
            <p className="mt-1 text-[var(--aw-text-muted)]">Optional</p>
          </div>
        </div>

        {!walletReady && (
          <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
            <p className="text-sm text-[var(--aw-text-soft)]">
              Initialize your private wallet ledger and defaults.
            </p>
            <button
              type="button"
              className="aw-button-primary mt-3 px-4 py-2 text-sm"
              disabled={isSaving}
              onClick={() => { void onInitWallet(); }}
            >
              {isSaving ? 'Initializing...' : 'Initialize wallet'}
            </button>
          </div>
        )}

        {walletReady && (
          <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
            <p className="text-sm text-[var(--aw-text-soft)]">
              Save basic profile defaults used for autonomous form-fill tasks.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-[var(--aw-text-muted)]">Full name</span>
                <input
                  className="aw-input h-10 text-sm"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Jane Doe"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-[var(--aw-text-muted)]">Work email</span>
                <input
                  className="aw-input h-10 text-sm"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs text-[var(--aw-text-muted)]">Company (optional)</span>
                <input
                  className="aw-input h-10 text-sm"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="Acme Inc."
                />
              </label>
            </div>
            <button
              type="button"
              className="aw-button-secondary mt-3 px-4 py-2 text-sm"
              disabled={isSaving}
              onClick={() => { void onSaveProfile(); }}
            >
              {isSaving ? 'Saving...' : profileReady ? 'Update profile' : 'Save profile'}
            </button>
          </div>
        )}

        {walletReady && profileReady && (
          <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
            <p className="text-sm text-[var(--aw-text-soft)]">
              Connect tools now, or skip and configure integrations later in Settings.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/tools" className="aw-button-secondary px-4 py-2 text-sm">
                Connect tools now
              </Link>
              <button
                type="button"
                className="aw-button-primary px-4 py-2 text-sm"
                disabled={isSaving || !canFinish}
                onClick={() => { void onComplete(true); }}
              >
                {isSaving ? 'Finishing...' : 'Skip for now'}
              </button>
              <button
                type="button"
                className="aw-button-primary px-4 py-2 text-sm"
                disabled={isSaving || !canFinish}
                onClick={() => { void onComplete(false); }}
              >
                {isSaving ? 'Finishing...' : 'Continue to dashboard'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
