"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchTasksList, fetchTasksStatus, type TinyFishTaskRecord } from "@/services/tasks";

function statusClasses(status: TinyFishTaskRecord["status"]): string {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-100/70 text-emerald-800";
  }
  if (status === "failed") {
    return "border-rose-200 bg-rose-100/70 text-rose-800";
  }
  if (status === "canceled") {
    return "border-slate-200 bg-slate-100/80 text-slate-700";
  }
  return "border-amber-200 bg-amber-100/75 text-amber-800";
}

function statusLabel(status: TinyFishTaskRecord["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  return "Running";
}

export function TasksTabPanel() {
  const [tasks, setTasks] = useState<TinyFishTaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runningRunIds = useMemo(
    () => tasks
      .filter((task) => task.status === "running" && task.tinyfishRunId)
      .map((task) => task.tinyfishRunId as string),
    [tasks],
  );

  const loadTasks = useCallback(async () => {
    try {
      setError(null);
      const records = await fetchTasksList();
      setTasks(records);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshStatuses = useCallback(async () => {
    try {
      const status = await fetchTasksStatus(runningRunIds.length > 0 ? runningRunIds : undefined);
      setTasks(status.tasks);
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Failed to refresh task statuses.");
    }
  }, [runningRunIds]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (loading) return;

    const intervalId = window.setInterval(() => {
      void refreshStatuses();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loading, refreshStatuses]);

  return (
    <section className="aw-surface-elevated p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="aw-kicker">Tasks</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--aw-text)]">Task Runs</h2>
          <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
            Live task tracking with automatic status refresh every 5 seconds.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void loadTasks();
          }}
          className="aw-button-secondary px-3 py-1.5 text-xs"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-5 text-sm text-[var(--aw-text-soft)]">Loading tasks...</div>
      ) : null}

      {!loading && tasks.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-[var(--aw-border)] bg-white p-4 text-sm text-[var(--aw-text-soft)]">
          No tasks yet. Start one from the Tasks button on the homepage.
        </div>
      ) : null}

      {!loading && tasks.length > 0 ? (
        <div className="mt-5 space-y-3">
          {tasks.map((task) => (
            <article
              key={task.id}
              className="rounded-2xl border border-[var(--aw-border)] bg-white px-4 py-3 shadow-[0_8px_18px_rgba(15,23,42,0.05)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--aw-text)] leading-relaxed break-words">
                    {task.prompt}
                  </p>
                  <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                    {new Date(task.createdAt).toLocaleString()}
                  </p>
                </div>

                <span
                  className={[
                    "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                    statusClasses(task.status),
                  ].join(" ")}
                >
                  {statusLabel(task.status)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {task.tinyfishRunUrl ? (
                  <a
                    href={task.tinyfishRunUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="aw-button-ghost inline-flex items-center px-3 py-1.5 text-xs"
                  >
                    View Run
                  </a>
                ) : null}

                {task.tinyfishRunId ? (
                  <span className="text-xs text-[var(--aw-text-muted)]">
                    Run ID: {task.tinyfishRunId}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
