"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { X, ShieldCheck, Key, AlertCircle, ChevronDown } from "lucide-react";
import { fetchUserTools } from "@/services/tools";
import type { UserToolRecord } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskRecord = {
  id: string;
  userId: string;
  prompt: string;
  tinyfishRunId: string | null;
  tinyfishRunUrl: string | null;
  status: "running" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
};

type StartTaskResponse = {
  ok: true;
  task: TaskRecord;
  requestType: "task";
};

type CredentialStep =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "select"; tools: UserToolRecord[]; autoMatchId: string | null }
  | { type: "ready" };

interface TaskChatProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best-effort extraction of the target service from the prompt.
 *  Used only for pre-selection — never as the final gate. */
function guessServiceName(prompt: string): string {
  const lower = prompt.toLowerCase();

  const verbPatterns =
    /(?:log\s*in(?:to)?|sign\s*in(?:to)?|login\s*(?:to)?|open|launch|access|go\s*to|check|navigate\s*to|connect\s*to)\s+([a-z0-9][a-z0-9\s\-_.]{1,30}?)(?:\s+(?:and|dashboard|account|profile|page|tab|portal|site)\b|$)/i;

  const m = lower.match(verbPatterns);
  if (m?.[1]) return m[1].trim();

  // Fallback: first proper noun
  const noun = prompt.match(/\b([A-Z][a-zA-Z0-9]{2,})\b/);
  if (noun?.[1]) return noun[1];

  return "";
}

function bestMatchTool(
  tools: UserToolRecord[],
  hint: string,
): string | null {
  if (!hint || tools.length === 0) return null;
  const lower = hint.toLowerCase();

  const scored = tools.map((t) => {
    const key = (t.tool?.key ?? "").toLowerCase();
    const name = (t.tool?.displayName ?? t.label ?? "").toLowerCase();
    let score = 0;
    if (key === lower || name === lower) score = 3;
    else if (key.includes(lower) || lower.includes(key)) score = 2;
    else if (name.includes(lower) || lower.includes(name)) score = 1;
    return { t, score };
  });

  const best = scored.sort((a, b) => b.score - a.score)[0];
  return best && best.score > 0 ? best.t.id : null;
}

