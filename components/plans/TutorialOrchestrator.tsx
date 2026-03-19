"use client";

import { createContext, useContext } from "react";
import { PlanTutorial } from "@/components/plans/PlanTutorial";
import { useTutorial, type TutorialState } from "@/lib/useTutorial";

// ── Context for replay access ────────────────────────────────────────────────

const TutorialContext = createContext<{ replay: () => void } | null>(null);

/**
 * Access the tutorial replay function from anywhere in the app.
 * Use this in Settings or help buttons to let users re-open the tutorial.
 */
export function useTutorialReplay(): { replay: () => void } {
  const ctx = useContext(TutorialContext);
  if (!ctx) return { replay: () => {} };
  return ctx;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Renders inside the app shell. Handles tutorial visibility,
 * plan-specific content, and provides replay context to the tree.
 */
export function TutorialOrchestrator({ children }: { children: React.ReactNode }) {
  const tutorial: TutorialState = useTutorial();

  return (
    <TutorialContext.Provider value={{ replay: tutorial.replay }}>
      {children}
      {tutorial.visible && tutorial.steps.length > 0 && (
        <PlanTutorial
          key={`${tutorial.heading}-${tutorial.steps.length}`}
          heading={tutorial.heading}
          steps={tutorial.steps}
          onComplete={tutorial.dismiss}
          onSkip={tutorial.skip}
        />
      )}
    </TutorialContext.Provider>
  );
}
