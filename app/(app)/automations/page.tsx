"use client";

import { AutomationsView } from "@/components/automations/AutomationsView";
import { EntitlementGatedPage } from "@/components/plans/EntitlementGatedPage";

export default function AutomationsPage() {
  return (
    <EntitlementGatedPage
      requiredFeature="ai_automation"
      featureLabel="Automations"
      featureDescription="Let Agent Wallet handle routine money tasks with approval-aware automation."
      requiredPlan="autonomous"
    >
      <AutomationsView />
    </EntitlementGatedPage>
  );
}
