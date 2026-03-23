import type {
  AutomationActionRecord,
  AutomationActionStatus,
  AutomationActionType,
} from "@/lib/types";

// ── Task statuses for the Action Center UI ──────────────────────────────────

export type ActionCardStatus =
  | "draft"
  | "needs_info"
  | "ready"
  | "running"
  | "waiting_verification"
  | "completed"
  | "failed"
  | "needs_followup";

/** Map backend statuses to the richer Action Center statuses */
export function toCardStatus(status: AutomationActionStatus): ActionCardStatus {
  switch (status) {
    case "detected":
    case "suggested":
      return "draft";
    case "pending_confirm":
      return "ready";
    case "attempted":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "dismissed":
    case "snoozed":
      return "needs_followup";
    default:
      return "draft";
  }
}

export interface StatusConfig {
  label: string;
  color: string;
  bg: string;
  border: string;
  pulse?: boolean;
}

export const STATUS_CONFIG: Record<ActionCardStatus, StatusConfig> = {
  draft: {
    label: "Reviewing",
    color: "var(--aw-text-muted)",
    bg: "var(--aw-surface-subtle)",
    border: "var(--aw-border)",
  },
  needs_info: {
    label: "Needs info",
    color: "#B45309",
    bg: "rgba(253, 186, 116, 0.12)",
    border: "rgba(253, 186, 116, 0.3)",
  },
  ready: {
    label: "Ready for approval",
    color: "#1D4ED8",
    bg: "rgba(59, 130, 246, 0.08)",
    border: "rgba(59, 130, 246, 0.2)",
  },
  running: {
    label: "Running",
    color: "#1D4ED8",
    bg: "rgba(59, 130, 246, 0.08)",
    border: "rgba(59, 130, 246, 0.2)",
    pulse: true,
  },
  waiting_verification: {
    label: "Waiting for verification",
    color: "#B45309",
    bg: "rgba(253, 186, 116, 0.12)",
    border: "rgba(253, 186, 116, 0.3)",
    pulse: true,
  },
  completed: {
    label: "Completed",
    color: "#16A34A",
    bg: "rgba(22, 163, 74, 0.08)",
    border: "rgba(22, 163, 74, 0.2)",
  },
  failed: {
    label: "Failed",
    color: "#DC2626",
    bg: "rgba(220, 38, 38, 0.06)",
    border: "rgba(220, 38, 38, 0.2)",
  },
  needs_followup: {
    label: "Follow up needed",
    color: "var(--aw-text-muted)",
    bg: "var(--aw-surface-subtle)",
    border: "var(--aw-border)",
  },
};

export const ACTION_TYPE_LABELS: Record<AutomationActionType, string> = {
  subscription_cancel: "Cancel subscription",
  subscription_negotiate: "Lower bill",
  bill_pay: "Pay bill",
  savings_transfer: "Move to savings",
  debt_optimize: "Optimize debt payment",
  expense_categorization: "Fix category",
  refund_budget: "Budget refund",
  recurring_review: "Review recurring charge",
  trial_conversion_review: "Free trial ending",
  bill_split: "Split expense",
};

export const QUICK_ACTIONS = [
  { label: "Cancel a subscription", input: "Cancel a subscription I don't use" },
  { label: "Lower a bill", input: "Find ways to lower my recurring bills" },
  { label: "Review recurring charges", input: "Review all my recurring charges and flag anything unusual" },
  { label: "Move money to savings", input: "Transfer what I can safely save this month" },
  { label: "Fix a miscategorized charge", input: "Help me fix miscategorized transactions" },
  { label: "Review free trials", input: "Check if any free trials are about to convert to paid" },
] as const;

/** Actions that require extra confirmation before execution */
export const DESTRUCTIVE_ACTION_TYPES = new Set<AutomationActionType>([
  "subscription_cancel",
  "subscription_negotiate",
  "bill_pay",
  "debt_optimize",
]);

export function isDestructive(action: AutomationActionRecord): boolean {
  return DESTRUCTIVE_ACTION_TYPES.has(action.actionType);
}
