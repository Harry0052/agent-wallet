"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";
import {
  confirmTaskCenterAction,
  detectTaskCenterActions,
  dismissTaskCenterAction,
  fetchTaskCenterSnapshot,
  reopenTaskCenterAction,
  snoozeTaskCenterAction,
  updateTaskCenterPolicy,
  type TaskCenterSnapshot,
} from "@/services/taskCenter";
import type { AutomationPolicyMode } from "@/lib/types";
import { CommandInput } from "./CommandInput";
import { ActionCard, ActionHistoryCard } from "./ActionCard";
import { CredentialModal, type CredentialRequestDisplay } from "./CredentialModal";
import { QUICK_ACTIONS } from "./ActionCenterTypes";

// ── Command submission ──────────────────────────────────────────────────────

async function submitCommand(input: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/ai/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    return { ok: false, message: data.error || "Couldn't process that request." };
  }
  return { ok: true, message: "Got it. Calico is working on this." };
}

// ── Policy labels ───────────────────────────────────────────────────────────

function friendlyPolicyLabel(mode: AutomationPolicyMode): string {
  if (mode === "suggest_only") return "Suggest only";
  if (mode === "user_confirm_required") return "Ask me first";
  return "Let Calico act";
}

// ── Main view ───────────────────────────────────────────────────────────────

