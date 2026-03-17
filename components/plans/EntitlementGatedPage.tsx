"use client";

import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";
import { useEntitlements } from "@/lib/useEntitlements";
import type { PlanId } from "@/services/billing";

interface EntitlementGatedPageProps {
  children: React.ReactNode;
  /** Feature key required to access this page */
  requiredFeature: string;
  /** Human-readable name for the feature */
  featureLabel: string;
  /** Description shown when locked */
  featureDescription: string;
  /** Minimum plan needed */
  requiredPlan: PlanId;
}

const PLAN_NAMES: Record<PlanId, string> = {
  starter: "Starter",
  pro: "Pro",
  autonomous: "Fully Autonomous",
};

/**
 * Wraps a full page with entitlement checking.
 * Shows a clear upgrade prompt if the user doesn't have access.
 * Uses the centralized useEntitlements hook (fetches from /api/entitlements).
 */
export function EntitlementGatedPage({
  children,
  requiredFeature,
  featureLabel,
  featureDescription,
  requiredPlan,
}: EntitlementGatedPageProps) {
  const { loading, can } = useEntitlements();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--calico-primary,#FDBA74)] border-t-transparent" />
      </div>
    );
  }

  if (can(requiredFeature)) {
    return <>{children}</>;
  }

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
          href="/plans"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--calico-primary,#FDBA74)] px-6 py-3 text-sm font-semibold text-[var(--aw-text)] shadow-md hover:opacity-90 transition"
        >
          See Plans
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
