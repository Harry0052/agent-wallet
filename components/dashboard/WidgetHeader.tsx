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
      <div className="min-w-0">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--aw-text-muted)]/80">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {action}
        <button
          type="button"
          aria-label={`Reorder ${title} widget`}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-xl text-[var(--aw-text-muted)]/40 transition-colors hover:text-[var(--aw-text-muted)]",
            dragHandleProps ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          )}
          {...dragHandleProps}
        >
          <GripVertical size={14} />
        </button>
      </div>
    </div>
  );
}
