"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Agent Wallet] Unhandled error:", error.message, error.digest);
    Sentry.captureException(error);
  }, [error]);

  const isDbError = /pool|connection|timeout|maxclient|ECONNREFUSED/i.test(error.message);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <h2 className="text-xl font-semibold text-[var(--aw-text,#111)]">
          {isDbError ? "Agent Wallet is temporarily busy" : "Something went wrong"}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--aw-text-muted,#6B5B4B)]">
          {isDbError
            ? "We're experiencing high traffic right now. Please try again in a moment."
            : "An unexpected error occurred. Please try refreshing the page."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-full px-6 text-sm font-semibold transition"
          style={{
            background: "var(--aw-primary, #FDBA74)",
            color: "var(--aw-text, #111)",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
