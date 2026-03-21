import Link from "next/link";
import type { HTMLAttributes } from "react";
import { motion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import { SimpleTrendChart } from "@/components/dashboard/SimpleTrendChart";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, toCurrency } from "@/components/dashboard/dashboardData";
import { dashboardChipStyle } from "@/components/dashboard/dashboardStyles";
import { calicoTheme } from "@/styles/theme";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function NetWorthWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const summary = buildDashboardSummary(props);
  const chartData = summary.netWorth;
  const hasData = summary.live && props.dataSource.accounts.length > 0;

  return (
    <WidgetContainer
      title="Net Worth"
      subtitle={hasData
        ? "Everything you have minus what you owe across connected and manual accounts."
        : "Connect an account or add one manually to see your real net worth here."}
      dragHandleProps={props.dragHandleProps}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-4xl font-semibold tracking-tight text-[var(--calico-text)]">
              {hasData ? toCurrency(summary.netWorthValue) : "—"}
            </p>
            <p className="mt-2 text-sm text-[var(--calico-text-muted)]">
              {hasData
                ? `${summary.netWorthDelta >= 0 ? "+" : ""}${toCurrency(summary.netWorthDelta)} versus the prior month`
                : "We'll show the trend once Calico has account balances to track."}
            </p>
          </div>
          <div style={dashboardChipStyle} className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]">
            {hasData ? "Live" : "Setup needed"}
          </div>
        </div>
        {!hasData ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--calico-border)] bg-[var(--calico-card)] px-6 py-10 text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(253,186,116,0.15)] text-[var(--calico-primary)]">
              <TrendingUp size={20} />
            </div>
            <p className="mt-4 text-sm font-semibold text-[var(--calico-text)]">No net worth data yet</p>
            <p className="mt-1.5 max-w-[16rem] text-xs leading-5 text-[var(--calico-text-muted)]">
              Connect an account or add one manually to start tracking your net worth.
            </p>
            <Link
              href="/accounts"
              className="mt-4 inline-flex h-9 items-center rounded-full bg-[var(--calico-primary)] px-4 text-xs font-semibold text-[var(--calico-text)] transition hover:bg-[var(--calico-primary-hover)]"
            >
              Add an account
            </Link>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <SimpleTrendChart
              data={chartData}
              xKey="label"
              series={[{
                key: "value",
                stroke: calicoTheme.primary,
                fill: calicoTheme.primary,
                strokeWidth: 1.2,
              }]}
              formatValue={toCurrency}
              maxXAxisLabels={6}
            />
          </motion.div>
        )}
      </div>
    </WidgetContainer>
  );
}
