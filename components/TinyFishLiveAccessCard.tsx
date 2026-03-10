"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Eye, Loader2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { AgentLogData, EvidenceData, LiveRunResult } from "@/lib/types";
import { domainFromUrl } from "@/lib/utils";

function isUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 8) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function pullRecommendationUrls(raw: Record<string, unknown> | null): string[] {
  if (!raw) return [];
  const urls: string[] = [];
  const winner = asRecord(raw.winner);
  const purchasePrep = asRecord(raw.purchasePrep);

  if (isUrl(purchasePrep?.checkoutUrl)) urls.push(purchasePrep.checkoutUrl);
  if (Array.isArray(purchasePrep?.proofUrls)) {
    for (const proof of purchasePrep.proofUrls) {
      if (isUrl(proof)) urls.push(proof);
    }
  }
  if (isUrl(winner?.pricingPageUrl)) urls.push(winner.pricingPageUrl);
  if (Array.isArray(raw.evidenceLinks)) {
    for (const link of raw.evidenceLinks) {
      if (isUrl(link)) urls.push(link);
    }
  }
  return urls;
}

export function collectLiveUrls(params: {
  activeTaskSteps: Array<{ url?: string }>;
  messages: Array<{ type: string; data?: unknown }>;
  recommendation: Record<string, unknown> | null;
}): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const push = (candidate: unknown) => {
    if (!isUrl(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    urls.push(candidate);
  };

  for (let i = params.activeTaskSteps.length - 1; i >= 0; i -= 1) {
    push(params.activeTaskSteps[i].url);
  }

  for (let i = params.messages.length - 1; i >= 0; i -= 1) {
    const msg = params.messages[i];
    if (msg.type === "evidence" && msg.data) {
      const data = msg.data as EvidenceData;
      if (Array.isArray(data.findings)) {
        for (const finding of data.findings) push(finding.sourceUrl);
      }
      continue;
    }
    if (msg.type === "agent-log" && msg.data) {
      const data = msg.data as AgentLogData;
      if (Array.isArray(data.steps)) {
        for (const step of data.steps) push(step.url);
      }
    }
  }

  for (const url of pullRecommendationUrls(params.recommendation)) {
    push(url);
  }

  return urls;
}

export function useLiveUrls() {
  const { activeTask, messages, latestProcurementTask } = useApp();
  return useMemo(
    () =>
      collectLiveUrls({
        activeTaskSteps: activeTask?.steps || [],
        messages,
        recommendation: asRecord(latestProcurementTask?.recommendation),
      }),
    [activeTask?.steps, latestProcurementTask?.recommendation, messages],
  );
}

type LiveEventType =
  | "STARTED"
  | "STREAMING_URL"
  | "PROGRESS"
  | "HEARTBEAT"
  | "COMPLETE"
  | "ERROR";

type TimelineEntry = {
  id: string;
  type: "Started" | "Running" | "Complete" | "Failed" | "Canceled";
  message: string;
  purpose?: string;
  timestamp: string;
  raw?: unknown;
};

function parseSseBlock(block: string): { event: string | null; payload: Record<string, unknown> | null } {
  const lines = block.split(/\r?\n/);
  let event: string | null = null;
  const dataParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice(6).trim() || null;
      continue;
    }
    if (trimmed.startsWith("data:")) {
      dataParts.push(trimmed.slice(5).trim());
    }
  }

  if (dataParts.length === 0) return { event, payload: null };

  const joined = dataParts.join("\n").trim();
  if (!joined || joined === "[DONE]") return { event, payload: null };

  try {
    const parsed = JSON.parse(joined) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { event, payload: { message: joined } };
    }
    return { event, payload: parsed as Record<string, unknown> };
  } catch {
    return { event, payload: { message: joined } };
  }
}

function splitSseBlocks(
  source: string,
): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const separator = source.slice(cursor).match(/\r?\n\r?\n/);
    if (!separator || separator.index === undefined) break;
    const index = cursor + separator.index;
    blocks.push(source.slice(cursor, index));
    cursor = index + separator[0].length;
  }

  return { blocks, rest: source.slice(cursor) };
}

function statusLabel(
  status: string,
  hasPreview: boolean,
): "Run started" | "Running" | "Live preview available" | "Complete" | "Failed" | "No live run" {
  if (status === "started") return "Run started";
  if (status === "running") return hasPreview ? "Live preview available" : "Running";
  if (status === "complete") return "Complete";
  if (status === "failed" || status === "canceled") return "Failed";
  return "No live run";
}

