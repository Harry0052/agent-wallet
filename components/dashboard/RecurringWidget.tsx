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
      title="Recurring"
      subtitle="Upcoming recurring transactions and subscriptions."
      dragHandleProps={props.dragHandleProps}
    >
      {recurring.length === 0 ? (
        <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-4">
          <div>
            <p className="text-lg font-semibold text-[var(--calico-text)]">No upcoming transactions</p>
            <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">
              Connect an account for auto-detected recurring items, or add recurring items manually right away.
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
              href="/recurring"
              style={dashboardPrimaryButtonStyle}
              className="inline-flex h-11 items-center justify-center rounded-[20px] px-4 text-sm font-semibold transition hover:bg-[var(--calico-primary-hover)]"
            >
              Add recurring item
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {recurring.map((item) => (
            <div key={item.id} style={dashboardInsetStyle} className="rounded-[20px] px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--calico-text)]">{item.merchant}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--calico-text-muted)]">{item.recurrence_interval}</p>
                </div>
                <span className="text-sm font-semibold text-[var(--calico-text)]">{toCurrency(item.estimated_monthly_cost)}</span>
              </div>
            </div>
          ))}
          <Link href="/recurring" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--calico-primary)] transition hover:text-[var(--calico-primary-hover)]">
            Manage recurring items
            <ArrowRight size={15} />
          </Link>
        </div>
      )}
    </WidgetContainer>
  );
}
