import type { HTMLAttributes } from "react";
import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PlaceholderChart } from "@/components/dashboard/PlaceholderChart";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { buildDashboardSummary, placeholderNetWorth, toCurrency } from "@/components/dashboard/dashboardData";
import { dashboardChipStyle, dashboardInsetStyle } from "@/components/dashboard/dashboardStyles";
import { calicoTheme } from "@/styles/theme";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function NetWorthWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const summary = buildDashboardSummary(props);
  const chartData = summary.netWorth;

  return (
    <WidgetContainer
      title="Net Worth"
      subtitle={summary.live ? "Auto-refreshes from connected and manual account updates." : "Static placeholder until live data is available."}
      dragHandleProps={props.dragHandleProps}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-4xl font-semibold tracking-tight text-[var(--calico-text)]">{toCurrency(summary.netWorthValue)}</p>
            <p className="mt-2 text-sm text-[var(--calico-text-muted)]">{summary.live ? `${summary.netWorthDelta >= 0 ? "+" : ""}${toCurrency(summary.netWorthDelta)} from previous period` : "$0.00"}</p>
          </div>
          <div style={dashboardChipStyle} className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]">
            {summary.live ? "Live preview" : "Placeholder"}
          </div>
        </div>
        {!props.accountsConnected ? (
          <PlaceholderChart data={placeholderNetWorth} dataKey="value" />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={dashboardInsetStyle} className="h-56 rounded-[20px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="net-worth-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={calicoTheme.primary} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={calicoTheme.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={calicoTheme.border} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: calicoTheme.textMuted, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis hide domain={[0, "dataMax + 100"]} />
                <Tooltip
                  formatter={(value) => [toCurrency(Number(value ?? 0)), "Net worth"]}
                  contentStyle={{ background: calicoTheme.card, border: `1px solid ${calicoTheme.border}`, borderRadius: 16, boxShadow: "0 8px 18px rgba(15,23,42,0.08)" }}
                  itemStyle={{ color: calicoTheme.text }}
                  labelStyle={{ color: calicoTheme.textMuted }}
                />
                <Area type="monotone" dataKey="value" stroke={calicoTheme.primary} strokeWidth={3} fill="url(#net-worth-fill)" />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </div>
    </WidgetContainer>
  );
}
