"use client";

import { useCallback, useEffect, useState } from "react";
import type { EntitlementsResponse } from "@/services/entitlements";
import { fetchEntitlements } from "@/services/entitlements";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TutorialStep {
  title: string;
  body: string;
  icon: string;
}

export interface TutorialState {
  /** Whether the tutorial modal is currently visible */
  visible: boolean;
  /** Current tutorial heading */
  heading: string;
  /** Current tutorial steps */
  steps: TutorialStep[];
  /** Close the tutorial and persist dismissal */
  dismiss: () => void;
  /** Re-open the tutorial (for replay from settings/help) */
  replay: () => void;
  /** Whether tutorial data is still loading */
  loading: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "calico.tutorial.dismissed";
const BASE_TUTORIAL_KEY = "calico.tutorial.base-dismissed";

/**
 * General base tutorial shown to ALL new users regardless of plan.
 * Introduces the core Calico experience.
 */
const BASE_TUTORIAL: { heading: string; steps: TutorialStep[] } = {
  heading: "Welcome to Calico!",
  steps: [
    {
      title: "This is your dashboard",
      body: "Everything starts here. Your accounts, balances, recent activity, and key insights — all in one place.",
      icon: "LayoutDashboard",
    },
    {
      title: "Connect or add accounts",
      body: "Link your bank accounts for live data, or add accounts manually. Both work seamlessly together.",
      icon: "Link",
    },
    {
      title: "Track your money",
      body: "Every transaction is organized automatically. See your spending by category, spot patterns, and stay informed.",
      icon: "Receipt",
    },
    {
      title: "Set budgets and goals",
      body: "Create simple spending plans and savings goals. Calico tracks your progress and keeps you on course.",
      icon: "PiggyBank",
    },
    {
      title: "Get insights and reports",
      body: "Calico watches your finances and surfaces what matters — spending summaries, alerts, and suggestions.",
      icon: "Sparkles",
    },
    {
      title: "Find everything in Settings",
      body: "Manage your profile, connected banks, notifications, billing, and replay this tutorial anytime.",
      icon: "Settings",
    },
  ],
};

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages the tutorial lifecycle:
 * 1. On first app load after onboarding, shows the base tutorial
 * 2. After base tutorial, shows the plan-specific tutorial
 * 3. Persists dismissal in localStorage so it doesn't repeat
 * 4. Provides `replay()` to re-open from settings/help
 */
export function useTutorial(): TutorialState {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<"base" | "plan" | "idle">("idle");
  const [planTutorial, setPlanTutorial] = useState<{ heading: string; steps: TutorialStep[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [forceReplay, setForceReplay] = useState(false);

  // Load plan tutorial data from entitlements
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data: EntitlementsResponse = await fetchEntitlements();
        if (!cancelled && data.tutorial) {
          setPlanTutorial(data.tutorial);
        }
      } catch {
        // Tutorial is non-critical — fail silently
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  // Determine initial visibility
  useEffect(() => {
    if (loading) return;

    const baseDismissed = localStorage.getItem(BASE_TUTORIAL_KEY) === "1";
    const planDismissed = localStorage.getItem(STORAGE_KEY) === "1";

    if (!baseDismissed) {
      setPhase("base");
      setVisible(true);
    } else if (!planDismissed && planTutorial) {
      setPhase("plan");
      setVisible(true);
    } else {
      setPhase("idle");
      setVisible(false);
    }
  }, [loading, planTutorial]);

  const dismiss = useCallback(() => {
    if (phase === "base") {
      localStorage.setItem(BASE_TUTORIAL_KEY, "1");
      // After base tutorial, show plan tutorial if available and not dismissed
      const planDismissed = localStorage.getItem(STORAGE_KEY) === "1";
      if (planTutorial && !planDismissed && !forceReplay) {
        setPhase("plan");
        // visible stays true — seamless transition
        return;
      }
    }

    if (phase === "plan") {
      localStorage.setItem(STORAGE_KEY, "1");
    }

    setPhase("idle");
    setVisible(false);
    setForceReplay(false);
  }, [phase, planTutorial, forceReplay]);

  const replay = useCallback(() => {
    setForceReplay(true);
    setPhase("base");
    setVisible(true);
  }, []);

  // Compute the current tutorial content
  let heading = "";
  let steps: TutorialStep[] = [];

  if (phase === "base") {
    heading = BASE_TUTORIAL.heading;
    steps = BASE_TUTORIAL.steps;
  } else if (phase === "plan" && planTutorial) {
    heading = planTutorial.heading;
    steps = planTutorial.steps;
  }

  return {
    visible,
    heading,
    steps,
    dismiss,
    replay,
    loading,
  };
}
