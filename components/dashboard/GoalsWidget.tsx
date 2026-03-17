import type { HTMLAttributes } from "react";
import Link from "next/link";
import { Target } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import {
  dashboardDashedStyle,
  dashboardPrimaryButtonStyle,
  dashboardSecondaryButtonStyle,
} from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function GoalsWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  return (
    <WidgetContainer
      title="Money Goals"
      subtitle="What you're saving for and paying off."
      dragHandleProps={props.dragHandleProps}
    >
      <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-4">
        <div>
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-[20px] bg-[rgba(251,207,232,0.28)] text-[var(--calico-primary)]">
            <Target size={20} />
          </div>
          <p className="mt-4 text-lg font-semibold text-[var(--calico-text)]">What are you saving for?</p>
          <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">
            Set a money goal and Calico will help you track your progress. Start with an emergency fund or something fun.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link
            href="/connect"
            style={dashboardSecondaryButtonStyle}
            className="inline-flex h-11 items-center justify-center rounded-[20px] px-4 text-sm font-semibold transition hover:bg-[var(--calico-card)]"
          >
            Connect an account
          </Link>
          <Link
            href="/goals"
            style={dashboardPrimaryButtonStyle}
            className="inline-flex h-11 items-center justify-center rounded-[20px] px-4 text-sm font-semibold transition hover:bg-[var(--calico-primary-hover)]"
          >
            Set a goal
          </Link>
        </div>
      </div>
    </WidgetContainer>
  );
}
