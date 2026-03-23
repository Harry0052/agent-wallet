"use client";

import { TaskCenterView } from "@/components/tasks/TaskCenterView";
import { EntitlementGatedPage } from "@/components/plans/EntitlementGatedPage";

export default function TasksPage() {
  return (
    <EntitlementGatedPage
      requiredFeature="ai_automation"
      featureLabel="Action Center"
      featureDescription="Tell Calico what to do — cancel subscriptions, lower bills, move money, and more. Calico handles the work with your approval."
      requiredPlan="autonomous"
    >
      <TaskCenterView />
    </EntitlementGatedPage>
  );
}
