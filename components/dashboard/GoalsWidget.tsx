import type { HTMLAttributes } from "react";
import Link from "next/link";
import { Plus, Target } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { toCurrency } from "@/components/dashboard/dashboardData";
import {
  dashboardDashedStyle,
  dashboardInsetStyle,
  dashboardPrimaryButtonStyle,
} from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function GoalsWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const goals = props.dataSource.goals;

  if (goals.length === 0) {
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
          <div className="mt-6">
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

  const displayed = goals.slice(0, 3);

  return (
    <WidgetContainer
      title="Money Goals"
      action={
        <Link
          href="/goals"
          className="inline-flex h-8 items-center gap-1 rounded-[12px] border border-[var(--calico-border)] px-3 text-xs font-semibold text-[var(--calico-text-muted)] transition hover:bg-[var(--calico-hover)] hover:text-[var(--calico-text)]"
        >
          <Plus size={14} />
          Add
        </Link>
      }
      dragHandleProps={props.dragHandleProps}
    >
      <div className="space-y-3">
        {displayed.map((goal) => (
          <Link
            key={goal.id}
            href="/goals"
            style={dashboardInsetStyle}
            className="block rounded-[16px] px-4 py-3 transition-all hover:bg-[var(--calico-card)] hover:shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-[var(--calico-text)]">{goal.name}</p>
              <span className="shrink-0 text-xs font-semibold text-[var(--calico-text)]">{goal.progress}%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[var(--calico-border)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--calico-primary)] to-[var(--calico-success)] transition-all duration-500"
                style={{ width: `${goal.progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-[var(--calico-text-muted)]">
              {toCurrency(goal.totalSaved)} of {toCurrency(goal.targetAmount)}
            </p>
          </Link>
        ))}
        {goals.length > 3 && (
          <Link
            href="/goals"
            className="block text-center text-xs font-semibold text-[var(--calico-primary)] transition hover:underline"
          >
            View all {goals.length} goals
          </Link>
        )}
      </div>
    </WidgetContainer>
  );
}
