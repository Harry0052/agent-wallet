"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings } from "lucide-react";
import { ControlCenterSkeleton } from "@/components/skeleton";
import {
  fetchTaskCenterSnapshot,
  type TaskCenterSnapshot,
} from "@/services/taskCenter";
import type { AutomationActionRecord } from "@/lib/types";
import { acpTheme, acpHeading, acpSubheading } from "./controlStyles";
import { SuggestionsInbox } from "./SuggestionsInbox";
import { LiveAgentPanel } from "./LiveAgentPanel";
import { ActionJournal } from "./ActionJournal";
import { AutonomySettings } from "./AutonomySettings";
import { ApprovalModal } from "./ApprovalModal";
import {
  attemptTaskCenterAction,
  confirmTaskCenterAction,
  dismissTaskCenterAction,
  updateTaskCenterPolicy,
} from "@/services/taskCenter";
import type { AutomationPolicyMode } from "@/lib/types";

export function ControlCenter() {
  const [snapshot, setSnapshot] = useState<TaskCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approvalAction, setApprovalAction] = useState<AutomationActionRecord | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [policySaving, setPolicySaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchTaskCenterSnapshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Control Center.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const actions = snapshot?.actions ?? [];

  const activeAction = useMemo(
    () => actions.find((a) => a.id === activeActionId) ?? null,
    [actions, activeActionId],
  );

  const completedActions = useMemo(
    () => actions.filter((a) => a.status === "completed" || a.status === "failed"),
    [actions],
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAccept = (action: AutomationActionRecord) => {
    setApprovalAction(action);
  };

  const handleReject = async (actionId: string) => {
    setBusyActionId(actionId);
    try {
      await dismissTaskCenterAction(actionId);
      await load();
    } catch {
      // silent
    } finally {
      setBusyActionId(null);
    }
  };

  const handleConfirmApproval = async () => {
    if (!approvalAction) return;
    setApprovalLoading(true);
    try {
      await confirmTaskCenterAction(approvalAction.id);
      await attemptTaskCenterAction(approvalAction.id);
      setActiveActionId(approvalAction.id);
      setApprovalAction(null);
      await load();
    } catch {
      // silent
    } finally {
      setApprovalLoading(false);
    }
  };

  const handlePolicyUpdate = async (patch: {
    defaultMode?: AutomationPolicyMode;
    autopilotEnabledActions?: Partial<Record<string, boolean>>;
  }) => {
    setPolicySaving(true);
    try {
      await updateTaskCenterPolicy(patch);
      await load();
    } catch {
      // silent
    } finally {
      setPolicySaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="control-center"
      style={{
        background: acpTheme.background,
        minHeight: "100vh",
        fontFamily: acpTheme.fontFamily,
        padding: 32,
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 32,
        }}
      >
        <div>
          <h1 style={acpHeading}>Autonomous Control Center</h1>
          <p style={{ ...acpSubheading, marginTop: 4 }}>
            Review, approve, and monitor Calico's autonomous actions.
          </p>
        </div>
        <button
          type="button"
          data-testid="settings-button"
          onClick={() => setSettingsOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: acpTheme.radius,
            border: `1px solid ${acpTheme.border}`,
            background: acpTheme.background,
            cursor: "pointer",
            color: acpTheme.textMuted,
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = acpTheme.surface; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = acpTheme.background; }}
        >
          <Settings size={18} />
        </button>
      </header>

      {/* Loading */}
      {loading && (
        <ControlCenterSkeleton />
      )}

      {/* Error */}
      {!loading && error && (
        <div
          style={{
            borderRadius: acpTheme.radius,
            border: `1px solid rgba(220, 38, 38, 0.2)`,
            background: "rgba(220, 38, 38, 0.04)",
            padding: "12px 16px",
            fontSize: "0.85rem",
            color: acpTheme.danger,
          }}
        >
          {error}
        </div>
      )}

      {/* Main content */}
      {!loading && !error && (
        <>
          {/* Two-column body */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 380px",
              gap: 24,
              alignItems: "start",
            }}
          >
            {/* Left: Suggestions */}
            <SuggestionsInbox
              actions={actions}
              busyActionId={busyActionId}
              onAccept={handleAccept}
              onReject={(id) => { void handleReject(id); }}
            />

            {/* Right: Live Agent Panel */}
            <LiveAgentPanel
              actionId={activeActionId}
              action={activeAction}
            />
          </div>

          {/* Bottom: Action Journal */}
          <div style={{ marginTop: 32 }}>
            <ActionJournal actions={completedActions} />
          </div>
        </>
      )}

      {/* Approval Modal */}
      <ApprovalModal
        action={approvalAction}
        onConfirm={() => { void handleConfirmApproval(); }}
        onCancel={() => setApprovalAction(null)}
        loading={approvalLoading}
      />

      {/* Autonomy Settings */}
      {settingsOpen && snapshot && (
        <AutonomySettings
          policy={snapshot.policy}
          onUpdate={(patch) => { void handlePolicyUpdate(patch); }}
          saving={policySaving}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Spin animation for inline spinners */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
