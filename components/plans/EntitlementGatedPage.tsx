"use client";

import Link from "next/link";
import { Lock, ArrowRight, AlertCircle } from "lucide-react";
import { useEntitlements } from "@/lib/useEntitlements";
import type { PlanId } from "@/services/billing";

interface EntitlementGatedPageProps {
  children: React.ReactNode;
  requiredFeature: string;
  featureLabel: string;
  featureDescription: string;
  requiredPlan: PlanId;
}

const PLAN_NAMES: Record<PlanId, string> = {
  starter: "Starter",
  pro: "Pro",
  autonomous: "Fully Autonomous",
};

export function EntitlementGatedPage({
  children,
  requiredFeature,
  featureLabel,
  featureDescription,
  requiredPlan,
}: EntitlementGatedPageProps) {
  const { loading, error, stale, can, refresh } = useEntitlements();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--calico-primary,#FDBA74)] border-t-transparent" />
      </div>
    );
  }

  // User has access (from fresh fetch or cached data) — show content
  if (can(requiredFeature)) {
    return (
      <>
        {/* If data is stale (from cache after a fetch failure), show a subtle non-blocking banner */}
        {stale && error && (
          <div className="mx-auto max-w-4xl px-4 pt-4">
            <div className="flex items-center gap-2 rounded-xl bg-[var(--aw-warning)]/10 px-4 py-2.5 text-xs text-[var(--aw-text-muted)]">
              <AlertCircle size={14} className="shrink-0 text-[var(--aw-warning)]" />
              <span>Plan verification is temporarily unavailable. Using your last known plan.</span>
              <button
                type="button"
                onClick={() => { void refresh(); }}
                className="ml-auto shrink-0 font-semibold text-[var(--aw-primary)] hover:underline"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {children}
      </>
    );
  }

  // No access AND error — verification failed and no cached data supports access.
  // Distinguish between "we couldn't check" vs "user genuinely doesn't have access."
  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--aw-warning)]/15">
            <AlertCircle size={22} className="text-[var(--aw-warning)]" />
          </div>
          <p className="text-base font-semibold text-[var(--aw-text)]">
            Couldn't verify your plan
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--aw-text-muted)]">
            We're having trouble reaching our billing system. This is usually temporary — try again in a moment.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => { void refresh(); }}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--calico-primary,#FDBA74)] px-6 py-2.5 text-sm font-semibold text-[var(--aw-text)] shadow-md hover:opacity-90 transition"
            >
              Try again
            </button>
            <Link
              href="/home"
              className="text-sm font-medium text-[var(--aw-text-muted)] hover:text-[var(--aw-text)] transition"
            >
              Go home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // No error, no access — user genuinely doesn't have this feature on their plan
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50">
          <Lock size={28} className="text-[var(--calico-primary,#FDBA74)]" />
        </div>
        <h2 className="text-2xl font-semibold text-[var(--aw-text)]">
          {featureLabel}
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--aw-text-muted)]">
          {featureDescription}
        </p>
        <p className="mt-2 text-xs text-[var(--aw-text-muted)]">
          Part of the {PLAN_NAMES[requiredPlan]} plan.
        </p>
        <Link
          href="/settings?section=billing"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--calico-primary,#FDBA74)] px-6 py-3 text-sm font-semibold text-[var(--aw-text)] shadow-md hover:opacity-90 transition"
        >
          View Plans & Billing
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
