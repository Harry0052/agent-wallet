"use client";

import { useMemo } from "react";
import { fmt } from "@/lib/utils";

interface SankeyFlow {
  from: string;
  to: string;
  value: number;
  color: string;
}

interface SankeyNode {
  id: string;
  label: string;
  value: number;
  x: number;
  y: number;
  height: number;
  color: string;
  side: "left" | "center" | "right";
}

interface SankeyProps {
  income: number;
  expenses: number;
  /** Category breakdown: { category: string; amount: number }[] */
  categoryBreakdown: Array<{ category: string; amount: number }>;
  /** Income source breakdown (optional) */
  incomeBreakdown?: Array<{ source: string; amount: number }>;
}

const COLORS = {
  income: "#16A34A",
  incomeSoft: "rgba(22, 163, 74, 0.12)",
  expense: "#FDBA74",
  expenseSoft: "rgba(253, 186, 116, 0.10)",
  savings: "#60A5FA",
  savingsSoft: "rgba(96, 165, 250, 0.12)",
  hub: "#FDBA74",
  hubSoft: "rgba(253, 186, 116, 0.15)",
};

const CATEGORY_COLORS: Record<string, string> = {
  "food & dining": "#F59E0B",
  "food": "#F59E0B",
  "dining": "#F59E0B",
  "groceries": "#F59E0B",
  "housing": "#8B5CF6",
  "rent": "#8B5CF6",
  "mortgage": "#8B5CF6",
  "transportation": "#3B82F6",
  "transport": "#3B82F6",
  "shopping": "#EC4899",
  "entertainment": "#EC4899",
  "utilities": "#6366F1",
  "bills": "#6366F1",
  "health": "#10B981",
  "healthcare": "#10B981",
  "education": "#14B8A6",
  "personal": "#F97316",
  "transfer": "#94A3B8",
  "savings": "#60A5FA",
  "investment": "#60A5FA",
  "insurance": "#8B5CF6",
  "subscriptions": "#A855F7",
  "travel": "#0EA5E9",
};

function getCategoryColor(category: string): string {
  const lower = category.toLowerCase();
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "#FDBA74";
}

