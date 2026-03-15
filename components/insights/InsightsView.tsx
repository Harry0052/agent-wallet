"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fmt } from "@/lib/utils";
import type { Insight } from "@/lib/types";

export function InsightsView() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load insights");
      const body = (await res.json()) as { insights: Insight[] };
      setInsights(body.insights ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load insights.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = async (id: string) => {
    setDismissing(id);
    try {
      await fetch("/api/insights", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "dismiss" }),
      });
      setInsights((prev) => prev.filter((i) => i.id !== id));
    } catch {
      // silent
    } finally {
      setDismissing(null);
    }
  };

  const active = insights.filter((i) => i.status === "active").slice(0, 6);

  return (
    <div className="aw-page">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--aw-text)]">Insights</h1>

      {error ? (
        <div className="mt-4 rounded-xl border border-[var(--aw-danger)]/20 bg-[var(--aw-danger)]/10 px-4 py-3 text-sm text-[var(--aw-danger)]">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
        </div>
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <p className="max-w-xs text-sm leading-relaxed text-[var(--aw-text-muted)]">
            Once your accounts sync, we&apos;ll highlight what needs attention. You can also add manual transactions and recurring items now.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/connect"
              className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold"
            >
              Connect an account
            </Link>
            <Link
              href="/transactions"
              className="aw-button-primary inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold"
            >
              Add transaction manually
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {active.map((insight) => (
            <article
              key={insight.id}
              className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--aw-text)]">{insight.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--aw-text-muted)]">
                    {insight.summary}
                  </p>
                  {insight.amountImpact ? (
                    <p className="mt-1.5 text-xs font-semibold text-[var(--aw-text)]">
                      {fmt(insight.amountImpact)}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void dismiss(insight.id);
                  }}
                  disabled={dismissing === insight.id}
                  className="shrink-0 rounded-lg bg-[var(--aw-surface-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--aw-text-muted)] transition hover:bg-[var(--aw-border)]"
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
