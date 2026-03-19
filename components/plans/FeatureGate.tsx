"use client";

import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import type { PlanId } from "@/services/billing";

interface FeatureGateProps {
  children: React.ReactNode;
  hasAccess: boolean;
  featureLabel: string;
  requiredPlan: PlanId;
}

const PLAN_NAMES: Record<PlanId, string> = {
  starter: "Starter",
  pro: "Pro",
  autonomous: "Fully Autonomous",
};

export function FeatureGate({ children, hasAccess, featureLabel, requiredPlan }: FeatureGateProps) {
  const router = useRouter();

  if (hasAccess) return <>{children}</>;

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{ border: "1px solid #F2DECC", background: "#FFFCF8" }}
    >
      {/* Blurred preview */}
      <div className="pointer-events-none select-none" style={{ filter: "blur(4px)", opacity: 0.4 }}>
        {children}
      </div>

      {/* Upgrade overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <div
          className="mb-3 flex h-10 w-10 items-center justify-center"
          style={{ borderRadius: 12, background: "rgba(253,186,116,0.18)" }}
        >
          <Lock size={18} color="#FDBA74" />
        </div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#111" }}>
          {featureLabel}
        </p>
        <p className="mt-1" style={{ fontSize: 13, color: "#6B5B4B", lineHeight: 1.5 }}>
          This is part of the {PLAN_NAMES[requiredPlan]} plan.
        </p>
        <button
          type="button"
          onClick={() => router.push("/settings?section=billing")}
          className="mt-4 rounded-full px-5 py-2 text-sm font-semibold transition-transform active:scale-[0.98]"
          style={{ background: "#FDBA74", color: "#111", boxShadow: "0 2px 12px rgba(253,186,116,0.3)" }}
        >
          Upgrade to {PLAN_NAMES[requiredPlan]}
        </button>
      </div>
    </div>
  );
}
