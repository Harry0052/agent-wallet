import { FormEvent, useRef, useState } from "react";
import { X } from "lucide-react";

type ResearchChatResponse = {
  ok: true;
  answer: string;
  provider: "gemini" | "claude";
  requestType: "research" | "general" | "task";
  classifiedRequestType: "research" | "general" | "task";
  confidence: number;
  usedTinyFish: boolean;
};

interface ResearchChatProps {
  onClose: () => void;
}

export function ResearchChat({ onClose }: ResearchChatProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchChatResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function handleClose() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    setError(null);
    onClose();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    console.debug("[ResearchChat] source=research | prompt:", question);

    try {
      const response = await fetch("/api/ai/research-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question, sourceButton: "research" }),
        signal: controller.signal,
      });

      const body = (await response.json()) as
        | ResearchChatResponse
        | { ok: false; error?: string };

      if (!response.ok || !("ok" in body) || body.ok !== true) {
        throw new Error("Research request failed.");
      }

      console.debug(
        "[ResearchChat] provider:", body.provider,
        "| classified:", body.classifiedRequestType,
        "| confidence:", body.confidence,
        "| usedTinyFish:", body.usedTinyFish,
      );

      setResult({
        ...body,
        answer:
          body.answer?.trim() ||
          "I could not generate a complete answer this time. Please try again.",
      });
    } catch (submitError) {
      if ((submitError as Error).name === "AbortError") return;
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Research request failed.",
      );
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-2xl border border-white/60 bg-white/65 px-4 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
        <p className="text-sm text-slate-700">
          Ask for comparisons, recommendations, or explanations.
        </p>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close research panel"
          className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/70 text-slate-500 transition hover:bg-white/90 hover:text-slate-800"
        >
          <X size={14} />
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-white/55 bg-white/55 p-3 backdrop-blur-md"
      >
        <label htmlFor="research-chat-input" className="sr-only">
          Research prompt
        </label>
        <textarea
          id="research-chat-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Example: best note taking apps under $15"
          rows={3}
          className="w-full resize-none rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-300/60"
        />

        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">
            Fast response with quality fallback.
          </span>
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="rounded-xl border border-emerald-300/75 bg-emerald-200/60 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-200/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Thinking..." : "Ask"}
          </button>
        </div>
      </form>

      {error ? (
        <div className="rounded-2xl border border-rose-200/80 bg-rose-100/55 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-2 rounded-2xl border border-white/60 bg-white/65 px-4 py-3 text-sm text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
          <p className="leading-relaxed">{result.answer}</p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600">
            <span className="rounded-full border border-white/70 bg-white/70 px-2 py-0.5">
              Type: {result.classifiedRequestType}
            </span>
            <span className="rounded-full border border-white/70 bg-white/70 px-2 py-0.5">
              Confidence: {Math.round(result.confidence * 100)}%
            </span>
            <span className="rounded-full border border-emerald-200/70 bg-emerald-50/70 px-2 py-0.5 text-emerald-800">
              TinyFish: blocked
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-2xl border border-white/55 bg-white/55 px-3 py-2 backdrop-blur-md">
        <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
        <span className="text-sm text-slate-600">Research only — no browser automation.</span>
      </div>
    </div>
  );
}
