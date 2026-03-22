import type { HTMLAttributes } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { fmtDate } from "@/lib/utils";
import { buildDashboardSummary, toCurrency } from "@/components/dashboard/dashboardData";
import { dashboardDashedStyle, dashboardInsetStyle, dashboardPrimaryButtonStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function TransactionsWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const { recentTransactions } = buildDashboardSummary(props);
  const items = props.useLiveData && props.accountsConnected ? recentTransactions : [];

  return (
    <WidgetContainer
      title="Recent Activity"
      subtitle={items.length > 0 ? "Your latest transactions." : "Connect an account to see your recent activity here."}
      dragHandleProps={props.dragHandleProps}
      action={
        <Link href="/transactions" className="inline-flex rounded-full border border-[var(--calico-border)] bg-[var(--calico-hover)] px-3 py-1 text-xs font-semibold text-[var(--calico-text)] transition hover:bg-[var(--calico-card)]">
          Open
        </Link>
      }
    >
      {items.length === 0 ? (
        <div style={dashboardDashedStyle} className="flex h-full min-h-[220px] items-center justify-center rounded-[20px] p-6 text-center">
          <div>
            <p className="text-lg font-semibold text-[var(--calico-text)]">No money moves yet</p>
            <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">
              Connect a bank or card and your spending will show up here, or add something yourself.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/transactions"
                style={dashboardPrimaryButtonStyle}
                className="inline-flex h-10 items-center justify-center rounded-full px-4 text-xs font-semibold transition hover:bg-[var(--calico-primary-hover)]"
              >
                Add one yourself
              </Link>
              <Link
                href="/connect"
                className="inline-flex h-10 items-center justify-center rounded-full border border-[var(--calico-border)] bg-[var(--calico-hover)] px-4 text-xs font-semibold text-[var(--calico-text)] transition hover:bg-[var(--calico-card)]"
              >
                Connect an account
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((tx) => (
            <div key={tx.id} style={dashboardInsetStyle} className="flex items-center justify-between gap-4 rounded-[20px] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--calico-text)]">
                  {tx.merchant_name || tx.normalized_merchant || "Manual entry"}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--calico-text-muted)]">
                  {tx.category || "Uncategorized"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-[var(--calico-text)]">{toCurrency(tx.amount)}</p>
                <p className="mt-1 text-xs text-[var(--calico-text-muted)]">{fmtDate(tx.occurred_at)}</p>
              </div>
            </div>
          ))}
          <Link href="/transactions" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--calico-primary)] transition hover:text-[var(--calico-primary-hover)]">
            See all money moves
            <ArrowRight size={15} />
          </Link>
        </div>
      )}
    </WidgetContainer>
  );
}
