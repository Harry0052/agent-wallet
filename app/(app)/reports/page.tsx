"use client";

import { ReportsView } from "@/components/reports/ReportsView";
import { EntitlementGatedPage } from "@/components/plans/EntitlementGatedPage";

export default function ReportsPage() {
  return (
    <EntitlementGatedPage
      requiredFeature="spending_trends"
      featureLabel="Reports"
      featureDescription="See detailed spending trends, income vs. expense breakdowns, and category analysis to understand where your money goes."
      requiredPlan="pro"
    >
      <ReportsView />
    </EntitlementGatedPage>
  );
}
