"use client";

import { useMemo } from "react";
import { fmt } from "@/lib/utils";

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
  categoryBreakdown: Array<{ category: string; amount: number }>;
  incomeBreakdown?: Array<{ source: string; amount: number }>;
}

const COLORS = {
  income: "#16A34A",
  expense: "#E8A45E",
  savings: "#60A5FA",
  hub: "#9B8B7B",
};

const CATEGORY_COLORS: Record<string, string> = {
  "food & dining": "#D97706",
  food: "#D97706",
  dining: "#D97706",
  groceries: "#D97706",
  housing: "#7C3AED",
  rent: "#7C3AED",
  mortgage: "#7C3AED",
  transportation: "#2563EB",
  transport: "#2563EB",
  shopping: "#DB2777",
  entertainment: "#DB2777",
  utilities: "#4F46E5",
  bills: "#4F46E5",
  health: "#059669",
  healthcare: "#059669",
  education: "#0D9488",
  personal: "#EA580C",
  transfer: "#94A3B8",
  savings: "#60A5FA",
  investment: "#60A5FA",
  insurance: "#7C3AED",
  subscriptions: "#9333EA",
  travel: "#0284C7",
};

function getCategoryColor(category: string): string {
  const lower = category.toLowerCase();
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "#C4A882";
}

