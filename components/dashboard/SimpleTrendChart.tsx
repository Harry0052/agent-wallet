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
  /** Optional Y-axis unit label shown at the top of the Y axis (e.g. "$") */
  yAxisUnit?: string;
  /** Optional X-axis context label shown at the bottom-right (e.g. "Day of month") */
  xAxisLabel?: string;
}

function getRowValue(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function sampleXAxisLabels<T extends object>(data: T[], xKey: string, maxLabels: number) {
  if (data.length <= maxLabels) {
    return data.map((item, index) => ({
      index,
      label: String(getRowValue(item, xKey) ?? ""),
    }));
  }

  const lastIndex = data.length - 1;
  const sampled: Array<{ index: number; label: string }> = [];
  for (let i = 0; i < maxLabels; i += 1) {
    const dataIndex = Math.round((lastIndex * i) / (maxLabels - 1));
    const labelValue = data[dataIndex] ? getRowValue(data[dataIndex], xKey) : "";
    sampled.push({ index: dataIndex, label: String(labelValue ?? "") });
  }
  return sampled;
}

function fmtAxisValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `$${(value / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

export function SimpleTrendChart<T extends object>({
  data,
  xKey,
  series,
  heightClassName = "h-56",
  maxXAxisLabels = 6,
  showYAxis = true,
  formatValue: _formatValue = (value: number) => String(Math.round(value)),
  yAxisUnit,
  xAxisLabel,
}: SimpleTrendChartProps<T>) {
  if (data.length === 0) return null;

  // Use a real coordinate system (not viewBox with preserveAspectRatio="none")
  // This prevents non-uniform stroke scaling
  const chartWidth = 480;
  const chartHeight = 200;
  const paddingLeft = showYAxis ? 44 : 8;
  const paddingRight = 12;
  const paddingTop = 16;
  const paddingBottom = 24;

  const allValues = data.flatMap((row) =>
    series
      .map((item) => Number(getRowValue(row, item.key)))
      .filter((value) => Number.isFinite(value)),
  );
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const hasVariance = rawMax !== rawMin;
  const pad = hasVariance
    ? (rawMax - rawMin) * 0.15
    : Math.max(Math.abs(rawMax) * 0.1, 10);
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;
  const range = Math.max(domainMax - domainMin, 1);

  const usableWidth = chartWidth - paddingLeft - paddingRight;
  const usableHeight = chartHeight - paddingTop - paddingBottom;
  const baselineY = paddingTop + usableHeight;

  // Build Y-axis ticks (3 ticks, rounded to clean values)
  const tickCount = 3;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const ratio = i / (tickCount - 1);
    return domainMax - ratio * range;
  });

  const xAxisLabels = sampleXAxisLabels(data, xKey, maxXAxisLabels);

  // Build series paths using linear interpolation (honest, no overshoot)
  const seriesPaths = series.map((item) => {
    const points = data.map((row, index) => {
      const numericValue = Number(getRowValue(row, item.key) ?? 0);
      const x = data.length === 1
        ? paddingLeft + usableWidth / 2
        : paddingLeft + (usableWidth * index) / (data.length - 1);
      const y = paddingTop + ((domainMax - numericValue) / range) * usableHeight;
      return { x, y, value: numericValue };
    });

    // Linear path — no Catmull-Rom overshoot
    let linePath = "";
    for (let i = 0; i < points.length; i++) {
      linePath += i === 0 ? `M ${points[i].x},${points[i].y}` : ` L ${points[i].x},${points[i].y}`;
    }

    let areaPath: string | null = null;
    if (item.fill && points.length >= 2) {
      const last = points[points.length - 1];
      const first = points[0];
      areaPath = `${linePath} L ${last.x},${baselineY} L ${first.x},${baselineY} Z`;
    }

    return { ...item, points, linePath, areaPath };
  });

  const gradientId = (key: string) => `calico-gradient-${key}`;

  return (
    <div className={heightClassName}>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="h-full w-full"
        aria-hidden="true"
      >
        <defs>
          {seriesPaths.map((item) =>
            item.fill ? (
              <linearGradient
                key={gradientId(item.key)}
                id={gradientId(item.key)}
                x1="0" y1="0" x2="0" y2="1"
              >
                <stop offset="0%" stopColor={item.fill} stopOpacity="0.12" />
                <stop offset="100%" stopColor={item.fill} stopOpacity="0" />
              </linearGradient>
            ) : null,
          )}
        </defs>

        {/* Gridlines — subtle dashed */}
        {ticks.map((tick) => {
          const y = paddingTop + ((domainMax - tick) / range) * usableHeight;
          return (
            <line
              key={tick}
              x1={paddingLeft}
              x2={chartWidth - paddingRight}
              y1={y}
              y2={y}
              stroke={calicoTheme.border}
              strokeWidth="0.5"
              strokeDasharray="4 4"
              opacity="0.35"
            />
          );
        })}

        {/* Y-axis labels */}
        {showYAxis
          ? ticks.map((tick) => {
              const y = paddingTop + ((domainMax - tick) / range) * usableHeight;
              return (
                <text
                  key={`y-${tick}`}
                  x={paddingLeft - 6}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="9"
                  fill="#9B8B7B"
                  fontFamily="inherit"
                >
                  {fmtAxisValue(tick)}
                </text>
              );
            })
          : null}

        {/* Area fills */}
        {seriesPaths.map((item) =>
          item.areaPath ? (
            <path
              key={`${item.key}-area`}
              d={item.areaPath}
              fill={`url(#${gradientId(item.key)})`}
            />
          ) : null,
        )}

        {/* Lines — thin and clean */}
        {seriesPaths.map((item) => (
          <path
            key={item.key}
            d={item.linePath}
            fill="none"
            stroke={item.stroke}
            strokeWidth={Math.min(item.strokeWidth ?? 1, 1.2)}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* X-axis labels */}
        {xAxisLabels.map((item) => {
          const x = data.length === 1
            ? paddingLeft + usableWidth / 2
            : paddingLeft + (usableWidth * item.index) / (data.length - 1);
          return (
            <text
              key={`x-${item.index}`}
              x={x}
              y={chartHeight - 4}
              textAnchor="middle"
              fontSize="9"
              fill="#9B8B7B"
              fontFamily="inherit"
            >
              {item.label}
            </text>
          );
        })}

        {/* Y-axis unit label (top of Y axis) */}
        {yAxisUnit && showYAxis ? (
          <text
            x={paddingLeft - 6}
            y={paddingTop - 6}
            textAnchor="end"
            fontSize="8"
            fill="#B0A090"
            fontFamily="inherit"
            fontWeight="500"
          >
            {yAxisUnit}
          </text>
        ) : null}

        {/* X-axis context label (bottom-right) */}
        {xAxisLabel ? (
          <text
            x={chartWidth - paddingRight}
            y={chartHeight - 4}
            textAnchor="end"
            fontSize="8"
            fill="#B0A090"
            fontFamily="inherit"
          >
            {xAxisLabel}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
