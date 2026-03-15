import clsx from "clsx";

export type SourceState = "Synced" | "Imported" | "Inferred" | "Manual";

const DOT_COLOR: Record<SourceState, string> = {
  Synced: "var(--aw-success)",
  Inferred: "var(--aw-primary-secondary)",
  Imported: "var(--aw-text-muted)",
  Manual: "var(--aw-text-muted)",
};

export function SourceStateBadge({
  state,
  className,
}: {
  state: SourceState;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        {
          "border-[rgba(22,163,74,0.28)] bg-[rgba(22,163,74,0.12)] text-[var(--aw-success)]":
            state === "Synced",
          "border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] text-[var(--aw-text-muted)]":
            state === "Imported" || state === "Manual",
          "border-[rgba(251,207,232,0.55)] bg-[rgba(251,207,232,0.36)] text-[var(--aw-text)]":
            state === "Inferred",
        },
        className,
      )}
    >
      <span
        style={{
          display: "inline-block",
          width: 5,
          height: 5,
          borderRadius: 9999,
          background: DOT_COLOR[state],
          flexShrink: 0,
        }}
      />
      {state}
    </span>
  );
}
