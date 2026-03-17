import type { HTMLAttributes } from "react";
import Link from "next/link";
import { ShieldCheck, Info } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { dashboardDashedStyle, dashboardPrimaryButtonStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function CreditScoreWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const creditScoreEnabled = false; // Future: will be tracked in user preferences

  if (!creditScoreEnabled) {
    return (
      <WidgetContainer
        title="Credit Score"
        action={
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-[var(--calico-border)] text-[var(--calico-text-muted)] transition hover:bg-[var(--calico-hover)] hover:text-[var(--calico-text)]"
            aria-label="Credit score information"
          >
            <Info size={16} />
          </button>
        }
        dragHandleProps={props.dragHandleProps}
      >
        <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-6">
          <div>
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-[16px] bg-[rgba(34,197,94,0.15)] text-[var(--calico-success)]">
              <ShieldCheck size={24} />
            </div>
            <p className="mt-4 text-base font-semibold text-[var(--calico-text)]">
              See your credit score here
            </p>
            <p className="mt-3 text-sm leading-6 text-[var(--calico-text-muted)]">
              Turn this on and Calico will show your credit score right on your dashboard. You'll see when it changes.
            </p>
          </div>
          <Link
            href="/settings?section=credit"
            style={dashboardPrimaryButtonStyle}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-[16px] px-4 text-sm font-semibold transition hover:opacity-95"
          >
            Turn it on
          </Link>
        </div>
      </WidgetContainer>
    );
  }

  // Enabled state (placeholder for future credit score display)
  return (
    <WidgetContainer
      title="Credit Score"
      action={
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-[var(--calico-border)] text-[var(--calico-text-muted)] transition hover:bg-[var(--calico-hover)] hover:text-[var(--calico-text)]"
          aria-label="Credit score information"
        >
          <Info size={16} />
        </button>
      }
      dragHandleProps={props.dragHandleProps}
    >
      <div className="flex h-full flex-col items-center justify-center py-8">
        <div className="relative inline-flex h-32 w-32 items-center justify-center">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="var(--calico-border)"
              strokeWidth="8"
            />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="var(--calico-primary)"
              strokeWidth="8"
              strokeDasharray="212 339"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute text-center">
            <div className="text-3xl font-bold text-[var(--calico-text)]">—</div>
            <p className="mt-1 text-xs text-[var(--calico-text-muted)]">Pending</p>
          </div>
        </div>
        <p className="mt-6 text-sm text-[var(--calico-text-muted)]">
          Syncing your credit score...
        </p>
      </div>
    </WidgetContainer>
  );
}
