import Link from "next/link";
import type { HTMLAttributes } from "react";
import { motion } from "framer-motion";
import { Receipt } from "lucide-react";
import { SimpleTrendChart } from "@/components/dashboard/SimpleTrendChart";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, toCurrency } from "@/components/dashboard/dashboardData";
import { calicoTheme } from "@/styles/theme";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function SpendingWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const summary = buildDashboardSummary(props);
  const hasData = summary.live && props.dataSource.transactions.length > 0;

  return (
    <WidgetContainer
      title="Cumulative Spending"
      subtitle={hasData
        ? `${toCurrency(summary.monthExpenses)} spent this month across ${summary.monthTransactionCount} transaction${summary.monthTransactionCount === 1 ? "" : "s"}.`
        : "Compare this month's spending pace with last month."}
      dragHandleProps={props.dragHandleProps}
    >
      <div className="space-y-5">
        {hasData ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-3 rounded-full" style={{ backgroundColor: calicoTheme.primary }} />
                <span className="text-[var(--calico-text-muted)]">This month</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-3 rounded-full" style={{ backgroundColor: calicoTheme.primarySoft }} />
                <span className="text-[var(--calico-text-muted)]">Last month</span>
              </span>
            </div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <SimpleTrendChart
                data={summary.spending}
                xKey="day"
                series={[
                  { key: "lastMonth", stroke: calicoTheme.primarySoft, strokeWidth: 1 },
                  { key: "thisMonth", stroke: calicoTheme.primary, strokeWidth: 1.2 },
                ]}
                formatValue={toCurrency}
                maxXAxisLabels={5}
                yAxisUnit="Cumulative"
                xAxisLabel="Day of month"
              />
            </motion.div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--calico-border)] bg-[var(--calico-card)] px-6 py-10 text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(253,186,116,0.15)] text-[var(--calico-primary)]">
              <Receipt size={20} />
            </div>
            <p className="mt-4 text-sm font-semibold text-[var(--calico-text)]">Track your spending pace</p>
            <p className="mt-1.5 max-w-[16rem] text-xs leading-5 text-[var(--calico-text-muted)]">
              Once you connect an account, Agent Wallet will compare this month's spending with last month so you can see if you're on track.
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
