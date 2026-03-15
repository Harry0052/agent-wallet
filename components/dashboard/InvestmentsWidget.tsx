import type { HTMLAttributes } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { toCurrency } from "@/components/dashboard/dashboardData";
import { dashboardDashedStyle, dashboardInsetStyle, dashboardSecondaryButtonStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function InvestmentsWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const holdings = props.useLiveData && props.accountsConnected ? props.dataSource.investments : [];

  return (
    <WidgetContainer
      title="Investments"
      subtitle="Ready for holdings, positions, and long-term tracking."
      dragHandleProps={props.dragHandleProps}
    >
      {holdings.length === 0 ? (
        <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-4">
          <div>
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-[20px] bg-[rgba(253,230,138,0.3)] text-[var(--calico-primary)]">
              <BarChart3 size={20} />
            </div>
            <p className="mt-4 text-lg font-semibold text-[var(--calico-text)]">No investment holdings</p>
            <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">
              Connect an investment account when you are ready, or add holdings manually now.
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
              href="/investments"
              className="inline-flex h-11 items-center justify-center rounded-[20px] bg-[var(--calico-primary)] px-4 text-sm font-semibold text-[var(--calico-text)] transition hover:bg-[var(--calico-primary-hover)]"
            >
              Add holding
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {holdings.map((holding) => (
            <div key={holding.id} style={dashboardInsetStyle} className="rounded-[20px] px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--calico-text)]">{holding.symbol}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--calico-text-muted)]">{holding.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[var(--calico-text)]">{toCurrency(holding.value)}</p>
                  <p className={`mt-1 text-xs ${holding.changePct >= 0 ? "text-[var(--calico-success)]" : "text-[var(--calico-primary)]"}`}>
                    {holding.changePct >= 0 ? "+" : ""}{holding.changePct.toFixed(2)}%
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}
