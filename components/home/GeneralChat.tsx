import { FormEvent, useRef, useState } from "react";
import { X } from "lucide-react";

type GeneralChatRoute = {
  label: string;
  href: string;
  description: string;
};

type GeneralChatResponse = {
  ok: true;
  answer: string;
  classifiedRequestType: "research" | "general" | "task";
  suggestedRoutes: GeneralChatRoute[];
};

interface GeneralChatProps {
  onClose: () => void;
}

export function GeneralChat({ onClose }: GeneralChatProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneralChatResponse | null>(null);
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

    console.debug("[GeneralChat] source=general | prompt:", question);

    try {
      const response = await fetch("/api/ai/general-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question, sourceButton: "general" }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as
        | GeneralChatResponse
        | { ok: false; error?: string };

      if (!response.ok || !("ok" in payload) || payload.ok !== true) {
        const message =
          "error" in payload && payload.error
            ? payload.error
            : "General help request failed.";
        throw new Error(message);
      }

      console.debug(
        "[GeneralChat] classified:", payload.classifiedRequestType,
        "| routes:", payload.suggestedRoutes.length,
      );

      setResult(payload);
    } catch (submitError) {
      if ((submitError as Error).name === "AbortError") return;
      setError(
        submitError instanceof Error
          ? submitError.message
          : "General help request failed.",
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
          Ask about your wallet, account, or platform features.
        </p>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close general panel"
          className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/70 text-slate-500 transition hover:bg-white/90 hover:text-slate-800"
        >
          <X size={14} />
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-white/55 bg-white/55 p-3 backdrop-blur-md"
      >
        <label htmlFor="general-chat-input" className="sr-only">
          General help prompt
        </label>
        <textarea
          id="general-chat-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Example: how do I connect my card?"
          rows={3}
          className="w-full resize-none rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-300/60"
        />

        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">
            Account help and navigation support.
          </span>
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="rounded-xl border border-sky-300/75 bg-sky-200/60 px-3 py-1.5 text-xs font-semibold text-sky-950 transition hover:bg-sky-200/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Checking..." : "Ask"}
          </button>
        </div>
      </form>

      {error ? (
        <div className="rounded-2xl border border-rose-200/80 bg-rose-100/55 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3 rounded-2xl border border-white/60 bg-white/65 px-4 py-3 text-sm text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
          <p className="leading-relaxed">{result.answer}</p>
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
            <span className="rounded-full border border-white/70 bg-white/70 px-2 py-0.5">
              Type: {result.classifiedRequestType}
            </span>
          </div>

          {result.suggestedRoutes.length > 0 ? (
            <div className="space-y-2">
              {result.suggestedRoutes.map((route) => (
                <a
                  key={route.href}
                  href={route.href}
                  className="block rounded-xl border border-white/70 bg-white/70 px-3 py-2 transition hover:border-sky-300/70 hover:bg-white/85"
                >
                  <p className="text-xs font-semibold text-slate-800">
                    {route.label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-600">
                    {route.description}
                  </p>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-2xl border border-white/55 bg-white/55 px-3 py-2 backdrop-blur-md">
        <span className="h-2 w-2 rounded-full bg-sky-400/80" />
        <span className="text-sm text-slate-600">General help is live.</span>
      </div>
    </div>
  );
}