function buildCubicPath(
  x1: number, y1: number,
  x2: number, y2: number,
): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1},${y1} C ${midX},${y1} ${midX},${y2} ${x2},${y2}`;
}

export function SankeyDiagram({ income, expenses, categoryBreakdown, incomeBreakdown }: SankeyProps) {
  const data = useMemo(() => {
    const savings = Math.max(income - expenses, 0);
    const totalOut = expenses + savings;

    // Sort categories by amount descending, cap at top 6
    const sorted = [...categoryBreakdown]
      .sort((a, b) => b.amount - a.amount);
    const topCategories = sorted.slice(0, 6);
    const otherAmount = sorted.slice(6).reduce((s, c) => s + c.amount, 0);
    if (otherAmount > 0) {
      topCategories.push({ category: "Other", amount: otherAmount });
    }

    // Income sources (top 4 or "All Income")
    const incomeSources = incomeBreakdown && incomeBreakdown.length > 1
      ? incomeBreakdown.sort((a, b) => b.amount - a.amount).slice(0, 4)
      : [{ source: "Income", amount: income }];

    return { savings, totalOut, topCategories, incomeSources };
  }, [income, expenses, categoryBreakdown, incomeBreakdown]);

  // SVG dimensions
  const width = 760;
  const height = 400;
  const padding = { top: 24, bottom: 24, left: 16, right: 16 };
  const nodeWidth = 14;
  const nodeRadius = 7;
  const colLeft = padding.left;
  const colCenter = width / 2 - nodeWidth / 2;
  const colRight = width - padding.right - nodeWidth;
  const usableHeight = height - padding.top - padding.bottom;

  const { nodes, flows } = useMemo(() => {
    const nodeList: SankeyNode[] = [];
    const flowList: SankeyFlow[] = [];

    if (income <= 0 && expenses <= 0) return { nodes: nodeList, flows: flowList };

    // Center hub node
    const hubHeight = usableHeight * 0.6;
    const hubY = padding.top + (usableHeight - hubHeight) / 2;
    nodeList.push({
      id: "hub",
      label: "Total",
      value: income,
      x: colCenter,
      y: hubY,
      height: hubHeight,
      color: COLORS.hub,
      side: "center",
    });

    // Left: income sources
    const leftGap = 8;
    const leftTotalGap = leftGap * (data.incomeSources.length - 1);
    const leftAvailableHeight = hubHeight;
    const leftNodeTotalHeight = leftAvailableHeight - leftTotalGap;
    let leftY = hubY;

    for (const source of data.incomeSources) {
      const ratio = income > 0 ? source.amount / income : 0;
      const nodeHeight = Math.max(leftNodeTotalHeight * ratio, 6);
      nodeList.push({
        id: `income-${source.source}`,
        label: source.source,
        value: source.amount,
        x: colLeft,
        y: leftY,
        height: nodeHeight,
        color: COLORS.income,
        side: "left",
      });
      flowList.push({
        from: `income-${source.source}`,
        to: "hub",
        value: source.amount,
        color: COLORS.income,
      });
      leftY += nodeHeight + leftGap;
    }

    // Right: expense categories + savings
    const rightItems = [
      ...data.topCategories.map((c) => ({
        id: `expense-${c.category}`,
        label: c.category,
        value: c.amount,
        color: getCategoryColor(c.category),
      })),
      ...(data.savings > 0
        ? [{
          id: "savings",
          label: "Savings",
          value: data.savings,
          color: COLORS.savings,
        }]
        : []),
    ];

    const rightGap = 6;
    const rightTotalGap = rightGap * Math.max(rightItems.length - 1, 0);
    const rightAvailableHeight = usableHeight - 16;
    const rightNodeTotalHeight = rightAvailableHeight - rightTotalGap;
    const rightTotal = rightItems.reduce((s, i) => s + i.value, 0);
    let rightY = padding.top + 8;

    for (const item of rightItems) {
      const ratio = rightTotal > 0 ? item.value / rightTotal : 0;
      const nodeHeight = Math.max(rightNodeTotalHeight * ratio, 6);
      nodeList.push({
        id: item.id,
        label: item.label,
        value: item.value,
        x: colRight,
        y: rightY,
        height: nodeHeight,
        color: item.color,
        side: "right",
      });
      flowList.push({
        from: "hub",
        to: item.id,
        value: item.value,
        color: item.color,
      });
      rightY += nodeHeight + rightGap;
    }

    return { nodes: nodeList, flows: flowList };
  }, [data, income, expenses, usableHeight, colLeft, colCenter, colRight, padding.top]);

  // Render flow paths
  const flowPaths = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Track cumulative offsets for stacking flows on the hub
    const hubLeftOffset = { current: 0 };
    const hubRightOffset = { current: 0 };
    const hub = nodeMap.get("hub");

    return flows.map((flow) => {
      const fromNode = nodeMap.get(flow.from);
      const toNode = nodeMap.get(flow.to);
      if (!fromNode || !toNode || !hub) return null;

      const total = flow.from === "hub" ? (nodes.filter((n) => n.side === "right").reduce((s, n) => s + n.value, 0) || 1) : income || 1;
      const thickness = Math.max((flow.value / total) * hub.height * 0.85, 2);

      let x1: number, y1: number, x2: number, y2: number;

      if (flow.to === "hub") {
        // Left → Center
        x1 = fromNode.x + nodeWidth;
        y1 = fromNode.y + fromNode.height / 2;
        x2 = hub.x;
        y2 = hub.y + hubLeftOffset.current + thickness / 2;
        hubLeftOffset.current += thickness + 2;
      } else {
        // Center → Right
        x1 = hub.x + nodeWidth;
        y1 = hub.y + hubRightOffset.current + thickness / 2;
        x2 = toNode.x;
        y2 = toNode.y + toNode.height / 2;
        hubRightOffset.current += thickness + 2;
      }

      const pathD = buildCubicPath(x1, y1, x2, y2);

      return (
        <g key={`${flow.from}-${flow.to}`}>
          <path
            d={pathD}
            fill="none"
            stroke={flow.color}
            strokeWidth={thickness}
            strokeOpacity={0.18}
            strokeLinecap="round"
          />
          <path
            d={pathD}
            fill="none"
            stroke={flow.color}
            strokeWidth={Math.max(thickness * 0.4, 1.5)}
            strokeOpacity={0.5}
            strokeLinecap="round"
          />
        </g>
      );
    });
  }, [flows, nodes, income]);

  if (income <= 0 && expenses <= 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ minHeight: 300, maxHeight: 420 }}
        aria-label="Cash flow Sankey diagram"
        role="img"
      >
        <defs>
          {nodes.map((node) => (
            <linearGradient
              key={`grad-${node.id}`}
              id={`sankey-grad-${node.id}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={node.color} stopOpacity="0.9" />
              <stop offset="100%" stopColor={node.color} stopOpacity="0.6" />
            </linearGradient>
          ))}
        </defs>

        {/* Flow paths */}
        {flowPaths}

        {/* Nodes */}
        {nodes.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={nodeWidth}
              height={node.height}
              rx={nodeRadius}
              fill={`url(#sankey-grad-${node.id})`}
            />
            {/* Label */}
            {node.side === "left" && (
              <>
                <text
                  x={node.x + nodeWidth + 10}
                  y={node.y + node.height / 2 - 6}
                  fill="var(--aw-text)"
                  fontSize="11"
                  fontWeight="600"
                  dominantBaseline="auto"
                >
                  {node.label}
                </text>
                <text
                  x={node.x + nodeWidth + 10}
                  y={node.y + node.height / 2 + 8}
                  fill="var(--aw-text-muted)"
                  fontSize="10"
                  fontWeight="500"
                  dominantBaseline="auto"
                >
                  {fmt(node.value)}
                </text>
              </>
            )}
            {node.side === "center" && (
              <>
                <text
                  x={node.x + nodeWidth / 2}
                  y={node.y - 8}
                  fill="var(--aw-text)"
                  fontSize="11"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {fmt(node.value)}
                </text>
              </>
            )}
            {node.side === "right" && (
              <>
                <text
                  x={node.x - 10}
                  y={node.y + node.height / 2 - 6}
                  fill="var(--aw-text)"
                  fontSize="11"
                  fontWeight="600"
                  textAnchor="end"
                  dominantBaseline="auto"
                >
                  {node.label}
                </text>
                <text
                  x={node.x - 10}
                  y={node.y + node.height / 2 + 8}
                  fill="var(--aw-text-muted)"
                  fontSize="10"
                  fontWeight="500"
                  textAnchor="end"
                  dominantBaseline="auto"
                >
                  {fmt(node.value)}
                </text>
              </>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