function formatStatus(status: TaskRecord["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  return "Running";
}

const NO_TOOL_VALUE = "__none__";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskChat({ onClose }: TaskChatProps) {
  const [prompt, setPrompt] = useState("");
  const [credentialStep, setCredentialStep] = useState<CredentialStep>({ type: "idle" });
  const [selectedToolId, setSelectedToolId] = useState<string>(NO_TOOL_VALUE);
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedTask, setStartedTask] = useState<TaskRecord | null>(null);
  const [manualEmail, setManualEmail] = useState("");
  const [manualPassword, setManualPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  function handleClose() {
    abortRef.current?.abort();
    abortRef.current = null;
    setSubmitting(false);
    setError(null);
    onClose();
  }

  function resetFlow() {
    setCredentialStep({ type: "idle" });
    setSafetyConfirmed(false);
    setSelectedToolId(NO_TOOL_VALUE);
    setManualEmail("");
    setManualPassword("");
    setVerificationCode("");
    setError(null);
    setStartedTask(null);
  }

  // Step 1 — check credentials
  async function handleCheckCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = prompt.trim();
    if (!intent) return;

    resetFlow();
    setCredentialStep({ type: "checking" });

    console.debug("[TaskChat] source=task | checking tools for:", intent);

    try {
      const all = await fetchUserTools();
      // Only show connected & enabled tools that have credentials
      const usable = all.filter(
        (t) => t.enabled && t.status === "connected",
      );

      console.debug("[TaskChat] usable tools:", usable.map((t) => t.tool?.displayName ?? t.label));

      const hint = guessServiceName(intent);
      const autoMatchId = bestMatchTool(usable, hint);

      console.debug("[TaskChat] hint:", hint, "| autoMatchId:", autoMatchId ?? "none");

      setCredentialStep({ type: "select", tools: usable, autoMatchId });
      setSelectedToolId(autoMatchId ?? NO_TOOL_VALUE);
    } catch {
      // Tools fetch failed — fall through to manual entry
      setCredentialStep({ type: "select", tools: [], autoMatchId: null });
      setSelectedToolId(NO_TOOL_VALUE);
    }
  }

  // Step 2 — start task
  async function handleStartTask() {
    if (!safetyConfirmed || submitting) return;
    const intent = prompt.trim();
    if (!intent) return;
    if (credentialStep.type !== "select") return;

    setSubmitting(true);
    setError(null);
    setStartedTask(null);

    const chosenTool =
      selectedToolId !== NO_TOOL_VALUE
        ? credentialStep.tools.find((t) => t.id === selectedToolId) ?? null
        : null;

    const credentials: Record<string, string> = {};
    if (manualEmail.trim()) credentials.email = manualEmail.trim();
    if (manualPassword) credentials.password = manualPassword;
    if (verificationCode.trim()) credentials.verificationCode = verificationCode.trim();

    console.debug(
      "[TaskChat] source=task | starting | tool:", chosenTool?.tool?.displayName ?? "none",
      "| hasEmail:", Boolean(credentials.email),
      "| hasCode:", Boolean(credentials.verificationCode),
    );

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/tasks/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: intent,
          sourceButton: "task",
          ...(chosenTool ? { userToolId: chosenTool.id } : {}),
          ...(Object.keys(credentials).length > 0 ? { credentials } : {}),
        }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as
        | StartTaskResponse
        | { ok: false; error?: string };

      if (!response.ok || !("ok" in payload) || payload.ok !== true) {
        throw new Error(
          "error" in payload && payload.error ? payload.error : "Failed to start task.",
        );
      }

      console.debug("[TaskChat] task started | id:", payload.task.id, "| runId:", payload.task.tinyfishRunId);
      setStartedTask(payload.task);
      setCredentialStep({ type: "ready" });
    } catch (submitError) {
      if ((submitError as Error).name === "AbortError") return;
      setError(
        submitError instanceof Error ? submitError.message : "Failed to start task.",
      );
    } finally {
      setSubmitting(false);
      setSafetyConfirmed(false);
      abortRef.current = null;
    }
  }

  const isChecking = credentialStep.type === "checking";
  const showSelect = credentialStep.type === "select";
  const canStart = safetyConfirmed && !submitting && showSelect;

  const selectedTool =
    credentialStep.type === "select" && selectedToolId !== NO_TOOL_VALUE
      ? credentialStep.tools.find((t) => t.id === selectedToolId) ?? null
      : null;

  const needsManualEmail = selectedTool ? !selectedTool.hasSecret : true;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between rounded-2xl border border-white/60 bg-white/65 px-4 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
        <p className="text-sm text-slate-700">
          Browser actions, logins, form fills, and web automation.
        </p>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close task panel"
          className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/70 text-slate-500 transition hover:bg-white/90 hover:text-slate-800"
        >
          <X size={14} />
        </button>
      </div>

      {/* Prompt form */}
      <form
        onSubmit={handleCheckCredentials}
        className="rounded-2xl border border-white/55 bg-white/55 p-3 backdrop-blur-md"
      >
        <label htmlFor="task-chat-input" className="sr-only">
          Task prompt
        </label>
        <textarea
          id="task-chat-input"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (showSelect || credentialStep.type === "ready") resetFlow();
          }}
          placeholder="Example: log into Indeed and check my job applications"
          rows={3}
          className="w-full resize-none rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-300/60"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">
            TinyFish browser automation only.
          </span>
          <button
            type="submit"
            disabled={isChecking || submitting || !prompt.trim()}
            className="rounded-xl border border-orange-300/75 bg-orange-200/60 px-3 py-1.5 text-xs font-semibold text-orange-950 transition hover:bg-orange-200/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isChecking ? "Checking..." : "Check & Confirm Task"}
          </button>
        </div>
      </form>

      {/* Credential selection */}
      {credentialStep.type === "select" ? (
        <div className="space-y-3 rounded-2xl border border-orange-200/70 bg-orange-50/50 px-4 py-3 backdrop-blur-md">

          {/* Tool selector */}
          {credentialStep.tools.length > 0 ? (
            <div>
              <label htmlFor="task-tool-select" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Key size={12} className="text-orange-600" />
                Select saved account
              </label>
              <div className="relative">
                <select
                  id="task-tool-select"
                  value={selectedToolId}
                  onChange={(e) => setSelectedToolId(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-white/70 bg-white/80 px-3 py-2 pr-8 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-300/60"
                >
                  <option value={NO_TOOL_VALUE}>— Enter manually —</option>
                  {credentialStep.tools.map((t) => {
                    const name = t.tool?.displayName ?? t.label ?? t.id;
                    const masked = t.loginIdentifierMasked ? ` · ${t.loginIdentifierMasked}` : "";
                    const badge = t.hasSecret ? "" : " (no credentials saved)";
                    return (
                      <option key={t.id} value={t.id}>
                        {name}{masked}{badge}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>

              {/* Credential status badge */}
              {selectedTool ? (
                selectedTool.hasSecret ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Credentials saved — TinyFish will use them automatically.
                  </p>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
                    <AlertCircle size={11} />
                    No credentials saved for this tool — enter them below.
                  </p>
                )
              ) : null}
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-slate-600">
              <AlertCircle size={12} className="text-amber-600" />
              No saved tools found. Add credentials in the{" "}
              <a href="/tools" className="font-semibold text-orange-700 underline">
                Tools tab
              </a>{" "}
              or enter them below.
            </p>
          )}

          {/* Manual email + password — only shown when no saved secret */}
          {needsManualEmail ? (
            <div className="space-y-2">
              <div>
                <label htmlFor="task-email" className="mb-1 block text-xs font-medium text-slate-700">
                  Email or username
                </label>
                <input
                  id="task-email"
                  type="email"
                  autoComplete="username"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-300/60"
                />
              </div>
              <div>
                <label htmlFor="task-password" className="mb-1 block text-xs font-medium text-slate-700">
                  Password{" "}
                  <span className="font-normal text-slate-500">(used once for this task only)</span>
                </label>
                <input
                  id="task-password"
                  type="password"
                  autoComplete="current-password"
                  value={manualPassword}
                  onChange={(e) => setManualPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-300/60"
                />
              </div>
            </div>
          ) : null}

          {/* Verification code — always optional */}
          <div>
            <label htmlFor="task-vcode" className="mb-1 block text-xs font-medium text-slate-700">
              Verification / 2FA code{" "}
              <span className="font-normal text-slate-500">(leave blank if not required)</span>
            </label>
            <input
              id="task-vcode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              placeholder="e.g. 123456"
              className="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-300/60"
            />
          </div>

          <SafetyConfirmation checked={safetyConfirmed} onChange={setSafetyConfirmed} />
          <StartButton submitting={submitting} canStart={canStart} onClick={handleStartTask} />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200/80 bg-rose-100/55 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {startedTask ? (
        <div className="space-y-2 rounded-2xl border border-white/60 bg-white/65 px-4 py-3 text-sm text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Task Started</p>
          <p className="leading-relaxed">{startedTask.prompt}</p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600">
            <span className="rounded-full border border-white/70 bg-white/70 px-2 py-0.5">
              Status: {formatStatus(startedTask.status)}
            </span>
            {startedTask.tinyfishRunId ? (
              <span className="rounded-full border border-white/70 bg-white/70 px-2 py-0.5">
                Run: {startedTask.tinyfishRunId}
              </span>
            ) : null}
          </div>
          {startedTask.tinyfishRunUrl ? (
            <a
              href={startedTask.tinyfishRunUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs font-semibold text-orange-700 underline"
            >
              View Run
            </a>
          ) : null}
          <p className="text-xs text-slate-500">
            {new Date(startedTask.createdAt).toLocaleString()}
          </p>
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-2xl border border-white/55 bg-white/55 px-3 py-2 backdrop-blur-md">
        <span className="h-2 w-2 rounded-full bg-orange-400/85" />
        <span className="text-sm text-slate-600">Task mode — TinyFish browser automation.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SafetyConfirmation({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-orange-300 accent-orange-500"
      />
      <span className="flex items-center gap-1.5">
        <ShieldCheck size={12} className="shrink-0 text-slate-500" />
        I confirm this task may trigger live browser actions and account interactions.
      </span>
    </label>
  );
}

function StartButton({
  submitting,
  canStart,
  onClick,
}: {
  submitting: boolean;
  canStart: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canStart}
      className="rounded-xl border border-orange-300/80 bg-orange-200/70 px-3 py-1.5 text-xs font-semibold text-orange-950 transition hover:bg-orange-200/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitting ? "Starting Task..." : "Start Task via TinyFish"}
    </button>
  );
}
