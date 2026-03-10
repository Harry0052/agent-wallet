"use client";

import { SettingsPanel } from "@/components/SettingsPanel";

export default function SettingsPage() {
  return (
    <div className="aw-page">
      <div className="aw-page-header">
        <p className="aw-page-kicker">Settings</p>
        <h1 className="aw-page-title">Settings</h1>
        <p className="aw-page-subtitle">
          Spending rules, approval thresholds, and recipient controls.
        </p>
      </div>

      <div className="max-w-2xl">
        <SettingsPanel alwaysShow />
      </div>
    </div>
  );
}