function statusState(status: string): "live" | "ok" | "alert" {
  if (status === "failed" || status === "canceled") return "alert";
  if (status === "started" || status === "running") return "live";
  return "ok";
}

function timelineLabel(label: string): "Run started" | "Running" | "Complete" | "Failed" {
  if (label === "Started") return "Run started";
  if (label === "Complete") return "Complete";
  if (label === "Failed" || label === "Canceled") return "Failed";
  return "Running";
}

function timelineMarkerClass(label: string): string {
  if (label === "Complete") return "bg-[var(--aw-success)]";
  if (label === "Failed" || label === "Canceled") return "bg-[var(--aw-danger)]";
  if (label === "Started") return "bg-[var(--aw-primary)]";
  return "bg-[var(--aw-primary)]";
}

function summarizeResult(result: unknown): Array<{ key: string; value: string }> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const entries = Object.entries(result as Record<string, unknown>);
  const rows: Array<{ key: string; value: string }> = [];

  for (const [key, value] of entries) {
    if (rows.length >= 8) break;
    if (value === null || typeof value === "undefined") continue;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      rows.push({ key, value: String(value) });
      continue;
    }

    if (Array.isArray(value)) {
      const scalarValues = value
        .filter((item) => ["string", "number", "boolean"].includes(typeof item))
        .slice(0, 5)
        .map(String);
      if (scalarValues.length > 0) {
        rows.push({ key, value: scalarValues.join(", ") });
      }
    }
  }

  return rows;
}

function completePayloadFromRecord(payload: Record<string, unknown>): LiveRunResult {
  const rawStatus =
    typeof payload.status === "string" ? payload.status.toLowerCase() : "complete";
  const status: LiveRunResult["status"] = rawStatus.includes("fail")
    ? "failed"
    : rawStatus.includes("cancel")
      ? "canceled"
      : "complete";
  const summary =
    (typeof payload.summary === "string" && payload.summary) ||
    (typeof payload.message === "string" && payload.message) ||
    (status === "complete" ? "No result yet" : "Run failed");

  return {
    status,
    summary,
    resultJson:
      payload.resultJson ??
      payload.result_json ??
      payload.result ??
      null,
    error: typeof payload.error === "string" ? payload.error : undefined,
    raw: payload.raw || payload,
  };
}

