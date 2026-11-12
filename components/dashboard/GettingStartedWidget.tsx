import type { HTMLAttributes } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import {
  buildBudgetCategories,
  buildDashboardSummary,
  getCategoryCompletion,
} from "@/components/dashboard/dashboardData";
import { dashboardInsetStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

interface GettingStartedWidgetProps extends DashboardWidgetProps {
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  onHide?: () => void;
}

export function GettingStartedWidget(props: GettingStartedWidgetProps) {
  const summary = buildDashboardSummary(props);
  const budgetCategories = buildBudgetCategories(
    props.dataSource.transactions,
    summary.monthlyBudget,
    props.useLiveData && props.accountsConnected,
  );
  const hasGoals = props.dataSource.goals.length > 0;
  const steps = [
    { label: "Link your bank account", complete: props.dataSource.accounts.length > 0, href: "/connect" },
    { label: "Review your spending categories", complete: getCategoryCompletion(props.dataSource.transactions), href: "/transactions" },
    { label: "Set a savings goal", complete: hasGoals, href: "/goals" },
    { label: "Create a monthly spending plan", complete: budgetCategories.length > 0 || summary.monthlyBudget > 0, href: "/budgets" },
  ];
  const completed = steps.filter((step) => step.complete).length;
  const progress = Math.round((completed / steps.length) * 100);

  return (
    <WidgetContainer
      title="Getting Started"
      subtitle="A few quick steps to get Agent Wallet working for you."
      dragHandleProps={props.dragHandleProps}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--calico-text-muted)]">
              Setup Progress
            </p>
            <span className="text-sm font-semibold text-[var(--calico-text)]">
              {completed}/{steps.length}
            </span>
          </div>
          <div className="h-3 rounded-full bg-[var(--calico-border)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--calico-primary)] to-[var(--calico-success)] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="space-y-3">
          {steps.map((step) => {
            const Icon = step.complete ? CheckCircle2 : Circle;
            return (
              <Link
                key={step.label}
                href={step.href}
                style={dashboardInsetStyle}
                className="group flex items-center gap-3 rounded-[16px] px-4 py-3 text-sm transition-all hover:bg-[var(--calico-card)] hover:shadow-sm"
              >
                <Icon
                  size={20}
                  className={step.complete
                    ? "shrink-0 text-[var(--calico-success)]"
                    : "shrink-0 text-[var(--calico-text-muted)] group-hover:text-[var(--calico-primary)]"
                  }
                />
                <span className={step.complete ? "text-[var(--calico-text-muted)] line-through" : "text-[var(--calico-text)]"}>
                  {step.label}
                </span>
              </Link>
            );
          })}
        </div>

        {props.onHide && (
          <div className="border-t border-[var(--calico-border)] pt-3">
            <button
              type="button"
              onClick={props.onHide}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--calico-text-muted)] transition hover:text-[var(--calico-primary)]"
            >
              <X size={14} />
              Hide this widget
            </button>
          </div>
        )}
      </div>
    </WidgetContainer>
  );
}
