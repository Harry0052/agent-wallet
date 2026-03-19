"use client";

import { GoalsView } from "@/components/goals/GoalsView";
import { EntitlementGatedPage } from "@/components/plans/EntitlementGatedPage";

export default function GoalsPage() {
  return (
    <EntitlementGatedPage
      requiredFeature="simple_goals"
      featureLabel="Money Goals"
      featureDescription="Set savings targets and payoff goals, then track them with shared transaction data."
      requiredPlan="pro"
    >
      <GoalsView />
    </EntitlementGatedPage>
  );
}