export function TinyFishLiveAccessCard() {
  const {
    activeTask,
    latestProcurementTask,
    liveRun,
    setLiveRunState,
    appendLiveRunEvent,
    resetLiveRunState,
  } = useApp();
  const liveUrls = useLiveUrls();

  const [isInlineOpen, setIsInlineOpen] = useState(false);
  const [isOperatorViewOpen, setIsOperatorViewOpen] = useState(false);

  const [isStreaming, setIsStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const derivedGoal =
    latestProcurementTask?.goal?.trim() || activeTask?.intent?.trim() || "";

  const startUrl = liveUrls[0] || null;
  const previewUrl = liveRun.streamingUrl;
  const previewDomain = domainFromUrl(previewUrl || undefined);

  useEffect(() => {
    if (!previewUrl) {
      setIsInlineOpen(false);
      setIsOperatorViewOpen(false);
    }
  }, [previewUrl]);

  useEffect(() => {
    if (!isOperatorViewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOperatorViewOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOperatorViewOpen]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const appendTimeline = useCallback((entry: Omit<TimelineEntry, "id" | "timestamp">) => {
    appendLiveRunEvent({
      type:
        entry.type === "Started"
          ? "STARTED"
          : entry.type === "Running"
            ? "PROGRESS"
            : "COMPLETE",
      label: entry.type,
      message: entry.message,
      purpose: entry.purpose,
      raw: entry.raw,
    });
  }, [appendLiveRunEvent]);

  const consumeLiveEvent = useCallback((eventType: string, payload: Record<string, unknown>) => {
    const upper = eventType.toUpperCase() as LiveEventType;

    if (upper === "STARTED") {
      const incomingRunId = typeof payload.runId === "string" ? payload.runId : null;
      if (incomingRunId) setLiveRunState({ runId: incomingRunId });
      setLiveRunState({ status: "started", error: null });
      appendTimeline({
        type: "Started",
        message: "Run started",
        raw: payload.raw || payload,
      });
      return;
    }

    if (upper === "STREAMING_URL") {
      const url =
        typeof payload.streamingUrl === "string"
          ? payload.streamingUrl
          : typeof payload.url === "string"
            ? payload.url
            : null;
      if (url) {
        setLiveRunState({ streamingUrl: url });
        appendTimeline({
          type: "Running",
          message: "Live preview available",
          raw: payload.raw || payload,
        });
      }
      setLiveRunState({ status: "running" });
      return;
    }

    if (upper === "PROGRESS") {
      const message =
        (typeof payload.message === "string" && payload.message) ||
        "Running";
      const purpose =
        typeof payload.purpose === "string" && payload.purpose
          ? payload.purpose
          : undefined;
      setLiveRunState({ status: "running" });
      appendTimeline({
        type: "Running",
        message,
        purpose,
        raw: payload.raw || payload,
      });
      return;
    }

    if (upper === "HEARTBEAT") {
      return;
    }

    if (upper === "ERROR") {
      const message =
        (typeof payload.error === "string" && payload.error) ||
        (typeof payload.message === "string" && payload.message) ||
        "TinyFish stream failed.";
      setLiveRunState({
        status: "failed",
        error: message,
      });
      appendTimeline({
        type: "Failed",
        message,
        raw: payload.raw || payload,
      });
      return;
    }

    if (upper === "COMPLETE") {
      const normalized = completePayloadFromRecord(payload);
      setLiveRunState({
        result: normalized,
        status: normalized.status,
        error: normalized.status === "failed" ? normalized.error || normalized.summary : null,
      });

      if (normalized.status === "failed") {
        appendTimeline({
          type: "Failed",
          message: normalized.summary,
          raw: normalized.raw,
        });
      } else if (normalized.status === "canceled") {
        appendTimeline({
          type: "Canceled",
          message: normalized.summary,
          raw: normalized.raw,
        });
      } else {
        appendTimeline({
          type: "Complete",
          message: normalized.summary,
          raw: normalized.raw,
        });
      }
    }
  }, [appendTimeline, setLiveRunState]);

  const startLiveRun = useCallback(async () => {
    if (isStreaming) return;
    if (!derivedGoal) {
      setLiveRunState({ error: "No active task goal is available yet." });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    resetLiveRunState();
    setLiveRunState({
      status: "started",
      error: null,
    });

    try {
      const response = await fetch("/api/tinyfish/live-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: derivedGoal,
          startUrl,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const fallback = "Failed to start TinyFish run.";
        let message = fallback;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Preserve fallback message if response is not JSON.
        }
        throw new Error(message);
      }

      if (!response.body) {
        throw new Error("TinyFish stream returned no body.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedComplete = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { blocks, rest } = splitSseBlocks(buffer);
        buffer = rest;
        for (const block of blocks) {
          const parsed = parseSseBlock(block);
          const eventType =
            parsed.event ||
            (parsed.payload && typeof parsed.payload.type === "string"
              ? parsed.payload.type
              : null);
          if (eventType && parsed.payload) {
            consumeLiveEvent(eventType, parsed.payload);
            if (eventType.toUpperCase() === "COMPLETE") {
              receivedComplete = true;
            }
          }
        }
      }

      const finalBlock = buffer.trim();
      if (finalBlock) {
        const parsed = parseSseBlock(finalBlock);
        const eventType =
          parsed.event ||
          (parsed.payload && typeof parsed.payload.type === "string"
            ? parsed.payload.type
            : null);
        if (eventType && parsed.payload) {
          consumeLiveEvent(eventType, parsed.payload);
          if (eventType.toUpperCase() === "COMPLETE") {
            receivedComplete = true;
          }
        }
      }

      if (!receivedComplete) {
        const incomplete: LiveRunResult = {
          status: "failed",
          summary: "No result yet",
          error: "Waiting for real activity",
        };
        setLiveRunState({
          result: incomplete,
          status: "failed",
          error: incomplete.error,
        });
        appendTimeline({
          type: "Failed",
          message: incomplete.summary,
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        const canceled: LiveRunResult = {
          status: "canceled",
          summary: "Run canceled.",
        };
        setLiveRunState({
          result: canceled,
          status: "canceled",
          error: null,
        });
        appendTimeline({
          type: "Canceled",
          message: canceled.summary,
        });
      } else {
        const message =
          error instanceof Error ? error.message : "TinyFish stream failed.";
        setLiveRunState({
          error: message,
          result: {
            status: "failed",
            summary: message,
            error: message,
          },
          status: "failed",
        });
        appendTimeline({
          type: "Failed",
          message,
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [
    appendTimeline,
    consumeLiveEvent,
    derivedGoal,
    isStreaming,
    startUrl,
    resetLiveRunState,
    setLiveRunState,
  ]);

  const cancelLiveRun = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
  }, []);

  const openLiveSession = useCallback(() => {
    if (!previewUrl) return;
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  }, [previewUrl]);

  const runStatus = liveRun.status;
  const runId = liveRun.runId;
  const timeline = liveRun.events;
  const completePayload = liveRun.result;
  const combinedError = liveRun.error || completePayload?.error || null;
  const resultSummaryRows = summarizeResult(completePayload?.resultJson);

  const runIsActive =
    isStreaming || runStatus === "started" || runStatus === "running";

  return (
    <>
      <section className="aw-surface-elevated p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="aw-kicker">Tasks</p>
            <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
              Live Run
            </h3>
            <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
              Real-time TinyFish activity
            </p>
          </div>
          <span className="aw-status-chip" data-state={statusState(runStatus)}>
            {statusLabel(runStatus, Boolean(previewUrl))}
          </span>
        </div>

        {runStatus === "idle" && !completePayload ? (
          <div className="aw-empty-state mt-4">
            <p className="text-sm font-medium text-[var(--aw-text-soft)]">
              No live run
            </p>
            <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
              Start a task to see real activity here.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void startLiveRun();
                }}
                disabled={!derivedGoal || isStreaming}
                className="aw-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isStreaming ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Starting
                  </>
                ) : (
                  "Start Live Run"
                )}
              </button>
              {!derivedGoal && (
                <p className="text-[11px] text-[var(--aw-text-muted)]">
                  No active task goal found yet.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <section className="rounded-2xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.09em] text-[var(--aw-text-muted)]">
                Current Run Status
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-[var(--aw-text-soft)]">
                <span className="inline-flex items-center gap-1.5">
                  {runIsActive ? <span className="aw-dot-live" /> : <span className="aw-dot-idle" />}
                  {statusLabel(runStatus, Boolean(previewUrl))}
                </span>
                {runId && (
                  <span className="rounded-full border border-[var(--aw-border)] bg-white px-2 py-0.5 text-[11px] text-[var(--aw-text-muted)]">
                    Run ID: {runId}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void startLiveRun();
                  }}
                  disabled={isStreaming}
                  className="aw-button-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isStreaming ? "Running" : "Start New Run"}
                </button>
                <button
                  type="button"
                  onClick={cancelLiveRun}
                  disabled={!runIsActive}
                  className="aw-button-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Cancel Run
                </button>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <section className="rounded-2xl border border-[var(--aw-border)] bg-white">
                <div className="border-b border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.09em] text-[var(--aw-text-muted)]">
                    Event Timeline
                  </p>
                </div>
                {timeline.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-[var(--aw-text-muted)]">
                    Waiting for real activity
                  </p>
                ) : (
                  <div className="aw-scroll max-h-72 space-y-2 overflow-y-auto px-3 py-3">
                    {timeline.map((entry) => (
                      <article
                        key={entry.id}
                        className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${timelineMarkerClass(entry.label)}`} />
                            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                              {timelineLabel(entry.label)}
                            </p>
                          </div>
                          <p className="text-[10px] text-[var(--aw-text-muted)]">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                        <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                          {entry.message}
                        </p>
                        {entry.purpose && (
                          <p className="mt-0.5 text-[11px] text-[var(--aw-text-muted)]">
                            {entry.purpose}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="overflow-hidden rounded-2xl border border-[var(--aw-border)] bg-white">
                <div className="flex items-center justify-between gap-2 border-b border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.09em] text-[var(--aw-text-muted)]">
                    Live Browser Preview
                  </p>
                  <button
                    type="button"
                    onClick={openLiveSession}
                    disabled={!previewUrl}
                    className="aw-button-secondary px-2.5 py-1 text-[10px] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Open In New Tab
                  </button>
                </div>

                {previewUrl ? (
                  <>
                    <div className="px-3 py-2.5">
                      <p className="text-sm text-[var(--aw-text-soft)]">
                        {previewDomain || "Live preview URL"}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-[var(--aw-primary)]">
                        {previewUrl}
                      </p>
                    </div>
                    <div className="h-[19rem] border-t border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] md:h-[23rem]">
                      <iframe
                        src={previewUrl}
                        title="TinyFish Live Run Preview"
                        className="h-full w-full border-0"
                        loading="lazy"
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-1 px-3 py-4 text-sm text-[var(--aw-text-muted)]">
                    <p>No live browser preview yet.</p>
                    <p className="text-xs">Waiting for a live preview URL from TinyFish.</p>
                  </div>
                )}
              </section>
            </div>

            {completePayload && (
              <section className="rounded-2xl border border-[var(--aw-border)] bg-white px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.09em] text-[var(--aw-text-muted)]">
                  Final Result Summary
                </p>
                {completePayload.status === "failed" ? (
                  <>
                    <p className="mt-1 text-sm font-semibold text-[var(--aw-danger)]">
                      Run failed
                    </p>
                    <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                      {combinedError || completePayload.summary}
                    </p>
                  </>
                ) : completePayload.status === "canceled" ? (
                  <>
                    <p className="mt-1 text-sm font-semibold text-[var(--aw-danger)]">
                      Failed
                    </p>
                    <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                      {completePayload.summary}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm font-semibold text-[var(--aw-success)]">
                      Complete
                    </p>
                    <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                      {completePayload.summary}
                    </p>
                  </>
                )}

                {resultSummaryRows.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {resultSummaryRows.map((row) => (
                      <div
                        key={row.key}
                        className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2"
                      >
                        <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                          {row.key.replace(/_/g, " ")}
                        </p>
                        <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                          {row.value}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {completePayload.status === "complete" && !completePayload.resultJson && (
                  <div className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
                    <p className="text-sm text-[var(--aw-text-muted)]">
                      No result yet
                    </p>
                    <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                      Waiting for real activity
                    </p>
                  </div>
                )}

                {(completePayload.raw || timeline.some((entry) => Boolean(entry.raw))) && (
                  <details className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--aw-text-soft)]">
                      Details
                    </summary>
                    <pre className="aw-scroll mt-2 max-h-40 overflow-auto text-[11px] text-[var(--aw-text-muted)]">
{JSON.stringify(
  {
    runId,
    status: runStatus,
    resultJson: completePayload.resultJson || null,
    complete: completePayload.raw || completePayload,
    lastEventRaw: timeline.find((entry) => entry.raw)?.raw || null,
  },
  null,
  2,
)}
                    </pre>
                  </details>
                )}
              </section>
            )}
          </div>
        )}
      </section>

      {isOperatorViewOpen && previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.24)] p-3 backdrop-blur-[2px] md:p-6">
          <section className="aw-surface-elevated animate-sheet-rise flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--aw-border)] px-4 py-3 md:px-5">
              <div>
                <p className="aw-kicker">Live Run</p>
                <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Browser View
                </h3>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                  {previewDomain || previewUrl}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="aw-status-chip"
                  data-state={statusState(runStatus)}
                >
                  {statusLabel(runStatus, Boolean(previewUrl))}
                </span>
                <button
                  onClick={openLiveSession}
                  className="aw-button-secondary px-3 py-1.5 text-xs"
                >
                  Open In New Tab
                </button>
                <button
                  onClick={() => setIsOperatorViewOpen(false)}
                  className="aw-button-secondary px-3 py-1.5 text-xs"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-[var(--aw-surface-subtle)]">
              <iframe
                src={previewUrl}
                title="TinyFish Live Operator View"
                className="h-full w-full border-0"
                loading="lazy"
              />
            </div>
          </section>
        </div>
      )}

      {previewUrl && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={openLiveSession}
            className="aw-button-primary inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs"
          >
            Launch Live Session
            <ArrowUpRight size={13} />
          </button>
          <button
            type="button"
            onClick={() => setIsOperatorViewOpen(true)}
            className="aw-button-secondary inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs"
          >
            <Eye size={13} />
            Open Operator View
          </button>

          <button
            type="button"
            onClick={() => setIsInlineOpen((prev) => !prev)}
            className="aw-button-secondary px-3 py-2 text-xs"
          >
            {isInlineOpen ? "Hide Inline Session" : "Show Inline Session"}
          </button>
        </div>
      )}

      {isInlineOpen && previewUrl && (
        <section className="aw-surface-elevated animate-sheet-rise mt-3 overflow-hidden p-0">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
              Inline Live Session
            </p>
            <button
              onClick={openLiveSession}
              className="aw-button-secondary px-2.5 py-1 text-[10px]"
            >
              Open In New Tab
            </button>
          </div>
          <div className="h-[18rem] bg-[var(--aw-surface-subtle)] md:h-[21rem]">
            <iframe
              src={previewUrl}
              title="TinyFish Live Inline Session"
              className="h-full w-full border-0"
              loading="lazy"
            />
          </div>
          <p className="border-t border-[var(--aw-border)] px-3 py-2 text-[10px] text-[var(--aw-text-muted)]">
            If embedding is blocked by the target site, open in a new tab.
          </p>
        </section>
      )}

    </>
  );
}
