import type { HTMLAttributes } from "react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, toCurrency } from "@/components/dashboard/dashboardData";
import { dashboardChipStyle, dashboardDashedStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function OkayToSpendWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const summary = buildDashboardSummary(props);
  const hasData = summary.live && props.dataSource.transactions.length > 0;

  // Conservative estimate: current month income minus recurring commitments and spending so far.
  const income = summary.monthIncome;
  const totalSpend = summary.monthExpenses;
  const recurringCost = props.dataSource.recurring.reduce(
    (sum, item) => sum + (item.estimated_monthly_cost ?? 0),
    0,
  );
  const okayToSpend = hasData ? Math.max(income - recurringCost - totalSpend, 0) : 0;
  const spendConfidence = okayToSpend > 500 ? "good" : okayToSpend > 100 ? "okay" : "tight";
  const confidenceColor =
    spendConfidence === "good"
      ? "text-green-600"
      : spendConfidence === "okay"
        ? "text-amber-600"
        : "text-red-500";
  const confidenceLabel =
    spendConfidence === "good"
      ? "You're in good shape"
      : spendConfidence === "okay"
        ? "Watch your spending"
        : "Things are tight right now";

  return (
    <WidgetContainer
      title="Okay to Spend"
      subtitle="Money you can use after bills, goals, and important stuff."
      dragHandleProps={props.dragHandleProps}
    >
      {!hasData ? (
        <div style={dashboardDashedStyle} className="flex h-full flex-col items-center justify-center rounded-[20px] p-6 text-center">
          <p className="text-4xl font-semibold text-[var(--calico-text)]">—</p>
          <p className="mt-3 text-sm leading-6 text-[var(--calico-text-muted)]">
            Connect an account and Calico will figure out how much you can safely spend right now.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="text-center">
            <p className="text-4xl font-bold tracking-tight text-[var(--calico-text)]">
              {toCurrency(okayToSpend)}
            </p>
            <p className={`mt-2 text-sm font-medium ${confidenceColor}`}>
              {confidenceLabel}
            </p>
          </div>
          <p className="max-w-[16rem] text-center text-xs leading-5 text-[var(--calico-text-muted)]">
            This is what's left after your repeating payments and spending so far this month.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <span style={dashboardChipStyle} className="rounded-full px-3 py-1 text-xs">
              Income: {toCurrency(income)}
            </span>
            <span style={dashboardChipStyle} className="rounded-full px-3 py-1 text-xs">
              Bills: {toCurrency(recurringCost)}
            </span>
            <span style={dashboardChipStyle} className="rounded-full px-3 py-1 text-xs">
              Spent: {toCurrency(totalSpend)}
            </span>
          </div>
        </div>
      )}
    </WidgetContainer>
  );
}
