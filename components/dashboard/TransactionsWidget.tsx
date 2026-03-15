import type { HTMLAttributes } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { fmtDate } from "@/lib/utils";
import { toCurrency } from "@/components/dashboard/dashboardData";
import { dashboardDashedStyle, dashboardInsetStyle, dashboardPrimaryButtonStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function TransactionsWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const items = props.useLiveData && props.accountsConnected
    ? [...props.dataSource.transactions].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)).slice(0, 6)
    : [];

  return (
    <WidgetContainer
      title="Transactions"
      subtitle={items.length > 0 ? "Recent synced activity across connected accounts." : "Recent posted activity will appear here when data is available."}
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
            <p className="text-lg font-semibold text-[var(--calico-text)]">You have no transactions yet</p>
            <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">
              Connect a bank or credit account and your latest activity will appear automatically, or add transactions manually now.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/transactions"
                style={dashboardPrimaryButtonStyle}
                className="inline-flex h-10 items-center justify-center rounded-full px-4 text-xs font-semibold transition hover:bg-[var(--calico-primary-hover)]"
              >
                Add transaction manually
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
                <p className="truncate text-sm font-semibold text-[var(--calico-text)]">{tx.merchant_name}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--calico-text-muted)]">{tx.category}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-[var(--calico-text)]">{toCurrency(tx.amount)}</p>
                <p className="mt-1 text-xs text-[var(--calico-text-muted)]">{fmtDate(tx.occurred_at)}</p>
              </div>
            </div>
          ))}
          <Link href="/transactions" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--calico-primary)] transition hover:text-[var(--calico-primary-hover)]">
            View all transactions
            <ArrowRight size={15} />
          </Link>
        </div>
      )}
    </WidgetContainer>
  );
}
