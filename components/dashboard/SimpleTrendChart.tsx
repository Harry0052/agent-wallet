import { calicoTheme } from "@/styles/theme";
import { dashboardInsetStyle } from "@/components/dashboard/dashboardStyles";

interface SeriesConfig {
  key: string;
  stroke: string;
  fill?: string;
  strokeWidth?: number;
}

interface SimpleTrendChartProps<T extends object = Record<string, unknown>> {
  data: T[];
  xKey: string;
  series: SeriesConfig[];
  heightClassName?: string;
  maxXAxisLabels?: number;
  showYAxis?: boolean;
  formatValue?: (value: number) => string;
}

function buildTicks(minValue: number, maxValue: number, count = 4): number[] {
  const range = Math.max(maxValue - minValue, 1);
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    return maxValue - ratio * range;
  });
}

function getRowValue(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function sampleXAxisLabels<T extends object>(data: T[], xKey: string, maxLabels: number) {
  if (data.length <= maxLabels) {
    return data.map((item, index) => ({
      id: `${String(getRowValue(item, xKey) ?? index)}-${index}`,
      label: String(getRowValue(item, xKey) ?? ""),
    }));
  }

  const lastIndex = data.length - 1;
  const sampled = new Map<number, string>();
  for (let index = 0; index < maxLabels; index += 1) {
    const dataIndex = Math.round((lastIndex * index) / (maxLabels - 1));
    const labelValue = data[dataIndex] ? getRowValue(data[dataIndex], xKey) : "";
    sampled.set(dataIndex, String(labelValue ?? ""));
  }

  return [...sampled.entries()].map(([index, label]) => ({
    id: `${label}-${index}`,
    label,
  }));
}

export function SimpleTrendChart<T extends object>({
  data,
  xKey,
  series,
  heightClassName = "h-56",
  maxXAxisLabels = 6,
  showYAxis = true,
  formatValue = (value) => String(Math.round(value)),
}: SimpleTrendChartProps<T>) {
  const chartWidth = 100;
  const chartHeight = 64;
  const paddingX = 8;
  const paddingY = 8;
  const allValues = data.flatMap((row) =>
    series
      .map((item) => Number(getRowValue(row, item.key)))
      .filter((value) => Number.isFinite(value)),
  );
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const hasVariance = rawMax !== rawMin;
  const variancePadding = hasVariance
    ? Math.max((rawMax - rawMin) * 0.08, 1)
    : Math.max(Math.abs(rawMax) * 0.08, 1);
  const domainMin = rawMin - variancePadding;
  const domainMax = rawMax + variancePadding;
  const range = Math.max(domainMax - domainMin, 1);
  const usableWidth = chartWidth - paddingX * 2;
  const usableHeight = chartHeight - paddingY * 2;
  const ticks = buildTicks(domainMin, domainMax);
  const xAxisLabels = sampleXAxisLabels(data, xKey, maxXAxisLabels);

  const seriesPaths = series.map((item) => {
    const points = data.map((row, index) => {
      const numericValue = Number(getRowValue(row, item.key) ?? 0);
      const x = data.length === 1
        ? chartWidth / 2
        : paddingX + (usableWidth * index) / (data.length - 1);
      const y = paddingY + ((domainMax - numericValue) / range) * usableHeight;
      return { x, y, value: numericValue };
    });

    const line = points.map((point) => `${point.x},${point.y}`).join(" ");
    const fill = item.fill
      ? `${line} ${points[points.length - 1]?.x ?? chartWidth - paddingX},${chartHeight - paddingY} ${points[0]?.x ?? paddingX},${chartHeight - paddingY}`
      : null;

    return {
      ...item,
      points,
      line,
      fill,
    };
  });

  return (
    <div style={dashboardInsetStyle} className={`rounded-[20px] p-3 ${heightClassName}`}>
      <div className={`grid h-full gap-3 ${showYAxis ? "md:grid-cols-[72px_minmax(0,1fr)]" : ""}`}>
        {showYAxis ? (
          <div className="hidden h-full flex-col justify-between py-1 text-[11px] text-[var(--calico-text-muted)] md:flex">
            {ticks.map((tick) => (
              <span key={tick} className="truncate">
                {formatValue(tick)}
              </span>
            ))}
          </div>
        ) : null}

        <div className="min-w-0">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="none"
            className="h-[calc(100%-28px)] min-h-[160px] w-full"
            aria-hidden="true"
          >
            {ticks.map((tick) => {
              const y = paddingY + ((domainMax - tick) / range) * usableHeight;
              return (
                <line
                  key={tick}
                  x1={paddingX}
                  x2={chartWidth - paddingX}
                  y1={y}
                  y2={y}
                  stroke={calicoTheme.border}
                  strokeWidth="0.6"
                />
              );
            })}

            {seriesPaths.map((item) => (
              item.fill ? (
                <polygon
                  key={`${item.key}-fill`}
                  points={item.fill}
                  fill={item.fill ? item.fill : "transparent"}
                  opacity="0.18"
                />
              ) : null
            ))}

            {seriesPaths.map((item) => (
              <polyline
                key={item.key}
                fill="none"
                stroke={item.stroke}
                strokeWidth={item.strokeWidth ?? 2.4}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={item.line}
              />
            ))}

            {seriesPaths.map((item) =>
              item.points.map((point, index) => (
                <circle
                  key={`${item.key}-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="1.3"
                  fill={item.stroke}
                />
              ))
            )}
          </svg>

          <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[var(--calico-text-muted)]">
            {xAxisLabels.map((item) => (
              <span key={item.id} className="truncate">
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
