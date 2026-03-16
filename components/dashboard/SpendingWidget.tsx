import type { HTMLAttributes } from "react";
import { motion } from "framer-motion";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PlaceholderChart } from "@/components/dashboard/PlaceholderChart";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, placeholderSpending, toCurrency } from "@/components/dashboard/dashboardData";
import { dashboardChipStyle, dashboardInsetStyle } from "@/components/dashboard/dashboardStyles";
import { calicoTheme } from "@/styles/theme";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function SpendingWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const summary = buildDashboardSummary(props);
  const money = props.home.moneyIntelligence;

  return (
    <WidgetContainer
      title="Spending"
      subtitle={money
        ? `True spend ${toCurrency(money.statement.trueSpendAmount)}. Predicted next 7 days: ${toCurrency(money.weeklyPrediction.predictedSpendNext7d)}.`
        : "This month vs last month across days 1 to 30."}
      dragHandleProps={props.dragHandleProps}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--calico-text-muted)]">
          <span style={dashboardChipStyle} className="rounded-full px-3 py-1">This month</span>
          <span style={dashboardChipStyle} className="rounded-full px-3 py-1">Last month</span>
        </div>
        {!props.accountsConnected ? (
          <PlaceholderChart data={placeholderSpending} dataKey="thisMonth" />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={dashboardInsetStyle} className="h-60 rounded-[20px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={summary.spending}>
                <CartesianGrid stroke={calicoTheme.border} vertical={false} />
                <XAxis dataKey="day" tick={{ fill: calicoTheme.textMuted, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: calicoTheme.textMuted, fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(value: number) => `$${value}`} />
                <Tooltip
                  formatter={(value) => [toCurrency(Number(value ?? 0)), "Spend"]}
                  contentStyle={{ background: calicoTheme.card, border: `1px solid ${calicoTheme.border}`, borderRadius: 16, boxShadow: "0 8px 18px rgba(15,23,42,0.08)" }}
                  itemStyle={{ color: calicoTheme.text }}
                  labelStyle={{ color: calicoTheme.textMuted }}
                />
                <Legend wrapperStyle={{ color: calicoTheme.text, paddingTop: 8 }} />
                <Line type="monotone" dataKey="lastMonth" name="Last month" stroke={calicoTheme.primarySoft} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="thisMonth" name="This month" stroke={calicoTheme.primary} strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </div>
    </WidgetContainer>
  );
}
