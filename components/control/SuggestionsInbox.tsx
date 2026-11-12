"use client";

import { useMemo } from "react";
import { Inbox } from "lucide-react";
import type { AutomationActionRecord } from "@/lib/types";
import { acpTheme, acpLabel } from "./controlStyles";
import { SuggestionCard } from "./SuggestionCard";

interface SuggestionsInboxProps {
  actions: AutomationActionRecord[];
  busyActionId: string | null;
  onAccept: (action: AutomationActionRecord) => void;
  onReject: (actionId: string) => void;
}

const ACTIONABLE_STATUSES = new Set(["detected", "suggested", "pending_confirm"]);

export function SuggestionsInbox({
  actions,
  busyActionId,
  onAccept,
  onReject,
}: SuggestionsInboxProps) {
  const suggestions = useMemo(
    () => actions.filter((a) => ACTIONABLE_STATUSES.has(a.status)),
    [actions],
  );

  return (
    <section data-testid="suggestions-inbox">
      <p style={{ ...acpLabel, marginBottom: 12 }}>Suggestions</p>

      {suggestions.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "48px 24px",
            borderRadius: acpTheme.radius,
            border: `1px dashed ${acpTheme.border}`,
            background: acpTheme.surface,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: acpTheme.radius,
              background: acpTheme.primarySoft,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Inbox size={22} style={{ color: acpTheme.primary }} />
          </div>
          <p
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              color: acpTheme.text,
              fontFamily: acpTheme.fontFamily,
              marginBottom: 4,
            }}
          >
            No suggestions right now
          </p>
          <p
            style={{
              fontSize: "0.8rem",
              color: acpTheme.textMuted,
              fontFamily: acpTheme.fontFamily,
              textAlign: "center",
              maxWidth: 320,
            }}
          >
            Agent Wallet is watching your finances. New suggestions will appear here
            when something needs your attention.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {suggestions.map((action) => (
            <SuggestionCard
              key={action.id}
              action={action}
              busy={busyActionId === action.id}
              onAccept={() => onAccept(action)}
              onReject={() => onReject(action.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
