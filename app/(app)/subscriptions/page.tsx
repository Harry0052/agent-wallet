"use client";

import { SubscriptionOpsPanel } from "@/components/SubscriptionOpsPanel";

export default function SubscriptionsPage() {
  return (
    <div className="aw-page">
      <div className="aw-page-header">
        <p className="aw-page-kicker">Subscriptions</p>
        <h1 className="aw-page-title">Subscriptions</h1>
        <p className="aw-page-subtitle">
          Manage active plans, renewals, downgrades, and cancellations.
        </p>
      </div>

      <SubscriptionOpsPanel alwaysShow />
    </div>
  );
}
