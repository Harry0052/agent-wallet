import type { HTMLAttributes } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, toCurrency } from "@/components/dashboard/dashboardData";
import {
  dashboardDashedStyle,
  dashboardPrimaryButtonStyle,
  dashboardSecondaryButtonStyle,
} from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function BudgetWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const { budgetCategories, monthlyBudget } = buildDashboardSummary(props);
  const hasBudget = props.useLiveData && props.accountsConnected && budgetCategories.length > 0 && monthlyBudget > 0;

  return (
    <WidgetContainer
      title="Spending Plan"
      subtitle={hasBudget
        ? `You're working with ${toCurrency(monthlyBudget)} this month across your top categories.`
        : "Set up a plan so you know where your money goes."}
      dragHandleProps={props.dragHandleProps}
    >
      {hasBudget ? (
        <div className="space-y-4">
          {budgetCategories.map((category) => (
            <div key={category.category} className="space-y-2">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-medium capitalize text-[var(--calico-text)]">{category.category}</span>
                <span className="text-[var(--calico-text-muted)]">
                  {toCurrency(category.spent)} of {toCurrency(category.total)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-[var(--calico-border)]">
                <div
                  className="h-full rounded-full bg-[var(--calico-primary)]"
                  style={{ width: `${category.progress}%` }}
                />
              </div>
            </div>
          ))}
          <Link
            href="/budgets"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--calico-primary)] transition hover:text-[var(--calico-primary-hover)]"
          >
            See full spending plan
            <ArrowRight size={15} />
          </Link>
        </div>
      ) : (
        <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-4">
          <div>
            <p className="text-lg font-semibold text-[var(--calico-text)]">No spending plan yet</p>
            <p className="mt-2 max-w-[18rem] text-sm leading-6 text-[var(--calico-text-muted)]">
              Create a plan so Calico can help you track where your money goes each month.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {!props.accountsConnected ? (
              <Link
                href="/connect"
                style={dashboardSecondaryButtonStyle}
                className="inline-flex h-11 items-center justify-center rounded-[20px] px-4 text-sm font-semibold transition hover:bg-[var(--calico-card)]"
              >
                Connect an account
              </Link>
            ) : null}
            <Link
              href="/budgets"
              style={dashboardPrimaryButtonStyle}
              className="inline-flex h-11 items-center justify-center rounded-[20px] px-4 text-sm font-semibold transition hover:bg-[var(--calico-primary-hover)]"
            >
              Create spending plan
            </Link>
          </div>
        </div>
      )}
    </WidgetContainer>
  );
}
