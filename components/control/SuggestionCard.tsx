"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { InlineSpinner } from "@/components/skeleton";
import type { AutomationActionRecord, AutomationActionType } from "@/lib/types";
import { fmt } from "@/lib/utils";
import {
  acpTheme,
  acpCard,
  acpButtonPrimary,
  acpButtonSecondary,
  acpButtonText,
  acpBadge,
  RISK_COLORS,
  type RiskLevel,
} from "./controlStyles";

interface SuggestionCardProps {
  action: AutomationActionRecord;
  onAccept: () => void;
  onReject: () => void;
  busy: boolean;
}

/** Map action types to a risk level for the badge */
const ACTION_RISK: Record<AutomationActionType, RiskLevel> = {
  expense_categorization: "low",
  refund_budget: "low",
  recurring_review: "low",
  trial_conversion_review: "medium",
  bill_split: "low",
  savings_transfer: "medium",
  bill_pay: "medium",
  debt_optimize: "high",
  subscription_negotiate: "high",
  subscription_cancel: "critical",
};

function getRisk(action: AutomationActionRecord): RiskLevel {
  return ACTION_RISK[action.actionType] ?? "medium";
}

function riskLabel(level: RiskLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function SuggestionCard({
  action,
  onAccept,
  onReject,
  busy,
}: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const risk = getRisk(action);
  const riskColors = RISK_COLORS[risk];

  return (
    <article
      data-testid={`suggestion-card-${action.id}`}
      style={{
        ...acpCard,
        padding: "16px 20px",
        transition: "box-shadow 0.15s ease",
      }}
    >
      {/* Top row: title + risk badge */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3
              style={{
                fontSize: "0.88rem",
                fontWeight: 600,
                color: acpTheme.text,
                fontFamily: acpTheme.fontFamily,
                margin: 0,
              }}
            >
              {action.title}
            </h3>
            <span
              style={{
                ...acpBadge,
                color: riskColors.color,
                background: riskColors.bg,
                border: `1px solid ${riskColors.border}`,
              }}
            >
              {riskLabel(risk)} risk
            </span>
          </div>

          {/* Rationale / summary */}
          <p
            style={{
              fontSize: "0.8rem",
              color: acpTheme.textMuted,
              fontFamily: acpTheme.fontFamily,
              lineHeight: 1.55,
              marginTop: 6,
              margin: "6px 0 0 0",
            }}
          >
            {action.summary}
          </p>

          {/* Amount */}
          {action.amount !== null && (
            <p
              style={{
                fontSize: "0.88rem",
                fontWeight: 600,
                color: acpTheme.text,
                fontFamily: acpTheme.fontFamily,
                marginTop: 6,
              }}
            >
              {fmt(action.amount)}
              {action.currency ? ` ${action.currency.toUpperCase()}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: `1px solid ${acpTheme.borderLight}`,
          }}
        >
          {/* Explainability factors */}
          {action.explainability.factors.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: acpTheme.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 6,
                }}
              >
                Why this action
              </p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {action.explainability.factors.map((factor, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: "0.78rem",
                      color: acpTheme.textMuted,
                      fontFamily: acpTheme.fontFamily,
                      lineHeight: 1.6,
                    }}
                  >
                    {factor}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Confidence */}
          <div style={{ display: "flex", gap: 24 }}>
            <div>
              <p
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: acpTheme.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 2,
                }}
              >
                Confidence
              </p>
              <p
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: acpTheme.text,
                  fontFamily: acpTheme.fontFamily,
                }}
              >
                {Math.round(action.confidence * 100)}%
              </p>
            </div>
            <div>
              <p
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: acpTheme.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 2,
                }}
              >
                Coverage
              </p>
              <p
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: acpTheme.text,
                  fontFamily: acpTheme.fontFamily,
                }}
              >
                {Math.round(action.coverageConfidence * 100)}%
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 14,
        }}
      >
        <button
          type="button"
          data-testid={`accept-button-${action.id}`}
          disabled={busy}
          onClick={onAccept}
          style={{
            ...acpButtonPrimary,
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? <InlineSpinner size={14} /> : <Check size={14} />}
          Accept
        </button>
        <button
          type="button"
          data-testid={`reject-button-${action.id}`}
          disabled={busy}
          onClick={onReject}
          style={{
            ...acpButtonSecondary,
            opacity: busy ? 0.5 : 1,
          }}
        >
          <X size={13} />
          Reject
        </button>
        <button
          type="button"
          data-testid={`details-button-${action.id}`}
          onClick={() => setExpanded(!expanded)}
          style={acpButtonText}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? "Less" : "Details"}
        </button>
      </div>
    </article>
  );
}
