"use client";

import { TaskCenterView } from "@/components/tasks/TaskCenterView";
import { EntitlementGatedPage } from "@/components/plans/EntitlementGatedPage";

export default function TasksPage() {
  return (
    <EntitlementGatedPage
      requiredFeature="ai_automation"
      featureLabel="Your To-Do List"
      featureDescription="Calico creates and manages money tasks for you — bill reviews, savings transfers, spending alerts, and more."
      requiredPlan="autonomous"
    >
      <TaskCenterView />
    </EntitlementGatedPage>
  );
}
