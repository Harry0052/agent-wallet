import { agentWalletTheme } from "@/styles/theme";
import { SimpleTrendChart } from "@/components/dashboard/SimpleTrendChart";

interface PlaceholderChartProps {
  data: Array<Record<string, number | string>>;
  dataKey: string;
}

export function PlaceholderChart({ data, dataKey }: PlaceholderChartProps) {
  return (
    <SimpleTrendChart
      data={data}
      xKey={typeof data[0]?.label === "string" ? "label" : typeof data[0]?.day === "number" ? "day" : dataKey}
      series={[{
        key: dataKey,
        stroke: agentWalletTheme.primary,
        fill: agentWalletTheme.primary,
        strokeWidth: 2.2,
      }]}
      heightClassName="h-44"
      maxXAxisLabels={4}
      showYAxis={false}
      formatValue={(value) => String(Math.round(value))}
    />
  );
}
