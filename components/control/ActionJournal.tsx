"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Clock, XCircle } from "lucide-react";
import type { AutomationActionRecord } from "@/lib/types";
import { fmt } from "@/lib/utils";
import { ACTION_TYPE_LABELS } from "@/components/tasks/ActionCenterTypes";
import { acpTheme, acpCard, acpLabel, acpBadge } from "./controlStyles";

interface ActionJournalProps {
  actions: AutomationActionRecord[];
}

function relativeTime(dateString: string | null): string {
  if (!dateString) return "";
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActionJournal({ actions }: ActionJournalProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section data-testid="action-journal">
      <p style={{ ...acpLabel, marginBottom: 12 }}>Action Journal</p>

      {actions.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 24px",
            borderRadius: acpTheme.radius,
            border: `1px dashed ${acpTheme.border}`,
            background: acpTheme.surface,
          }}
        >
          <Clock size={20} style={{ color: acpTheme.textLight, marginBottom: 8 }} />
          <p
            style={{
              fontSize: "0.82rem",
              color: acpTheme.textMuted,
              fontFamily: acpTheme.fontFamily,
            }}
          >
            No completed actions yet
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {actions.map((action) => {
            const isExpanded = expandedId === action.id;
            const isCompleted = action.status === "completed";
            const statusTime = isCompleted ? action.completedAt : action.updatedAt;

            return (
              <div
                key={action.id}
                data-testid={`journal-entry-${action.id}`}
                style={{
                  ...acpCard,
                  padding: "12px 16px",
                  cursor: "pointer",
                  transition: "box-shadow 0.15s ease",
                }}
                onClick={() => setExpandedId(isExpanded ? null : action.id)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    {isCompleted ? (
                      <CheckCircle2 size={16} style={{ color: acpTheme.success, flexShrink: 0 }} />
                    ) : (
                      <XCircle size={16} style={{ color: acpTheme.danger, flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p
                        style={{
                          fontSize: "0.82rem",
                          fontWeight: 500,
                          color: acpTheme.text,
                          fontFamily: acpTheme.fontFamily,
                          margin: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {action.title}
                      </p>
                      <p
                        style={{
                          fontSize: "0.72rem",
                          color: acpTheme.textLight,
                          fontFamily: acpTheme.fontFamily,
                          margin: "2px 0 0",
                        }}
                      >
                        {ACTION_TYPE_LABELS[action.actionType]} &middot; {relativeTime(statusTime)}
                      </p>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {action.amount !== null && (
                      <span
                        style={{
                          fontSize: "0.82rem",
                          fontWeight: 600,
                          color: acpTheme.text,
                          fontFamily: acpTheme.fontFamily,
                        }}
                      >
                        {fmt(action.amount)}
                      </span>
                    )}
                    <span
                      style={{
                        ...acpBadge,
                        color: isCompleted ? acpTheme.success : acpTheme.danger,
                        background: isCompleted ? acpTheme.successSoft : acpTheme.dangerSoft,
                        border: `1px solid ${isCompleted ? "rgba(22, 163, 74, 0.2)" : "rgba(220, 38, 38, 0.2)"}`,
                      }}
                    >
                      {isCompleted ? "Done" : "Failed"}
                    </span>
                    {isExpanded ? (
                      <ChevronUp size={14} style={{ color: acpTheme.textLight }} />
                    ) : (
                      <ChevronDown size={14} style={{ color: acpTheme.textLight }} />
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: `1px solid ${acpTheme.borderLight}`,
                    }}
                  >
                    <p
                      style={{
                        fontSize: "0.78rem",
                        color: acpTheme.textMuted,
                        fontFamily: acpTheme.fontFamily,
                        lineHeight: 1.55,
                        margin: 0,
                      }}
                    >
                      {action.summary}
                    </p>
                    {action.explainability.summary && (
                      <p
                        style={{
                          fontSize: "0.78rem",
                          color: acpTheme.textMuted,
                          fontFamily: acpTheme.fontFamily,
                          lineHeight: 1.55,
                          marginTop: 6,
                          margin: "6px 0 0",
                        }}
                      >
                        {action.explainability.summary}
                      </p>
                    )}
                    {action.lastError && (
                      <p
                        style={{
                          fontSize: "0.78rem",
                          color: acpTheme.danger,
                          fontFamily: acpTheme.fontFamily,
                          lineHeight: 1.55,
                          marginTop: 6,
                          margin: "6px 0 0",
                        }}
                      >
                        Error: {action.lastError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
