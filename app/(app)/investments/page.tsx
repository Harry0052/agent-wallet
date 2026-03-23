"use client";

import { InvestmentsView } from "@/components/investments/InvestmentsView";
import { EntitlementGatedPage } from "@/components/plans/EntitlementGatedPage";

export default function InvestmentsPage() {
  return (
    <EntitlementGatedPage
      requiredFeature="investments"
      featureLabel="Investments"
      featureDescription="Track holdings and portfolio value inside your broader money picture."
      requiredPlan="pro"
    >
      <InvestmentsView />
    </EntitlementGatedPage>
  );
}
