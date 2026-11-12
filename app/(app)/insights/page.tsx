"use client";

import { InsightsView } from "@/components/insights/InsightsView";
import { EntitlementGatedPage } from "@/components/plans/EntitlementGatedPage";

export default function InsightsPage() {
  return (
    <EntitlementGatedPage
      requiredFeature="advanced_insights"
      featureLabel="What Agent Wallet Noticed"
      featureDescription="Get smarter tips and deeper explanations about your spending patterns and money habits."
      requiredPlan="pro"
    >
      <InsightsView />
    </EntitlementGatedPage>
  );
}