export function TaskCenterView() {
  const [snapshot, setSnapshot] = useState<TaskCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [commandLoading, setCommandLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [credentialRequest, setCredentialRequest] = useState<CredentialRequestDisplay | null>(null);
  const [credentialSubmitting, setCredentialSubmitting] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchTaskCenterSnapshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Action Center.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Derived state ───────────────────────────────────────────────────────

  const actions = snapshot?.actions ?? [];

  const activeActions = useMemo(
    () => actions.filter((a) => a.status !== "completed" && a.status !== "dismissed"),
    [actions],
  );

  const historyActions = useMemo(
    () => actions.filter((a) => a.status === "completed" || a.status === "dismissed").slice(0, 8),
    [actions],
  );

  const needsAttentionCount = useMemo(
    () => activeActions.filter((a) =>
      a.status === "pending_confirm" || a.status === "detected" || a.status === "suggested",
    ).length,
    [activeActions],
  );

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleCommand = async (input: string) => {
    setCommandLoading(true);
    setNotice(null);
    try {
      const result = await submitCommand(input);
      setNotice({ type: result.ok ? "success" : "error", message: result.message });
      if (result.ok) {
        // Detect new actions from the command
        try {
          await detectTaskCenterActions();
        } catch { /* best effort */ }
        await load();
      }
    } catch {
      setNotice({ type: "error", message: "Something went wrong. Try again." });
    } finally {
      setCommandLoading(false);
    }
  };

  const handleDetect = async () => {
    setNotice(null);
    try {
      const result = await detectTaskCenterActions();
      const count = result.result.detected;
      setNotice({
        type: count > 0 ? "success" : "info",
        message: count > 0
          ? `Found ${count} new item${count === 1 ? "" : "s"} to review.`
          : "Nothing new right now. Calico is watching.",
      });
      await load();
    } catch (e) {
      setNotice({ type: "error", message: e instanceof Error ? e.message : "Check failed." });
    }
  };

  const withBusy = async (actionId: string, fn: () => Promise<void>) => {
    setBusyActionId(actionId);
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setNotice({ type: "error", message: e instanceof Error ? e.message : "Action failed." });
    } finally {
      setBusyActionId(null);
    }
  };

  const updatePolicy = async (next: AutomationPolicyMode) => {
    setPolicySaving(true);
    try {
      await updateTaskCenterPolicy({ defaultMode: next });
      await load();
    } catch (e) {
      setNotice({ type: "error", message: e instanceof Error ? e.message : "Policy update failed." });
    } finally {
      setPolicySaving(false);
    }
  };

  // ── Credential handlers ──────────────────────────────────────────────────

  const handleCredentialSubmit = async (requestId: string, value: string) => {
    setCredentialSubmitting(true);
    setCredentialError(null);
    try {
      const res = await fetch("/api/tasks/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "submit", requestId, value }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setCredentialError(data.error || "Failed to submit. Try again.");
        return;
      }
      setCredentialRequest(null);
      setCredentialError(null);
      setNotice({ type: "success", message: "Credential received. Calico is continuing the task." });
      await load();
    } catch {
      setCredentialError("Something went wrong. Please try again.");
    } finally {
      setCredentialSubmitting(false);
    }
  };

  const handleCredentialCancel = (requestId: string) => {
    void fetch("/api/tasks/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "revoke", requestId, reason: "User cancelled" }),
    }).catch(() => {});
    setCredentialRequest(null);
    setCredentialError(null);
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="aw-page">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "rgba(59, 130, 246, 0.08)" }}
            >
              <Zap size={18} className="text-[#3B82F6]" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--aw-text)]">
              Action Center
            </h1>
          </div>
          <p className="mt-2 text-sm text-[var(--aw-text-muted)]">
            Tell Calico what to do, or review actions it found for you.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void handleDetect(); }}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--aw-border)] bg-white px-4 text-sm font-semibold text-[var(--aw-text)] transition-colors hover:bg-[var(--aw-surface-subtle)]"
        >
          <RefreshCw size={15} />
          Scan for actions
        </button>
      </div>

      {/* Command input */}
      <div className="mt-6">
        <CommandInput
          onSubmit={(input) => { void handleCommand(input); }}
          loading={commandLoading}
        />
      </div>

      {/* Quick actions */}
      {activeActions.length === 0 && !loading && (
        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.label}
              type="button"
              onClick={() => { void handleCommand(qa.input); }}
              disabled={commandLoading}
              className="rounded-full border border-[var(--aw-border)] bg-white px-3.5 py-1.5 text-[0.78rem] font-medium text-[var(--aw-text-muted)] transition-all hover:border-[rgba(59,130,246,0.3)] hover:bg-[rgba(59,130,246,0.04)] hover:text-[var(--aw-text)] disabled:opacity-50"
            >
              {qa.label}
            </button>
          ))}
        </div>
      )}

      {/* Notice banner */}
      {notice && (
        <div
          className="mt-4 rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor:
              notice.type === "error"
                ? "rgba(220, 38, 38, 0.2)"
                : notice.type === "success"
                  ? "rgba(22, 163, 74, 0.2)"
                  : "var(--aw-border)",
            background:
              notice.type === "error"
                ? "rgba(220, 38, 38, 0.04)"
                : notice.type === "success"
                  ? "rgba(22, 163, 74, 0.04)"
                  : "var(--aw-surface-subtle)",
            color:
              notice.type === "error"
                ? "#DC2626"
                : notice.type === "success"
                  ? "#16A34A"
                  : "var(--aw-text-muted)",
          }}
        >
          {notice.message}
        </div>
      )}

      {/* Attention badge */}
      {needsAttentionCount > 0 && (
        <div
          className="mt-5 flex items-center gap-2.5 rounded-xl px-4 py-3"
          style={{
            background: "rgba(59, 130, 246, 0.05)",
            border: "1px solid rgba(59, 130, 246, 0.12)",
          }}
        >
          <CheckCircle2 size={16} className="flex-shrink-0 text-[#3B82F6]" />
          <p className="text-sm font-medium text-[var(--aw-text)]">
            {needsAttentionCount} item{needsAttentionCount === 1 ? " needs" : "s need"} your review
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 size={20} className="animate-spin text-[#3B82F6]" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="mt-6 rounded-xl border border-[rgba(220,38,38,0.2)] bg-[rgba(220,38,38,0.04)] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      {/* Active actions */}
      {!loading && !error && (
        <>
          {/* Policy control */}
          <section
            className="mt-6 rounded-2xl border bg-white px-5 py-4"
            style={{ borderColor: "var(--aw-border)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[0.85rem] font-semibold text-[var(--aw-text)]">
                  When Calico finds something
                </p>
                <p className="mt-0.5 text-[0.78rem] text-[var(--aw-text-muted)]">
                  Choose how much control you want.
                </p>
              </div>
              <select
                value={snapshot?.policy.defaultMode || "user_confirm_required"}
                onChange={(e) => { void updatePolicy(e.target.value as AutomationPolicyMode); }}
                disabled={policySaving}
                className="h-9 rounded-xl border border-[var(--aw-border)] bg-white px-3 text-[0.82rem] font-medium text-[var(--aw-text)] outline-none"
              >
                <option value="suggest_only">{friendlyPolicyLabel("suggest_only")}</option>
                <option value="user_confirm_required">{friendlyPolicyLabel("user_confirm_required")}</option>
                <option value="autopilot_allowed">{friendlyPolicyLabel("autopilot_allowed")}</option>
              </select>
            </div>
          </section>

          {/* Active task list */}
          <section className="mt-5 space-y-3">
            {activeActions.length === 0 ? (
              <div
                className="rounded-2xl border border-dashed bg-white px-6 py-16 text-center"
                style={{ borderColor: "var(--aw-border)" }}
              >
                <div
                  className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ background: "rgba(59, 130, 246, 0.06)" }}
                >
                  <Zap size={24} className="text-[#3B82F6]" />
                </div>
                <p className="text-[0.95rem] font-semibold text-[var(--aw-text)]">
                  You're all caught up
                </p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--aw-text-muted)]">
                  Type a request above, or Calico will add items here when it finds
                  something worth doing — like subscriptions to cancel, bills to lower,
                  or categories to fix.
                </p>
              </div>
            ) : (
              activeActions.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  busy={busyActionId === action.id}
                  onApprove={() => { void withBusy(action.id, () => confirmTaskCenterAction(action.id)); }}
                  onSnooze={() => { void withBusy(action.id, () => snoozeTaskCenterAction(action.id, 3)); }}
                  onDismiss={() => { void withBusy(action.id, () => dismissTaskCenterAction(action.id)); }}
                  onReopen={() => { void withBusy(action.id, () => reopenTaskCenterAction(action.id)); }}
                />
              ))
            )}
          </section>

          {/* History */}
          {historyActions.length > 0 && (
            <section className="mt-8">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
                Recently handled
              </p>
              <div className="space-y-2">
                {historyActions.map((action) => (
                  <ActionHistoryCard key={action.id} action={action} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {/* Credential modal */}
      {credentialRequest && (
        <CredentialModal
          request={credentialRequest}
          onSubmit={handleCredentialSubmit}
          onCancel={handleCredentialCancel}
          submitting={credentialSubmitting}
          error={credentialError}
        />
      )}
    </div>
  );
}
