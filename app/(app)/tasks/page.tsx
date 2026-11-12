"use client";

import { TaskCenterView } from "@/components/tasks/TaskCenterView";
import { EntitlementGatedPage } from "@/components/plans/EntitlementGatedPage";

export default function TasksPage() {
  return (
    <EntitlementGatedPage
      requiredFeature="ai_automation"
      featureLabel="Action Center"
      featureDescription="Tell Agent Wallet what to do — cancel subscriptions, lower bills, move money, and more. Agent Wallet handles the work with your approval."
      requiredPlan="autonomous"
    >
      <TaskCenterView />
    </EntitlementGatedPage>
  );
}
