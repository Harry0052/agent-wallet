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

function buildTicks(minValue: number, maxValue: number, count = 3): number[] {
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

/** Attempt a Catmull-Rom-to-Bezier interpolation for very smooth, flowing curves */
function toSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  // Catmull-Rom → cubic bezier with tension 0 (uniform)
  const tension = 0.3;
  let path = `M ${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return path;
}

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
  const chartHeight = 60;
  const paddingX = 6;
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
    ? Math.max((rawMax - rawMin) * 0.1, 1)
    : Math.max(Math.abs(rawMax) * 0.1, 1);
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
    <div className={`rounded-2xl bg-[var(--aw-surface-1)] px-4 py-3 ${heightClassName}`}>
      <div className={`grid h-full gap-2 ${showYAxis ? "md:grid-cols-[48px_minmax(0,1fr)]" : ""}`}>
        {showYAxis ? (
          <div className="hidden h-full flex-col justify-between py-1 text-[10px] font-medium tabular-nums text-[var(--aw-text-muted)]/50 md:flex">
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
            className="h-[calc(100%-20px)] min-h-[160px] w-full"
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
                    <stop offset="0%" stopColor={item.fill} stopOpacity="0.32" />
                    <stop offset="60%" stopColor={item.fill} stopOpacity="0.08" />
                    <stop offset="100%" stopColor={item.fill} stopOpacity="0" />
                  </linearGradient>
                ) : null
              )}
              {/* Glow filter for endpoint dots */}
              <filter id="calico-dot-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="1.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Very subtle gridlines — barely visible */}
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
                  strokeWidth="0.25"
                  opacity="0.5"
                />
              );
            })}

            {/* Rich gradient area fills */}
            {seriesPaths.map((item) =>
              item.areaPath ? (
                <path
                  key={`${item.key}-area`}
                  d={item.areaPath}
                  fill={`url(#${gradientId(item.key)})`}
                />
              ) : null
            )}

            {/* Smooth flowing curve lines */}
            {seriesPaths.map((item) => (
              <path
                key={item.key}
                d={item.smoothPath}
                fill="none"
                stroke={item.stroke}
                strokeWidth={item.strokeWidth ?? 2.2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* Last-point callout with glow dot + value label */}
            {seriesPaths.map((item) => {
              const lastPoint = item.points[item.points.length - 1];
              if (!lastPoint) return null;
              return (
                <g key={`${item.key}-callout`}>
                  {/* Glow ring */}
                  <circle
                    cx={lastPoint.x}
                    cy={lastPoint.y}
                    r="3"
                    fill={item.stroke}
                    opacity="0.15"
                  />
                  {/* Outer ring */}
                  <circle
                    cx={lastPoint.x}
                    cy={lastPoint.y}
                    r="2"
                    fill="var(--aw-surface-1)"
                    stroke={item.stroke}
                    strokeWidth="1"
                    filter="url(#calico-dot-glow)"
                  />
                  {/* Inner dot */}
                  <circle
                    cx={lastPoint.x}
                    cy={lastPoint.y}
                    r="0.8"
                    fill={item.stroke}
                  />
                  {/* Value label */}
                  <text
                    x={lastPoint.x}
                    y={lastPoint.y - 4}
                    textAnchor="middle"
                    fill={item.stroke}
                    fontSize="3.2"
                    fontWeight="600"
                    fontFamily="inherit"
                  >
                    {formatValue(lastPoint.value)}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="flex items-center justify-between gap-1 pt-1.5 text-[10px] font-medium text-[var(--aw-text-muted)]/50">
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
