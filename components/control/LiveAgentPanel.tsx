"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Radio } from "lucide-react";
import type { AutomationActionRecord } from "@/lib/types";
import { acpTheme, acpCard, acpLabel } from "./controlStyles";

interface LiveAgentPanelProps {
  actionId: string | null;
  action: AutomationActionRecord | null;
}

type PanelState = "idle" | "connecting" | "running" | "completed" | "failed" | "blocked" | "needs_review";

function derivePanelState(action: AutomationActionRecord | null): PanelState {
  if (!action) return "idle";
  switch (action.status) {
    case "attempted":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "pending_confirm":
      return "needs_review";
    default:
      return "idle";
  }
}

interface SSEState {
  currentStep: string | null;
  progress: number;
  finalResult: string | null;
  sseStatus: "idle" | "connecting" | "streaming" | "done" | "error";
}

const INITIAL_SSE_STATE: SSEState = {
  currentStep: null,
  progress: 0,
  finalResult: null,
  sseStatus: "idle",
};

export function LiveAgentPanel({ actionId, action }: LiveAgentPanelProps) {
  const panelState = derivePanelState(action);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sse, setSSE] = useState<SSEState>(INITIAL_SSE_STATE);
  const esRef = useRef<EventSource | null>(null);

  // SSE connection when actionId is set
  useEffect(() => {
    if (!actionId) {
      setSSE(INITIAL_SSE_STATE);
      return;
    }

    // Clean up any prior connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setSSE({ ...INITIAL_SSE_STATE, sseStatus: "connecting" });

    const params = new URLSearchParams({ actionId });
    const es = new EventSource(`/api/tasks/stream?${params.toString()}`);
    esRef.current = es;

    es.onopen = () => {
      setSSE((prev) => ({ ...prev, sseStatus: "streaming" }));
    };

    es.addEventListener("step", (event) => {
      try {
        const data = JSON.parse(event.data) as { label?: string; progress?: number };
        setSSE((prev) => ({
          ...prev,
          currentStep: data.label ?? prev.currentStep,
          progress: typeof data.progress === "number" ? data.progress : prev.progress,
        }));
      } catch {
        // Ignore malformed events
      }
    });

    es.addEventListener("completed", (event) => {
      try {
        const data = JSON.parse(event.data) as { message?: string; evidence?: unknown[] };
        setSSE({
          currentStep: null,
          progress: 100,
          finalResult: data.message ?? "Action completed successfully.",
          sseStatus: "done",
        });
      } catch {
        setSSE((prev) => ({ ...prev, sseStatus: "done", progress: 100 }));
      }
      es.close();
    });

    es.addEventListener("failed", (event) => {
      try {
        const data = JSON.parse(event.data) as { message?: string };
        setSSE({
          currentStep: null,
          progress: 0,
          finalResult: data.message ?? "Action failed.",
          sseStatus: "error",
        });
      } catch {
        setSSE((prev) => ({ ...prev, sseStatus: "error" }));
      }
      es.close();
    });

    es.addEventListener("blocked", (event) => {
      try {
        const data = JSON.parse(event.data) as { message?: string };
        setSSE({
          currentStep: null,
          progress: 0,
          finalResult: data.message ?? "Action blocked.",
          sseStatus: "error",
        });
      } catch {
        setSSE((prev) => ({ ...prev, sseStatus: "error" }));
      }
      es.close();
    });

    es.onerror = () => {
      setSSE((prev) => ({
        ...prev,
        sseStatus: prev.sseStatus === "done" ? "done" : "error",
      }));
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [actionId]);

  // Elapsed timer for running state
  useEffect(() => {
    if (panelState === "running") {
      setElapsed(0);
      intervalRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [panelState]);

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <aside data-testid="live-agent-panel" style={{ position: "sticky", top: 32 }}>
      <p style={{ ...acpLabel, marginBottom: 12 }}>Live Agent</p>
      <div
        style={{
          ...acpCard,
          padding: "20px",
          minHeight: 200,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Idle */}
        {panelState === "idle" && (
          <div
            data-testid="live-panel-idle"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: acpTheme.textLight,
                animation: "pulse 2s ease-in-out infinite",
              }}
            />
            <p
              style={{
                fontSize: "0.82rem",
                color: acpTheme.textMuted,
                fontFamily: acpTheme.fontFamily,
              }}
            >
              No active agent task
            </p>
          </div>
        )}

        {/* Connecting */}
        {panelState === "connecting" && (
          <div
            data-testid="live-panel-connecting"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <Loader2 size={20} style={{ color: acpTheme.primary, animation: "spin 1s linear infinite" }} />
            <p
              style={{
                fontSize: "0.82rem",
                color: acpTheme.textMuted,
                fontFamily: acpTheme.fontFamily,
              }}
            >
              Connecting to agent...
            </p>
          </div>
        )}

        {/* Running */}
        {panelState === "running" && action && (
          <div data-testid="live-panel-running">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Radio size={16} style={{ color: acpTheme.primary }} />
              <span
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: acpTheme.primary,
                  fontFamily: acpTheme.fontFamily,
                }}
              >
                Running
              </span>
            </div>

            <p
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: acpTheme.text,
                fontFamily: acpTheme.fontFamily,
                marginBottom: 4,
              }}
            >
              {action.title}
            </p>

            {/* Current step from SSE */}
            <p
              style={{
                fontSize: "0.78rem",
                color: acpTheme.textMuted,
                fontFamily: acpTheme.fontFamily,
                marginBottom: 12,
              }}
            >
              {sse.currentStep ?? "Executing action..."}
            </p>

            {/* Progress bar driven by SSE */}
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: acpTheme.borderLight,
                overflow: "hidden",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${sse.progress > 0 ? sse.progress : 15}%`,
                  borderRadius: 2,
                  background: acpTheme.primary,
                  transition: "width 0.5s ease",
                }}
              />
            </div>

            {/* Elapsed */}
            <p
              style={{
                fontSize: "0.75rem",
                color: acpTheme.textLight,
                fontFamily: acpTheme.fontFamily,
              }}
            >
              Elapsed: {formatElapsed(elapsed)}
            </p>
          </div>
        )}

        {/* Completed */}
        {panelState === "completed" && action && (
          <div data-testid="live-panel-completed">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <CheckCircle2 size={18} style={{ color: acpTheme.success }} />
              <span
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: acpTheme.success,
                  fontFamily: acpTheme.fontFamily,
                }}
              >
                Completed
              </span>
            </div>
            <p
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: acpTheme.text,
                fontFamily: acpTheme.fontFamily,
                marginBottom: 6,
              }}
            >
              {action.title}
            </p>
            <p
              style={{
                fontSize: "0.78rem",
                color: acpTheme.textMuted,
                fontFamily: acpTheme.fontFamily,
                lineHeight: 1.55,
              }}
            >
              {sse.finalResult
                ? sse.finalResult
                : `Action completed successfully.${action.explainability.summary ? ` ${action.explainability.summary}` : ""}`}
            </p>
          </div>
        )}

        {/* Failed */}
        {panelState === "failed" && action && (
          <div data-testid="live-panel-failed">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <AlertCircle size={18} style={{ color: acpTheme.danger }} />
              <span
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: acpTheme.danger,
                  fontFamily: acpTheme.fontFamily,
                }}
              >
                Failed
              </span>
            </div>
            <p
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: acpTheme.text,
                fontFamily: acpTheme.fontFamily,
                marginBottom: 6,
              }}
            >
              {action.title}
            </p>
            <p
              style={{
                fontSize: "0.78rem",
                color: acpTheme.textMuted,
                fontFamily: acpTheme.fontFamily,
                lineHeight: 1.55,
              }}
            >
              {action.lastError ?? "The action could not be completed. You can try again."}
            </p>
          </div>
        )}

        {/* Blocked / Needs Review */}
        {panelState === "needs_review" && action && (
          <div data-testid="live-panel-needs-review">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <AlertCircle size={18} style={{ color: acpTheme.warning }} />
              <span
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: acpTheme.warning,
                  fontFamily: acpTheme.fontFamily,
                }}
              >
                Needs Review
              </span>
            </div>
            <p
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: acpTheme.text,
                fontFamily: acpTheme.fontFamily,
                marginBottom: 6,
              }}
            >
              {action.title}
            </p>
            <p
              style={{
                fontSize: "0.78rem",
                color: acpTheme.textMuted,
                fontFamily: acpTheme.fontFamily,
                lineHeight: 1.55,
              }}
            >
              This action requires your confirmation before proceeding.
            </p>
          </div>
        )}
      </div>

      {/* Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </aside>
  );
}
