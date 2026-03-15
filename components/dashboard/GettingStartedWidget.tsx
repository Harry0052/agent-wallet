import type { HTMLAttributes } from "react";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildBudgetCategories, getCategoryCompletion } from "@/components/dashboard/dashboardData";
import { dashboardInsetStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function GettingStartedWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const budgetCategories = buildBudgetCategories(props.wallet, props.dataSource.transactions, props.useLiveData && props.accountsConnected);
  const steps = [
    { label: "Add account manually", complete: props.dataSource.accounts.length > 0, href: "/accounts" },
    { label: "Invite partner", complete: false, href: "/settings" },
    { label: "Customize categories", complete: getCategoryCompletion(props.dataSource.transactions), href: "/transactions" },
    { label: "Create a goal", complete: false, href: "/goals" },
    { label: "Create a budget", complete: budgetCategories.length > 0, href: "/budgets" },
  ];
  const completed = steps.filter((step) => step.complete).length;
  const progress = Math.round((completed / steps.length) * 100);

  return (
    <WidgetContainer
      title="Getting Started"
      subtitle="A lightweight checklist for turning the dashboard into a live command center."
      dragHandleProps={props.dragHandleProps}
    >
      <div className="space-y-4">
        <div>
          <div className="h-2 rounded-full bg-[var(--calico-border)]">
            <div
              className="h-full rounded-full bg-[var(--calico-primary)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-[var(--calico-text-muted)]">{completed} of {steps.length} complete</p>
        </div>
        <div className="space-y-2">
          {steps.map((step) => {
            const Icon = step.complete ? CheckCircle2 : Circle;
            return (
              <Link
                key={step.label}
                href={step.href}
                style={dashboardInsetStyle}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm text-[var(--calico-text)] transition hover:bg-[var(--calico-card)]"
              >
                <Icon size={16} className={step.complete ? "text-[var(--calico-success)]" : "text-[var(--calico-text-muted)]"} />
                <span>{step.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </WidgetContainer>
  );
}
