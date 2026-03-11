import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from '@/lib/server/auth';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TinyFishEventType =
  | "STARTED"
  | "STREAMING_URL"
  | "PROGRESS"
  | "HEARTBEAT"
  | "COMPLETE";

type ClientEventType =
  | "STARTED"
  | "STREAMING_URL"
  | "PROGRESS"
  | "COMPLETE"
  | "ERROR";

type NormalizedEvent =
  | {
      type: "STARTED";
      runId: string | null;
      message: string;
    }
  | {
      type: "STREAMING_URL";
      streamingUrl: string;
      message: string;
    }
  | {
      type: "PROGRESS";
      message: string;
    }
  | {
      type: "HEARTBEAT";
    }
  | {
      type: "COMPLETE";
      status: "complete" | "failed" | "canceled";
      message: string;
      resultJson: unknown;
      error: string | null;
    };

type ForwardEvent = {
  type: ClientEventType;
  timestamp: string;
  runId?: string;
  streamingUrl?: string;
  message?: string;
  status?: string;
  resultJson?: unknown;
  error?: string;
  summary?: string;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeEventType(
  rawEvent: string | null,
  payload: Record<string, unknown>,
): TinyFishEventType | null {
  const candidateFromPayload =
    firstString(payload, ["event", "type", "kind", "status"]) || null;
  const candidate = (rawEvent || candidateFromPayload || "").toUpperCase().trim();

  if (candidate === "STARTED" || candidate === "START" || candidate === "RUN_STARTED") {
    return "STARTED";
  }
  if (
    candidate === "STREAMING_URL" ||
    candidate === "STREAM_URL" ||
    candidate === "BROWSER_URL" ||
    candidate === "LIVE_URL"
  ) {
    return "STREAMING_URL";
  }
  if (candidate === "PROGRESS" || candidate === "STEP" || candidate === "LOG") {
    return "PROGRESS";
  }
  if (candidate === "HEARTBEAT" || candidate === "PING" || candidate === "KEEPALIVE") {
    return "HEARTBEAT";
  }
  if (
    candidate === "COMPLETE" ||
    candidate === "COMPLETED" ||
    candidate === "DONE" ||
    candidate === "FINISHED" ||
    candidate === "FINAL" ||
    candidate === "SUCCESS" ||
    candidate === "SUCCEEDED" ||
    candidate === "FAILED" ||
    candidate === "ERROR" ||
    candidate === "CANCELED" ||
    candidate === "CANCELLED"
  ) {
    return "COMPLETE";
  }

  const streamingUrl = firstString(payload, [
    "streamingUrl",
    "streaming_url",
    "streamUrl",
    "stream_url",
    "liveUrl",
    "live_url",
  ]);
  if (streamingUrl) return "STREAMING_URL";

  const runId = firstString(payload, ["runId", "run_id"]);
  if (runId && (String(payload.status || "").toLowerCase() === "started" || !candidate)) {
    return "STARTED";
  }

  const completeStatus = (firstString(payload, ["status", "outcome", "result"]) || "").toLowerCase();
  if (
    completeStatus.includes("complete")
    || completeStatus.includes("success")
    || completeStatus.includes("fail")
    || completeStatus.includes("cancel")
    || completeStatus.includes("error")
    || Object.prototype.hasOwnProperty.call(payload, "resultJson")
    || Object.prototype.hasOwnProperty.call(payload, "result_json")
    || Object.prototype.hasOwnProperty.call(payload, "result")
  ) {
    return "COMPLETE";
  }

  const message = firstString(payload, ["message", "purpose", "detail", "step", "summary"]);
  if (message) return "PROGRESS";

  return null;
}

function normalizeEvent(
  rawEvent: string | null,
  rawPayload: Record<string, unknown>,
): NormalizedEvent | null {
  const type = normalizeEventType(rawEvent, rawPayload);
  if (!type) return null;

  if (type === "STARTED") {
    const runId =
      firstString(rawPayload, ["runId", "run_id"]) ??
      (rawEvent && rawEvent.toUpperCase().includes("START")
        ? firstString(rawPayload, ["id"])
        : null);
    return {
      type,
      runId,
      message: "Run started",
    };
  }

  if (type === "STREAMING_URL") {
    const streamingUrl = firstString(rawPayload, [
      "streamingUrl",
      "streaming_url",
      "streamUrl",
      "stream_url",
      "liveUrl",
      "live_url",
      "url",
    ]);
    if (!streamingUrl) return null;

    return {
      type,
      streamingUrl,
      message: "Live preview available",
    };
  }

  if (type === "PROGRESS") {
    const message =
      firstString(rawPayload, ["message", "detail", "step", "summary"]) ||
      "Running";

    return {
      type,
      message,
    };
  }

  if (type === "HEARTBEAT") {
    return { type };
  }

  const outcomeRaw = (firstString(rawPayload, ["outcome", "status", "result"]) || "complete")
    .toLowerCase();
  const status =
    outcomeRaw.includes("fail")
      ? "failed"
      : outcomeRaw.includes("cancel")
        ? "canceled"
        : "complete";
  const summary =
    firstString(rawPayload, ["summary", "message", "detail"]) ||
    (status === "complete" ? "Run complete." : "Run finished with an issue.");
  const error = firstString(rawPayload, ["error", "error_message", "reason"]);
  const resultJson =
    rawPayload.resultJson ??
    rawPayload.result_json ??
    rawPayload.result ??
    null;

  return {
    type,
    status,
    message: summary,
    resultJson,
    error,
  };
}

function parseSseEventBlock(block: string): { event: string | null; payload: Record<string, unknown> | null } {
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
    const payload = toRecord(parsed);
    if (payload) return { event, payload };
    return { event, payload: { message: joined } };
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

function buildStructuredGoal(rawGoal: string): string {
  const base = rawGoal.trim();
  if (!base) return base;

  const normalized = base.toLowerCase();
  if (
    normalized.includes("return json in this shape") &&
    normalized.includes('"status": "success | failed | canceled"')
  ) {
    return base;
  }

  return `${base}

Return JSON in this shape:
{
  "task": "string",
  "status": "success | failed | canceled",
  "vendor": "string | null",
  "plan_name": "string | null",
  "price": "string | null",
  "notes": "string | null"
}

Stop when one of these is true:
- The subscription is completed
- The site asks for final confirmation from the user
- The plan page cannot be found
- A CAPTCHA appears

If the task fails, return:
{
  "success": false,
  "error_type": "timeout | blocked | not_found | auth_required",
  "error_message": "string",
  "partial_results": []
}`;
}

function sseEncode(event: ClientEventType, payload: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function compactMessage(value: string, max = 280): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "TinyFish stream failed.";
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function clientErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return compactMessage(error.message);
  return "TinyFish stream failed.";
}

export async function POST(req: NextRequest) {
  try {
    await requireAuthenticatedUser();
    const body = (await req.json()) as {
      goal?: string;
      url?: string;
      startUrl?: string;
    };

    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    if (!goal) {
      return NextResponse.json(
        { ok: false, error: "Missing TinyFish run goal." },
        { status: 400 },
      );
    }

    const apiKey = process.env.TINYFISH_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "TINYFISH_API_KEY is not configured." },
        { status: 500 },
      );
    }

    const endpoint =
      process.env.TINYFISH_AUTOMATION_RUN_SSE_URL ||
      "https://agent.tinyfish.ai/v1/automation/run-sse";
    const requestedUrl =
      typeof body.url === "string" && body.url.trim()
        ? body.url.trim()
        : typeof body.startUrl === "string" && body.startUrl.trim()
          ? body.startUrl.trim()
        : process.env.TINYFISH_AUTOMATION_START_URL || "https://www.google.com";
    if (!isHttpUrl(requestedUrl)) {
      return NextResponse.json(
        { ok: false, error: "Invalid start URL. Use http or https." },
        { status: 400 },
      );
    }

    const structuredGoal = buildStructuredGoal(goal);
    const encoder = new TextEncoder();
    const abortController = new AbortController();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (event: ClientEventType, payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(sseEncode(event, payload)));
        };
        const emit = (event: ForwardEvent) => {
          const { type, ...rest } = event;
          push(type, rest);
        };

        let emittedTerminal = false;
        let currentRunId: string | null = null;

        try {
          const upstream = await fetch(endpoint, {
            method: "POST",
            headers: {
              "X-API-Key": apiKey,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              url: requestedUrl,
              goal: structuredGoal,
            }),
            cache: "no-store",
            signal: abortController.signal,
          });

          if (!upstream.ok || !upstream.body) {
            const reasonText = compactMessage(await upstream.text(), 220);
            throw new Error(`TinyFish request failed (${upstream.status}): ${reasonText}`);
          }

          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const { blocks, rest } = splitSseBlocks(buffer);
            buffer = rest;
            for (const rawBlock of blocks) {
              if (!rawBlock.trim()) continue;
              try {
                const parsed = parseSseEventBlock(rawBlock);
                if (!parsed.payload) {
                  continue;
                }

                const normalized = normalizeEvent(parsed.event, parsed.payload);
                if (!normalized) {
                  continue;
                }

                if (normalized.type === "HEARTBEAT") {
                  continue;
                }

                if (normalized.type === "STARTED") {
                  if (normalized.runId) currentRunId = normalized.runId;
                  emit({
                    type: "STARTED",
                    runId: currentRunId || undefined,
                    status: "started",
                    message: normalized.message,
                    timestamp: new Date().toISOString(),
                  });
                  continue;
                }

                if (normalized.type === "STREAMING_URL") {
                  emit({
                    type: "STREAMING_URL",
                    runId: currentRunId || undefined,
                    streamingUrl: normalized.streamingUrl,
                    message: normalized.message,
                    timestamp: new Date().toISOString(),
                  });
                  continue;
                }

                if (normalized.type === "PROGRESS") {
                  emit({
                    type: "PROGRESS",
                    runId: currentRunId || undefined,
                    message: normalized.message,
                    timestamp: new Date().toISOString(),
                  });
                  continue;
                }

                emit({
                  type: "COMPLETE",
                  runId: currentRunId || undefined,
                  status: normalized.status,
                  message: normalized.message,
                  summary: normalized.message,
                  resultJson: normalized.resultJson,
                  error: normalized.error || undefined,
                  timestamp: new Date().toISOString(),
                });
                emittedTerminal = true;
              } catch {
                // Do not crash the stream on one malformed SSE block.
              }
            }
          }

          const finalBlock = buffer.trim();
          if (finalBlock) {
            try {
              const parsed = parseSseEventBlock(finalBlock);
              if (parsed.payload) {
                const normalized = normalizeEvent(parsed.event, parsed.payload);
                if (normalized && normalized.type === "COMPLETE") {
                  emit({
                    type: "COMPLETE",
                    runId: currentRunId || undefined,
                    status: normalized.status,
                    message: normalized.message,
                    summary: normalized.message,
                    resultJson: normalized.resultJson,
                    error: normalized.error || undefined,
                    timestamp: new Date().toISOString(),
                  });
                  emittedTerminal = true;
                }
              }
            } catch {
              // Ignore malformed trailing event.
            }
          }

          if (!emittedTerminal) {
            const message = "TinyFish stream closed before a complete event.";
            emit({
              type: "ERROR",
              runId: currentRunId || undefined,
              status: "failed",
              message,
              error: message,
              timestamp: new Date().toISOString(),
            });
            emit({
              type: "COMPLETE",
              runId: currentRunId || undefined,
              status: "failed",
              message,
              summary: message,
              error: message,
              resultJson: null,
              timestamp: new Date().toISOString(),
            });
            emittedTerminal = true;
          }
        } catch (error) {
          const message = clientErrorMessage(error);
          emit({
            type: "ERROR",
            runId: currentRunId || undefined,
            status: "failed",
            message,
            error: message,
            timestamp: new Date().toISOString(),
          });
          emit({
            type: "COMPLETE",
            runId: currentRunId || undefined,
            status: "failed",
            message,
            summary: message,
            error: message,
            resultJson: null,
            timestamp: new Date().toISOString(),
          });
          emittedTerminal = true;
        } finally {
          controller.close();
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "TinyFish run stream failed.",
      },
      { status: 500 },
    );
  }
}
