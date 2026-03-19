import Link from "next/link";
import type { HTMLAttributes } from "react";
import { motion } from "framer-motion";
import { Receipt } from "lucide-react";
import { SimpleTrendChart } from "@/components/dashboard/SimpleTrendChart";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, toCurrency } from "@/components/dashboard/dashboardData";
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
        {hasData ? (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--calico-text-muted)]">
              <span style={dashboardChipStyle} className="rounded-full px-3 py-1">This month</span>
              <span style={dashboardChipStyle} className="rounded-full px-3 py-1">Last month</span>
            </div>
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
          </>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--calico-border)] bg-[var(--calico-card)] px-6 py-10 text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(253,186,116,0.15)] text-[var(--calico-primary)]">
              <Receipt size={20} />
            </div>
            <p className="mt-4 text-sm font-semibold text-[var(--calico-text)]">No spending data yet</p>
            <p className="mt-1.5 max-w-[16rem] text-xs leading-5 text-[var(--calico-text-muted)]">
              Connect an account or add a transaction to see your spending trends.
            </p>
            <Link
              href="/transactions"
              className="mt-4 inline-flex h-9 items-center rounded-full bg-[var(--calico-primary)] px-4 text-xs font-semibold text-[var(--calico-text)] transition hover:bg-[var(--calico-primary-hover)]"
            >
              Add a transaction
            </Link>
          </div>
        )}
      </div>
    </WidgetContainer>
  );
}
