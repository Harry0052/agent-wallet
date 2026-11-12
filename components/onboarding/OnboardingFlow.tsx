"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type OnboardingStep = "welcome" | "profile" | "connect";

interface OnboardingPayload {
  ok: boolean;
  onboarding?: {
    step: string;
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
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [step, setStep] = useState<OnboardingStep>("welcome");

  const loadState = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding", { cache: "no-store" });
      const body = await readJson<OnboardingPayload>(response);
      if (!response.ok || !body.ok || !body.onboarding) {
        throw new Error(body.error || "Failed to load onboarding");
      }

      const serverStep = body.onboarding.step;
      if (serverStep === "profile" || serverStep === "wallet") {
        setStep("profile");
      } else if (serverStep === "tools" || serverStep === "complete") {
        setStep("connect");
      } else {
        setStep("welcome");
      }

      setEmail(body.user?.email || body.profile?.email || "");
      setFullName(body.profile?.fullName || "");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load onboarding",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadState();
  }, []);

  const patchOnboarding = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await readJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Failed to update onboarding");
    }
  };

  const onGetStarted = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const walletRes = await fetch("/api/wallet/init", { method: "POST" });
      const walletBody = await readJson<{ ok?: boolean; error?: string }>(walletRes);
      if (!walletRes.ok || !walletBody.ok) {
        throw new Error(walletBody.error || "Failed to initialize wallet");
      }

      await patchOnboarding({ step: "wallet" });
      setStep("profile");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const onSaveProfile = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const profileRes = await fetch("/api/wallet/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        }),
      });
      const profileBody = await readJson<{ error?: string }>(profileRes);
      if (!profileRes.ok) {
        throw new Error(profileBody.error || "Failed to save profile");
      }

      await patchOnboarding({ step: "profile" });
      setStep("connect");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save profile",
      );
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
          onboardingCompletedFrom: "onboarding_page",
        },
      });
      router.replace("/home");
      router.refresh();
    } catch (completeError) {
      setError(
        completeError instanceof Error
          ? completeError.message
          : "Failed to complete onboarding",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-[var(--aw-text-muted)]">Loading...</p>
      </div>
    );
  }

  const steps = ["welcome", "profile", "connect"] as const;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full transition-colors ${
                s === step
                  ? "bg-[var(--aw-primary)]"
                  : steps.indexOf(step) > i
                    ? "bg-[var(--aw-primary)]/40"
                    : "bg-[var(--aw-border)]"
              }`}
            />
            {i < 2 ? <div className="h-px w-6 bg-[var(--aw-border)]" /> : null}
          </div>
        ))}
      </div>

      {step === "welcome" ? (
        <div className="w-full text-center">
          <h1 className="text-2xl font-semibold text-[var(--aw-text)]">Welcome to Agent Wallet</h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--aw-text-muted)]">
            Your finances, simplified. Track spending, spot savings, and stay on top of every subscription, all in one place.
          </p>
          <button
            type="button"
            className="aw-button-primary mt-8 w-full px-6 py-3 text-sm font-medium"
            disabled={isSaving}
            onClick={() => {
              void onGetStarted();
            }}
          >
            {isSaving ? "Setting up..." : "Get started"}
          </button>
        </div>
      ) : null}

      {step === "profile" ? (
        <div className="w-full">
          <h1 className="text-center text-2xl font-semibold text-[var(--aw-text)]">
            Tell us about you
          </h1>
          <p className="mt-2 text-center text-sm text-[var(--aw-text-muted)]">
            We will use this to personalize your experience.
          </p>

          <div className="mt-8 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-[var(--aw-text)]">Full name</span>
              <input
                className="aw-input h-11 w-full text-sm"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-[var(--aw-text)]">Email</span>
              <input
                className="aw-input h-11 w-full text-sm"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
              />
            </label>
          </div>

          <button
            type="button"
            className="aw-button-primary mt-8 w-full px-6 py-3 text-sm font-medium"
            disabled={isSaving}
            onClick={() => {
              void onSaveProfile();
            }}
          >
            {isSaving ? "Saving..." : "Save profile"}
          </button>
        </div>
      ) : null}

      {step === "connect" ? (
        <div className="w-full text-center">
          <h1 className="text-2xl font-semibold text-[var(--aw-text)]">
            Connect your first account
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--aw-text-muted)]">
            Link a bank or credit card to unlock your financial picture.
          </p>

          <div className="mt-8 space-y-3">
            <Link
              href="/connect"
              className="aw-button-primary block w-full px-6 py-3 text-center text-sm font-medium"
            >
              Connect account
            </Link>
            <button
              type="button"
              className="aw-button-secondary w-full px-6 py-3 text-sm font-medium"
              disabled={isSaving}
              onClick={() => {
                void onComplete(true);
              }}
            >
              {isSaving ? "Finishing..." : "Skip for now"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-6 w-full rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-4 py-2.5 text-center text-xs text-[var(--aw-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
