import type { HTMLAttributes } from "react";
import { motion } from "framer-motion";
import { PlaceholderChart } from "@/components/dashboard/PlaceholderChart";
import { SimpleTrendChart } from "@/components/dashboard/SimpleTrendChart";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, placeholderSpending, toCurrency } from "@/components/dashboard/dashboardData";
import { dashboardChipStyle } from "@/components/dashboard/dashboardStyles";
import { calicoTheme } from "@/styles/theme";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function SpendingWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const summary = buildDashboardSummary(props);
  const hasData = summary.live && props.dataSource.transactions.length > 0;

  return (
    <WidgetContainer
      title="Spending"
      subtitle={hasData
        ? `You've spent ${toCurrency(summary.monthExpenses)} across ${summary.monthTransactionCount} transaction${summary.monthTransactionCount === 1 ? "" : "s"} this month.`
        : "How this month's spending compares with last month once activity starts coming in."}
      dragHandleProps={props.dragHandleProps}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--calico-text-muted)]">
          <span style={dashboardChipStyle} className="rounded-full px-3 py-1">This month</span>
          <span style={dashboardChipStyle} className="rounded-full px-3 py-1">Last month</span>
        </div>
        {!hasData ? (
          <PlaceholderChart data={placeholderSpending} dataKey="thisMonth" />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <SimpleTrendChart
              data={summary.spending}
              xKey="day"
              series={[
                { key: "lastMonth", stroke: calicoTheme.primarySoft, strokeWidth: 2.2 },
                { key: "thisMonth", stroke: calicoTheme.primary, strokeWidth: 2.8 },
              ]}
              formatValue={toCurrency}
              maxXAxisLabels={5}
            />
          </motion.div>
        )}
      </div>
    </WidgetContainer>
  );
}