function formatLabel(label: string): string {
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildFlowPath(
  x1: number,
  y1Top: number,
  y1Bottom: number,
  x2: number,
  y2Top: number,
  y2Bottom: number,
): string {
  const midX = (x1 + x2) / 2;
  return [
    `M ${x1},${y1Top}`,
    `C ${midX},${y1Top} ${midX},${y2Top} ${x2},${y2Top}`,
    `L ${x2},${y2Bottom}`,
    `C ${midX},${y2Bottom} ${midX},${y1Bottom} ${x1},${y1Bottom}`,
    "Z",
  ].join(" ");
}

export function SankeyDiagram({ income, expenses, categoryBreakdown, incomeBreakdown }: SankeyProps) {
  const data = useMemo(() => {
    const savings = Math.max(income - expenses, 0);
    const sorted = [...categoryBreakdown].sort((a, b) => b.amount - a.amount);
    const topCategories = sorted.slice(0, 5);
    const otherAmount = sorted.slice(5).reduce((s, c) => s + c.amount, 0);
    if (otherAmount > 0) {
      topCategories.push({ category: "Other", amount: otherAmount });
    }

    const incomeSources =
      incomeBreakdown && incomeBreakdown.length > 1
        ? incomeBreakdown.sort((a, b) => b.amount - a.amount).slice(0, 3)
        : [{ source: "Income", amount: income }];

    return { savings, topCategories, incomeSources };
  }, [income, expenses, categoryBreakdown, incomeBreakdown]);

  // Layout constants — refined proportions
  const width = 720;
  const height = 340;
  const pad = { top: 28, bottom: 16, left: 16, right: 16 };
  const nodeW = 4;
  const nodeR = 2;
  const colLeft = pad.left;
  const colCenter = width / 2 - nodeW / 2;
  const colRight = width - pad.right - nodeW;
  const usableH = height - pad.top - pad.bottom;

  const { nodes, flowPaths } = useMemo(() => {
    const nodeList: SankeyNode[] = [];

    if (income <= 0 && expenses <= 0) return { nodes: nodeList, flowPaths: [] as JSX.Element[] };

    // Center hub
    const hubH = usableH * 0.55;
    const hubY = pad.top + (usableH - hubH) / 2;
    nodeList.push({
      id: "hub",
      label: "Total",
      value: income,
      x: colCenter,
      y: hubY,
      height: hubH,
      color: COLORS.hub,
      side: "center",
    });

    // Left: income sources
    const leftGap = 10;
    const leftTotalGap = leftGap * (data.incomeSources.length - 1);
    const leftNodeTotal = hubH - leftTotalGap;
    let leftY = hubY;

    for (const source of data.incomeSources) {
      const ratio = income > 0 ? source.amount / income : 0;
      const h = Math.max(leftNodeTotal * ratio, 4);
      nodeList.push({
        id: `income-${source.source}`,
        label: source.source,
        value: source.amount,
        x: colLeft,
        y: leftY,
        height: h,
        color: COLORS.income,
        side: "left",
      });
      leftY += h + leftGap;
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
        ? [{ id: "savings", label: "Net Remaining", value: data.savings, color: COLORS.savings }]
        : []),
    ];

    const rightGap = 8;
    const rightTotalGap = rightGap * Math.max(rightItems.length - 1, 0);
    const rightAvailH = usableH - 8;
    const rightNodeTotal = rightAvailH - rightTotalGap;
    const rightSum = rightItems.reduce((s, i) => s + i.value, 0);
    let rightY = pad.top + 4;

    for (const item of rightItems) {
      const ratio = rightSum > 0 ? item.value / rightSum : 0;
      const h = Math.max(rightNodeTotal * ratio, 4);
      nodeList.push({
        id: item.id,
        label: item.label,
        value: item.value,
        x: colRight,
        y: rightY,
        height: h,
        color: item.color,
        side: "right",
      });
      rightY += h + rightGap;
    }

    // Build flow paths with proper thickness
    const nodeMap = new Map(nodeList.map((n) => [n.id, n]));
    const hub = nodeMap.get("hub")!;
    let hubLeftOff = 0;
    let hubRightOff = 0;

    const paths: JSX.Element[] = [];

    // Income flows (left → center)
    for (const source of data.incomeSources) {
      const from = nodeMap.get(`income-${source.source}`);
      if (!from) continue;
      const thickness = Math.max((source.amount / (income || 1)) * hub.height * 0.6, 1);

      const path = buildFlowPath(
        from.x + nodeW,
        from.y + from.height / 2 - thickness / 2,
        from.y + from.height / 2 + thickness / 2,
        hub.x,
        hub.y + hubLeftOff,
        hub.y + hubLeftOff + thickness,
      );
      hubLeftOff += thickness + 1.5;

      paths.push(
        <path
          key={`flow-income-${source.source}`}
          d={path}
          fill={COLORS.income}
          fillOpacity={0.07}
          stroke={COLORS.income}
          strokeWidth={0.5}
          strokeOpacity={0.15}
        />,
      );
    }

    // Expense + savings flows (center → right)
    for (const item of rightItems) {
      const to = nodeMap.get(item.id);
      if (!to) continue;
      const thickness = Math.max((item.value / (rightSum || 1)) * hub.height * 0.6, 1);

      const path = buildFlowPath(
        hub.x + nodeW,
        hub.y + hubRightOff,
        hub.y + hubRightOff + thickness,
        to.x,
        to.y + to.height / 2 - thickness / 2,
        to.y + to.height / 2 + thickness / 2,
      );
      hubRightOff += thickness + 1.5;

      paths.push(
        <path
          key={`flow-${item.id}`}
          d={path}
          fill={item.color}
          fillOpacity={0.06}
          stroke={item.color}
          strokeWidth={0.5}
          strokeOpacity={0.12}
        />,
      );
    }

    return { nodes: nodeList, flowPaths: paths };
  }, [data, income, expenses, usableH, colLeft, colCenter, colRight, pad.top]);

  if (income <= 0 && expenses <= 0) return null;

  return (
    <div className="overflow-x-auto">
      {/* Stage headers */}
      <div className="mb-2 grid grid-cols-3 px-4 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">
        <span>Income</span>
        <span className="text-center">Total</span>
        <span className="text-right">Where it goes</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ minHeight: 260, maxHeight: 380 }}
        aria-label="Cash flow diagram"
        role="img"
      >
        {/* Flow bands */}
        {flowPaths}

        {/* Node pillars */}
        {nodes.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={nodeW}
              height={node.height}
              rx={nodeR}
              fill={node.color}
              fillOpacity={node.side === "center" ? 0.25 : 0.5}
            />

            {/* Left labels: right of node */}
            {node.side === "left" && (
              <>
                <text
                  x={node.x + nodeW + 8}
                  y={node.y + node.height / 2 - 5}
                  fill="var(--aw-text)"
                  fontSize="10"
                  fontWeight="500"
                >
                  {formatLabel(node.label)}
                </text>
                <text
                  x={node.x + nodeW + 8}
                  y={node.y + node.height / 2 + 8}
                  fill="var(--aw-text-muted)"
                  fontSize="10"
                  className="tabular-nums"
                >
                  {fmt(node.value)}
                </text>
              </>
            )}

            {/* Center label: above node */}
            {node.side === "center" && (
              <text
                x={node.x + nodeW / 2}
                y={node.y - 8}
                fill="var(--aw-text)"
                fontSize="11"
                fontWeight="600"
                textAnchor="middle"
                className="tabular-nums"
              >
                {fmt(node.value)}
              </text>
            )}

            {/* Right labels: left of node */}
            {node.side === "right" && (
              <>
                <text
                  x={node.x - 8}
                  y={node.y + node.height / 2 - 5}
                  fill="var(--aw-text)"
                  fontSize="10"
                  fontWeight="500"
                  textAnchor="end"
                >
                  {formatLabel(node.label)}
                </text>
                <text
                  x={node.x - 8}
                  y={node.y + node.height / 2 + 8}
                  fill="var(--aw-text-muted)"
                  fontSize="10"
                  textAnchor="end"
                  className="tabular-nums"
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
