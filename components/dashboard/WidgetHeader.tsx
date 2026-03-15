import type { HTMLAttributes, ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface WidgetHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
}

export function WidgetHeader({ title, subtitle, action, dragHandleProps }: WidgetHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--calico-text-muted)]">
          {title}
        </p>
        {subtitle ? (
          <p className="mt-2 text-sm text-[var(--calico-text-muted)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {action}
        <button
          type="button"
          aria-label={`Reorder ${title} widget`}
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--calico-border)] bg-[var(--calico-hover)] text-[var(--calico-text-muted)] transition hover:bg-[var(--calico-card)] hover:text-[var(--calico-text)]",
            dragHandleProps ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          )}
          {...dragHandleProps}
        >
          <GripVertical size={16} />
        </button>
      </div>
    </div>
  );
}
