"use client";

import { X } from "lucide-react";
import type { AutomationActionType, AutomationPolicyMode } from "@/lib/types";
import type { AutomationPolicyConfig } from "@/services/taskCenter";
import { ACTION_TYPE_LABELS } from "@/components/tasks/ActionCenterTypes";
import { acpTheme, acpLabel, acpButtonPrimary } from "./controlStyles";

interface AutonomySettingsProps {
  policy: AutomationPolicyConfig;
  onUpdate: (patch: {
    defaultMode?: AutomationPolicyMode;
    autopilotEnabledActions?: Partial<Record<AutomationActionType, boolean>>;
  }) => void;
  saving: boolean;
  onClose: () => void;
}

const MODE_OPTIONS: { value: AutomationPolicyMode; label: string; description: string }[] = [
  {
    value: "suggest_only",
    label: "Suggest only",
    description: "Agent Wallet finds opportunities but takes no action.",
  },
  {
    value: "user_confirm_required",
    label: "Ask me first",
    description: "Agent Wallet prepares actions and waits for your approval.",
  },
  {
    value: "autopilot_allowed",
    label: "Autopilot",
    description: "Agent Wallet acts automatically on low-risk items.",
  },
];

const ALL_ACTION_TYPES = Object.keys(ACTION_TYPE_LABELS) as AutomationActionType[];

export function AutonomySettings({
  policy,
  onUpdate,
  saving,
  onClose,
}: AutonomySettingsProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.2)",
          backdropFilter: "blur(2px)",
        }}
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        data-testid="autonomy-settings"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          maxWidth: "100vw",
          background: acpTheme.background,
          borderLeft: `1px solid ${acpTheme.border}`,
          boxShadow: "-8px 0 30px rgba(0,0,0,0.08)",
          fontFamily: acpTheme.fontFamily,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: `1px solid ${acpTheme.border}`,
          }}
        >
          <h2
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              color: acpTheme.text,
              margin: 0,
            }}
          >
            Autonomy Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: acpTheme.radiusSmall,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: acpTheme.textMuted,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          {/* Global mode */}
          <div style={{ marginBottom: 28 }}>
            <p style={{ ...acpLabel, marginBottom: 12 }}>Global mode</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {MODE_OPTIONS.map((opt) => {
                const isActive = policy.defaultMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={saving}
                    onClick={() => onUpdate({ defaultMode: opt.value })}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      padding: "12px 16px",
                      borderRadius: acpTheme.radius,
                      border: `1px solid ${isActive ? acpTheme.primary : acpTheme.border}`,
                      background: isActive ? acpTheme.primarySoft : acpTheme.background,
                      cursor: saving ? "default" : "pointer",
                      opacity: saving ? 0.6 : 1,
                      transition: "border-color 0.15s ease, background 0.15s ease",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        color: isActive ? acpTheme.primary : acpTheme.text,
                        fontFamily: acpTheme.fontFamily,
                      }}
                    >
                      {opt.label}
                    </span>
                    <span
                      style={{
                        fontSize: "0.78rem",
                        color: acpTheme.textMuted,
                        fontFamily: acpTheme.fontFamily,
                        marginTop: 2,
                      }}
                    >
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Per-action type toggles */}
          <div>
            <p style={{ ...acpLabel, marginBottom: 12 }}>Autopilot per action type</p>
            <p
              style={{
                fontSize: "0.78rem",
                color: acpTheme.textMuted,
                fontFamily: acpTheme.fontFamily,
                marginBottom: 16,
                lineHeight: 1.55,
              }}
            >
              When autopilot is enabled globally, control which action types can run automatically.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ALL_ACTION_TYPES.map((actionType) => {
                const enabled = policy.autopilotEnabledActions[actionType] ?? false;
                return (
                  <div
                    key={actionType}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: acpTheme.radiusSmall,
                      background: acpTheme.surface,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.82rem",
                        color: acpTheme.text,
                        fontFamily: acpTheme.fontFamily,
                      }}
                    >
                      {ACTION_TYPE_LABELS[actionType]}
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        onUpdate({
                          autopilotEnabledActions: { [actionType]: !enabled },
                        })
                      }
                      style={{
                        position: "relative",
                        width: 40,
                        height: 22,
                        borderRadius: 11,
                        border: "none",
                        background: enabled ? acpTheme.primary : acpTheme.border,
                        cursor: saving ? "default" : "pointer",
                        transition: "background 0.2s ease",
                        opacity: saving ? 0.5 : 1,
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: 2,
                          left: enabled ? 20 : 2,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "#FFFFFF",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                          transition: "left 0.2s ease",
                        }}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: `1px solid ${acpTheme.border}`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              ...acpButtonPrimary,
              width: "100%",
              justifyContent: "center",
              height: 40,
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
