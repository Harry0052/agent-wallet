import type { HTMLAttributes } from "react";
import { motion } from "framer-motion";
import { PlaceholderChart } from "@/components/dashboard/PlaceholderChart";
import { SimpleTrendChart } from "@/components/dashboard/SimpleTrendChart";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, placeholderNetWorth, toCurrency } from "@/components/dashboard/dashboardData";
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
          <PlaceholderChart data={placeholderNetWorth} dataKey="value" />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <SimpleTrendChart
              data={chartData}
              xKey="label"
              series={[{
                key: "value",
                stroke: calicoTheme.primary,
                fill: calicoTheme.primary,
                strokeWidth: 2.8,
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
