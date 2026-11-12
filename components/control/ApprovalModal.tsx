"use client";

import { AlertTriangle, Shield } from "lucide-react";
import { InlineSpinner } from "@/components/skeleton";
import type { AutomationActionRecord } from "@/lib/types";
import { fmt } from "@/lib/utils";
import { isDestructive } from "@/components/tasks/ActionCenterTypes";
import {
  acpTheme,
  acpOverlay,
  acpBackdrop,
  acpButtonPrimary,
  acpButtonSecondary,
  RISK_COLORS,
} from "./controlStyles";

interface ApprovalModalProps {
  action: AutomationActionRecord | null;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

const ACTION_RISK_MAP: Record<string, keyof typeof RISK_COLORS> = {
  subscription_cancel: "critical",
  subscription_negotiate: "high",
  bill_pay: "medium",
  debt_optimize: "high",
  savings_transfer: "medium",
};

export function ApprovalModal({
  action,
  onConfirm,
  onCancel,
  loading,
}: ApprovalModalProps) {
  if (!action) return null;

  const destructive = isDestructive(action);
  const riskKey = ACTION_RISK_MAP[action.actionType] ?? "low";
  const riskColors = RISK_COLORS[riskKey];

  return (
    <div style={acpOverlay} data-testid="approval-modal">
      {/* Backdrop */}
      <div style={acpBackdrop} onClick={loading ? undefined : onCancel} />

      {/* Modal */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          borderRadius: acpTheme.radius + 4,
          border: `1px solid ${acpTheme.border}`,
          background: acpTheme.background,
          boxShadow: "0 20px 60px rgba(0,0,0,0.12)",
          fontFamily: acpTheme.fontFamily,
        }}
      >
        {/* Header */}
        <div style={{ padding: "24px 24px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: acpTheme.radius,
                background: acpTheme.primarySoft,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Shield size={20} style={{ color: acpTheme.primary }} />
            </div>
            <div>
              <h2
                style={{
                  fontSize: "1rem",
                  fontWeight: 600,
                  color: acpTheme.text,
                  margin: 0,
                }}
              >
                Confirm action
              </h2>
              <p
                style={{
                  fontSize: "0.78rem",
                  color: acpTheme.textMuted,
                  margin: 0,
                }}
              >
                Review before Agent Wallet proceeds
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px 24px" }}>
          <h3
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              color: acpTheme.text,
              margin: "0 0 6px",
            }}
          >
            {action.title}
          </h3>
          <p
            style={{
              fontSize: "0.82rem",
              color: acpTheme.textMuted,
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            {action.summary}
          </p>

          {/* Amount */}
          {action.amount !== null && (
            <p
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
                color: acpTheme.text,
                marginTop: 10,
                marginBottom: 0,
              }}
            >
              {fmt(action.amount)}
              {action.currency ? ` ${action.currency.toUpperCase()}` : ""}
            </p>
          )}

          {/* Risk badge */}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 10px",
                borderRadius: acpTheme.radiusFull,
                fontSize: "0.7rem",
                fontWeight: 600,
                color: riskColors.color,
                background: riskColors.bg,
                border: `1px solid ${riskColors.border}`,
              }}
            >
              {riskKey.charAt(0).toUpperCase() + riskKey.slice(1)} risk
            </span>
          </div>

          {/* Destructive warning */}
          {destructive && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                marginTop: 16,
                padding: "10px 14px",
                borderRadius: acpTheme.radiusSmall,
                background: "rgba(220, 38, 38, 0.04)",
                border: "1px solid rgba(220, 38, 38, 0.12)",
              }}
            >
              <AlertTriangle
                size={14}
                style={{ color: acpTheme.danger, flexShrink: 0, marginTop: 2 }}
              />
              <p
                style={{
                  fontSize: "0.78rem",
                  color: "rgba(220, 38, 38, 0.8)",
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                This action may be difficult to reverse. Please review carefully.
              </p>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button
              type="button"
              data-testid="confirm-execute-button"
              disabled={loading}
              onClick={onConfirm}
              style={{
                ...acpButtonPrimary,
                flex: 1,
                justifyContent: "center",
                height: 42,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? (
                <>
                  <InlineSpinner size={15} />
                  Executing...
                </>
              ) : (
                "Confirm & Execute"
              )}
            </button>
            <button
              type="button"
              data-testid="cancel-approval-button"
              disabled={loading}
              onClick={onCancel}
              style={{
                ...acpButtonSecondary,
                height: 42,
                opacity: loading ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
