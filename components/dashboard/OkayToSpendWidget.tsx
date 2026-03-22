import type { HTMLAttributes } from "react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, toCurrency } from "@/components/dashboard/dashboardData";
import { dashboardChipStyle, dashboardDashedStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function OkayToSpendWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const summary = buildDashboardSummary(props);
  const hasData = summary.live && props.dataSource.transactions.length > 0;

  const income = summary.monthIncome;
  const totalSpend = summary.monthExpenses;
  const recurringCost = props.dataSource.recurring.reduce(
    (sum, item) => sum + (item.estimated_monthly_cost ?? 0),
    0,
  );
  const safeToSpend = hasData ? Math.max(income - recurringCost - totalSpend, 0) : 0;

  return (
    <WidgetContainer
      title="Safe to Spend"
      subtitle="What's left after your bills and spending so far this month."
      dragHandleProps={props.dragHandleProps}
    >
      {!hasData ? (
        <div style={dashboardDashedStyle} className="flex h-full flex-col items-center justify-center rounded-[20px] p-6 text-center">
          <p className="text-4xl font-semibold text-[var(--calico-text)]">—</p>
          <p className="mt-3 text-sm leading-6 text-[var(--calico-text-muted)]">
            Connect an account to see how much you have available to spend.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="text-center">
            <p className="text-4xl font-bold tracking-tight text-[var(--calico-text)]">
              {toCurrency(safeToSpend)}
            </p>
            <p className="mt-2 text-sm text-[var(--calico-text-muted)]">
              available this month
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <span style={dashboardChipStyle} className="rounded-full px-3 py-1 text-xs">
              Income this month {toCurrency(income)}
            </span>
            <span style={dashboardChipStyle} className="rounded-full px-3 py-1 text-xs">
              Recurring bills {toCurrency(recurringCost)}
            </span>
            <span style={dashboardChipStyle} className="rounded-full px-3 py-1 text-xs">
              Spent so far {toCurrency(totalSpend)}
            </span>
          </div>
        </div>
      )}
    </WidgetContainer>
  );
}
