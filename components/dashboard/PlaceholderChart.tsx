import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { calicoTheme } from "@/styles/theme";
import { dashboardInsetStyle } from "@/components/dashboard/dashboardStyles";

interface PlaceholderChartProps {
  data: Array<Record<string, number | string>>;
  dataKey: string;
}

export function PlaceholderChart({ data, dataKey }: PlaceholderChartProps) {
  return (
    <div style={dashboardInsetStyle} className="h-44 rounded-[20px] p-3">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="placeholder-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={calicoTheme.primary} stopOpacity={0.26} />
              <stop offset="95%" stopColor={calicoTheme.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={calicoTheme.primary}
            strokeWidth={2}
            fill="url(#placeholder-fill)"
            fillOpacity={1}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
