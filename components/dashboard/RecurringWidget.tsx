import type { HTMLAttributes } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { toCurrency } from "@/components/dashboard/dashboardData";
import {
  dashboardDashedStyle,
  dashboardInsetStyle,
  dashboardPrimaryButtonStyle,
  dashboardSecondaryButtonStyle,
} from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function RecurringWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const recurring = props.useLiveData && props.accountsConnected
    ? props.dataSource.recurring.filter((item) => item.lifecycle_status !== "ignored").slice(0, 4)
    : [];

  return (
    <WidgetContainer
      title="Upcoming Bills"
      subtitle="Recurring charges Calico detected from your transactions."
      dragHandleProps={props.dragHandleProps}
    >
      {recurring.length === 0 ? (
        <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-4">
          <div>
            <p className="text-lg font-semibold text-[var(--calico-text)]">No upcoming bills yet</p>
            <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">
              Connect an account and Calico will find your bills and subscriptions automatically.
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
              href="/transactions"
              style={dashboardPrimaryButtonStyle}
              className="inline-flex h-11 items-center justify-center rounded-[20px] px-4 text-sm font-semibold transition hover:bg-[var(--calico-primary-hover)]"
            >
              Add a payment
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {recurring.map((item) => {
            const confidence = item.confidence ?? 0;
            const confidenceLabel = confidence >= 0.8 ? "High" : confidence >= 0.5 ? "Medium" : "Low";
            return (
              <div key={item.id} style={dashboardInsetStyle} className="rounded-[16px] px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--calico-text)]">{item.merchant}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--calico-text-muted)]">
                      <span className="capitalize">{item.recurrence_interval}</span>
                      <span className="text-[var(--calico-border)]">·</span>
                      <span>{confidenceLabel} confidence</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--calico-text)]">
                    {toCurrency(item.estimated_monthly_cost)}/mo
                  </span>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-[var(--calico-text-muted)]">
              {toCurrency(recurring.reduce((s, i) => s + (i.estimated_monthly_cost ?? 0), 0))}/mo total
            </p>
            <Link href="/recurring" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--calico-primary)] transition hover:text-[var(--calico-primary-hover)]">
              See all
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      )}
    </WidgetContainer>
  );
}
