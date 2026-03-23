"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Calico/App] Error:", error.message, error.digest);
  }, [error]);

  const isDbError = /pool|connection|timeout|maxclient|ECONNREFUSED|session/i.test(error.message);
  const isAuthError = /session|auth|verify/i.test(error.message);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <h2 className="text-xl font-semibold text-[var(--aw-text,#111)]">
          {isDbError
            ? "Temporarily unable to load"
            : isAuthError
              ? "Session verification failed"
              : "Something went wrong"}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--aw-text-muted,#6B5B4B)]">
          {isDbError
            ? "Calico is experiencing high traffic. Your data is safe — please try again."
            : isAuthError
              ? "We couldn't verify your session. Please try refreshing or signing in again."
              : "An unexpected error occurred. Please try refreshing the page."}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-full px-6 text-sm font-semibold transition"
            style={{
              background: "var(--aw-primary, #FDBA74)",
              color: "var(--aw-text, #111)",
            }}
          >
            Try again
          </button>
          {isAuthError && (
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-full border px-6 text-sm font-semibold transition"
              style={{
                borderColor: "var(--aw-border, #F2DECC)",
                color: "var(--aw-text-muted, #6B5B4B)",
              }}
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
