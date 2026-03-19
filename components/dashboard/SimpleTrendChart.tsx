import { calicoTheme } from "@/styles/theme";

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

/** Convert polyline points to a smooth cubic bezier SVG path for softer curves */
function toSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) {
    return points.length === 1 ? `M ${points[0].x},${points[0].y}` : "";
  }

  let path = `M ${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) / 2;
    path += ` C ${midX},${curr.y} ${midX},${next.y} ${next.x},${next.y}`;
  }

  return path;
}

/** Build a closed area path for gradient fill beneath a smooth curve */
function toSmoothAreaPath(
  points: Array<{ x: number; y: number }>,
  baselineY: number,
): string {
  if (points.length < 2) return "";
  const curvePath = toSmoothPath(points);
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  return `${curvePath} L ${lastPoint.x},${baselineY} L ${firstPoint.x},${baselineY} Z`;
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
  const paddingY = 6;
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
  const ticks = buildTicks(domainMin, domainMax, 3);
  const xAxisLabels = sampleXAxisLabels(data, xKey, maxXAxisLabels);
  const baselineY = chartHeight - paddingY;

  const seriesPaths = series.map((item) => {
    const points = data.map((row, index) => {
      const numericValue = Number(getRowValue(row, item.key) ?? 0);
      const x = data.length === 1
        ? chartWidth / 2
        : paddingX + (usableWidth * index) / (data.length - 1);
      const y = paddingY + ((domainMax - numericValue) / range) * usableHeight;
      return { x, y, value: numericValue };
    });

    const smoothPath = toSmoothPath(points);
    const areaPath = item.fill ? toSmoothAreaPath(points, baselineY) : null;

    return {
      ...item,
      points,
      smoothPath,
      areaPath,
    };
  });

  const gradientId = (key: string) => `calico-gradient-${key}`;

  return (
    <div className={`rounded-2xl bg-[var(--aw-surface-1)] p-3 ${heightClassName}`}>
      <div className={`grid h-full gap-3 ${showYAxis ? "md:grid-cols-[56px_minmax(0,1fr)]" : ""}`}>
        {showYAxis ? (
          <div className="hidden h-full flex-col justify-between py-1 text-[10px] font-medium tabular-nums text-[var(--aw-text-muted)]/70 md:flex">
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
            className="h-[calc(100%-24px)] min-h-[160px] w-full"
            aria-hidden="true"
          >
            <defs>
              {seriesPaths.map((item) =>
                item.fill ? (
                  <linearGradient
                    key={gradientId(item.key)}
                    id={gradientId(item.key)}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={item.fill} stopOpacity="0.18" />
                    <stop offset="100%" stopColor={item.fill} stopOpacity="0.02" />
                  </linearGradient>
                ) : null
              )}
            </defs>

            {/* Subtle gridlines — only horizontal, very light */}
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
                  strokeWidth="0.35"
                  strokeDasharray="1.5 2"
                />
              );
            })}

            {/* Gradient fill areas */}
            {seriesPaths.map((item) =>
              item.areaPath ? (
                <path
                  key={`${item.key}-area`}
                  d={item.areaPath}
                  fill={`url(#${gradientId(item.key)})`}
                />
              ) : null
            )}

            {/* Smooth curve lines */}
            {seriesPaths.map((item) => (
              <path
                key={item.key}
                d={item.smoothPath}
                fill="none"
                stroke={item.stroke}
                strokeWidth={item.strokeWidth ?? 2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* Endpoint dots only (first + last) for cleaner look */}
            {seriesPaths.map((item) => {
              const endpoints = [item.points[0], item.points[item.points.length - 1]].filter(Boolean);
              return endpoints.map((point, index) => (
                <circle
                  key={`${item.key}-dot-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="1.4"
                  fill="var(--aw-surface-1)"
                  stroke={item.stroke}
                  strokeWidth="0.9"
                />
              ));
            })}
          </svg>

          <div className="flex items-center justify-between gap-1 pt-2 text-[10px] font-medium text-[var(--aw-text-muted)]/60">
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
