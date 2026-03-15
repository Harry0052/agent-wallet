"use client";

import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmt } from "@/lib/utils";
import {
  ToolbarButton,
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import {
  ManualEntryButton,
  ManualEntryModal,
} from "@/components/finance/ManualDataControls";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import {
  MANUAL_STORAGE_KEYS,
  type ManualInvestmentHolding,
  type ManualNetWorthItem,
} from "@/lib/manualMode";

type InvestmentsTab = "holdings" | "allocation";

type HoldingRow = ManualInvestmentHolding;

interface ChartPoint {
  label: string;
  portfolio: number;
  benchmark: number;
}

const BENCHMARK_SERIES = [100, 101, 99, 103, 102, 105, 104, 106];

function toHolding(holding: HoldingRow): HoldingRow {
  const quantity = Number.isFinite(holding.quantity)
    ? Number(holding.quantity)
    : Number.isFinite(holding.shares)
      ? Number(holding.shares)
      : 0;

  const currentValueFromFields =
    Number.isFinite(holding.currentValue)
      ? Number(holding.currentValue)
      : Number.isFinite(holding.value)
        ? Number(holding.value)
        : Number.isFinite(holding.averageCost)
          ? quantity * Number(holding.averageCost)
          : 0;

  return {
    ...holding,
    name: (holding.name || "").trim() || "Untitled asset",
    symbol: (holding.symbol || "").trim() || (holding.ticker || "").trim().toUpperCase(),
    ticker: (holding.ticker || "").trim().toUpperCase() || undefined,
    quantity,
    shares: quantity,
    averageCost: Number.isFinite(holding.averageCost) ? Number(holding.averageCost) : undefined,
    currentValue: Math.max(0, currentValueFromFields),
    value: Math.max(0, currentValueFromFields),
    accountName: holding.accountName?.trim() || undefined,
    notes: holding.notes?.trim() || undefined,
    sourceType: "manual",
  };
}

function buildPortfolioSeries(totalValue: number, totalCostBasis: number): ChartPoint[] {
  const labels = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Now"];
  const startValue = Math.max(totalCostBasis || totalValue * 0.92, 1);
  const endValue = Math.max(totalValue, 1);

  return labels.map((label, index) => {
    const progress = labels.length === 1 ? 1 : index / (labels.length - 1);
    const smoothed = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    const portfolio = startValue + (endValue - startValue) * smoothed;
    const benchmark = startValue * (BENCHMARK_SERIES[index] / 100);

    return {
      label,
      portfolio: Math.round(portfolio),
      benchmark: Math.round(benchmark),
    };
  });
}

function allocationColor(index: number): string {
  const palette = [
    "var(--aw-chart-primary)",
    "var(--aw-primary-secondary)",
    "var(--aw-chart-secondary)",
    "var(--aw-primary-secondary-soft)",
    "var(--aw-chart-positive)",
    "var(--aw-text-muted)",
  ];
  return palette[index % palette.length];
}

function MetricCard(props: { label: string; value: string; meta: string; tone: string }) {
  return (
    <div className="aw-card aw-card-compact">
      <div className="mb-4 h-1.5 rounded-full bg-[var(--aw-primary-soft)]">
        <div className="h-full rounded-full" style={{ width: "100%", background: props.tone }} />
      </div>
      <p className="text-sm font-semibold text-[var(--aw-text)]">{props.label}</p>
      <p className="aw-number mt-3 text-[28px] leading-none text-[var(--aw-text)]">{props.value}</p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
        {props.meta}
      </p>
    </div>
  );
}

export function InvestmentsView() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<InvestmentsTab>("holdings");

  const [manualHoldings, setManualHoldings] = useLocalStorageState<HoldingRow[]>(
    MANUAL_STORAGE_KEYS.investments,
    [],
  );
  const [, setManualNetWorthItems] = useLocalStorageState<ManualNetWorthItem[]>(
    MANUAL_STORAGE_KEYS.netWorth,
    [],
  );

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [averageCost, setAverageCost] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [accountName, setAccountName] = useState("");
  const [notes, setNotes] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (
      manualHoldings.some(
        (holding) =>
          !Number.isFinite(holding.quantity)
          || !Number.isFinite(holding.currentValue)
          || !holding.name,
      )
    ) {
      setManualHoldings((prev) => prev.map((holding) => toHolding(holding)));
    }
  }, [manualHoldings, setManualHoldings]);

  const holdings = useMemo(() => {
    return manualHoldings.map((holding) => toHolding(holding));
  }, [manualHoldings]);

  const totals = useMemo(() => {
    const totalValue = holdings.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0);
    const totalCostBasis = holdings.reduce((sum, holding) => {
      const qty = holding.quantity ?? holding.shares ?? 0;
      const avg = holding.averageCost ?? 0;
      return sum + qty * avg;
    }, 0);

    const gainLoss = totalValue - totalCostBasis;
    const gainLossPct = totalCostBasis > 0 ? (gainLoss / totalCostBasis) * 100 : 0;

    return {
      totalValue,
      totalCostBasis,
      gainLoss,
      gainLossPct,
      count: holdings.length,
      avgPosition: holdings.length > 0 ? totalValue / holdings.length : 0,
    };
  }, [holdings]);

  const allocationRows = useMemo(() => {
    if (totals.totalValue <= 0) return [];

    return holdings
      .map((holding, index) => {
        const value = holding.currentValue ?? 0;
        const weight = value > 0 ? (value / totals.totalValue) * 100 : 0;
        return {
          id: holding.id,
          label: holding.ticker || holding.symbol || holding.name,
          subLabel: holding.name,
          value,
          weight,
          color: allocationColor(index),
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [holdings, totals.totalValue]);

  const chartData = useMemo(() => {
    if (holdings.length === 0) {
      return [
        { label: "Sep", portfolio: 100, benchmark: 100 },
        { label: "Oct", portfolio: 101, benchmark: 101 },
        { label: "Nov", portfolio: 102, benchmark: 99 },
        { label: "Dec", portfolio: 103, benchmark: 103 },
        { label: "Jan", portfolio: 104, benchmark: 102 },
        { label: "Feb", portfolio: 105, benchmark: 105 },
        { label: "Mar", portfolio: 106, benchmark: 104 },
        { label: "Now", portfolio: 107, benchmark: 106 },
      ];
    }

    return buildPortfolioSeries(totals.totalValue, totals.totalCostBasis);
  }, [holdings.length, totals.totalCostBasis, totals.totalValue]);

  const metricCards = [
    {
      label: "Portfolio value",
      value: fmt(totals.totalValue),
      meta: "Manual + connected holdings",
      tone: "var(--aw-chart-primary)",
    },
    {
      label: "Cost basis",
      value: fmt(totals.totalCostBasis),
      meta: "Estimated invested principal",
      tone: "var(--aw-chart-secondary)",
    },
    {
      label: "Unrealized P/L",
      value: fmt(totals.gainLoss),
      meta: `${totals.gainLossPct >= 0 ? "+" : ""}${totals.gainLossPct.toFixed(2)}% vs cost basis`,
      tone: totals.gainLoss >= 0 ? "var(--aw-chart-positive)" : "var(--aw-chart-negative)",
    },
    {
      label: "Holdings",
      value: String(totals.count),
      meta: totals.count > 0 ? `Avg ${fmt(totals.avgPosition)}` : "No holdings yet",
      tone: "var(--aw-primary-secondary)",
    },
  ];

  useEffect(() => {
    const aggregateId = "manual-investments-aggregate";
    const nextAmount = Math.max(0, totals.totalValue);
    const updatedAt = new Date().toISOString();

    setManualNetWorthItems((prev) => {
      const next = [...prev];
      const existingIndex = next.findIndex((item) => item.id === aggregateId);

      if (nextAmount <= 0) {
        if (existingIndex >= 0) {
          next.splice(existingIndex, 1);
          return next;
        }
        return prev;
      }

      const payload: ManualNetWorthItem = {
        id: aggregateId,
        label: "Investments portfolio",
        kind: "asset",
        category: "Investments",
        amount: nextAmount,
        updatedAt,
        sourceType: "manual",
      };

      if (existingIndex >= 0) {
        const existing = next[existingIndex];
        if (existing.amount === payload.amount) return prev;
        next[existingIndex] = payload;
        return next;
      }

      return [payload, ...next];
    });
  }, [setManualNetWorthItems, totals.totalValue]);

  const openManualHolding = () => {
    setManualError(null);
    setManualModalOpen(true);
  };

  const addManualHolding = () => {
    setManualError(null);

    const name = assetName.trim();
    const parsedTicker = ticker.trim().toUpperCase();
    const parsedQuantity = Number(quantity);
    const parsedAverageCost = Number(averageCost || "0");
    const parsedCurrentValueInput = Number(currentValue || "0");

    if (!name) {
      setManualError("Asset name is required.");
      return;
    }

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setManualError("Quantity must be greater than zero.");
      return;
    }

    if (averageCost && (!Number.isFinite(parsedAverageCost) || parsedAverageCost < 0)) {
      setManualError("Average cost must be zero or greater.");
      return;
    }

    if (currentValue && (!Number.isFinite(parsedCurrentValueInput) || parsedCurrentValueInput < 0)) {
      setManualError("Current value must be zero or greater.");
      return;
    }

    const computedCurrentValue = currentValue
      ? parsedCurrentValueInput
      : averageCost
        ? parsedQuantity * parsedAverageCost
        : 0;

    const symbol = parsedTicker || name.toUpperCase().replace(/\s+/g, "-");

    setManualHoldings((prev) => [
      {
        id: `manual-${Date.now()}`,
        symbol,
        ticker: parsedTicker || undefined,
        name,
        quantity: parsedQuantity,
        shares: parsedQuantity,
        averageCost: averageCost ? parsedAverageCost : undefined,
        currentValue: computedCurrentValue,
        value: computedCurrentValue,
        accountName: accountName.trim() || undefined,
        notes: notes.trim() || undefined,
        sourceType: "manual",
      },
      ...prev,
    ]);

    setAssetName("");
    setTicker("");
    setQuantity("");
    setAverageCost("");
    setCurrentValue("");
    setAccountName("");
    setNotes("");
    setManualModalOpen(false);
  };

  if (loading) {
    return (
      <div className="aw-workspace-page flex items-center justify-center py-32">
        <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
      </div>
    );
  }

  return (
    <div className="aw-workspace-page">
      <WorkspaceHeader
        title="Investments"
        tabs={[
          { label: "Holdings", active: activeTab === "holdings" },
          { label: "Allocation", active: activeTab === "allocation" },
        ]}
        actions={(
          <>
            <ToolbarButton onClick={() => setActiveTab("holdings")}>Holdings</ToolbarButton>
            <ToolbarButton onClick={() => setActiveTab("allocation")}>Allocation</ToolbarButton>
            <ToolbarButton variant="primary" icon={<Plus size={14} />} onClick={openManualHolding}>
              Add holding
            </ToolbarButton>
            <ManualEntryButton onClick={openManualHolding}>
              Add holding
            </ManualEntryButton>
          </>
        )}
      />

      <div className="aw-workspace-grid" data-columns="4">
        {metricCards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      <WorkspacePanel className="mt-4" title="Performance chart">
        <div className="aw-card !p-4">
          <div className="mb-5 flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
                Portfolio performance
              </p>
              <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--aw-text)]">
                Portfolio vs benchmark
              </p>
            </div>
            <div className="flex items-center gap-5 text-sm text-[var(--aw-text-muted)]">
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--aw-primary)]" />
                Portfolio
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--aw-chart-secondary)]" />
                Benchmark
              </span>
            </div>
          </div>

          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="var(--aw-chart-grid)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--aw-text-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fill: "var(--aw-text-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={(value: number) => fmt(value)}
                />
                <Tooltip
                  formatter={(value, name) => [fmt(Number(value ?? 0)), name === "portfolio" ? "Portfolio" : "Benchmark"]}
                  labelStyle={{ color: "var(--aw-text-muted)" }}
                  itemStyle={{ color: "var(--aw-text)" }}
                  contentStyle={{
                    background: "var(--aw-surface-1)",
                    border: "1px solid var(--aw-border)",
                    borderRadius: 12,
                    boxShadow: "0 8px 18px rgba(15,23,42,0.06)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  stroke="var(--aw-chart-secondary)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: "var(--aw-chart-secondary)", stroke: "#FFFFFF", strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="portfolio"
                  stroke="var(--aw-chart-primary)"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 4, fill: "var(--aw-chart-primary)", stroke: "#FFFFFF", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel className="mt-4" title="Holdings section">
        {holdings.length === 0 ? (
          <div className="aw-card-table">
            <WorkspaceEmpty
              title="No holdings yet"
              description="Track investments even without a brokerage connection."
              action={(
                <div className="flex flex-wrap items-center gap-2">
                  <Link href="/connect" className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm">
                    Connect an investment account
                  </Link>
                  <button
                    type="button"
                    onClick={openManualHolding}
                    className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Add holding
                  </button>
                </div>
              )}
              className="min-h-[280px]"
            />
          </div>
        ) : activeTab === "holdings" ? (
          <div className="aw-card-table">
            <div className="grid grid-cols-[minmax(0,1.4fr)_100px_110px_140px_140px] gap-4 border-b border-[var(--aw-border)] px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
              <span>Asset</span>
              <span>Qty</span>
              <span>Avg cost</span>
              <span>Account</span>
              <span className="text-right">Current value</span>
            </div>
            {holdings.map((holding) => (
              <div
                key={holding.id}
                className="grid grid-cols-[minmax(0,1.4fr)_100px_110px_140px_140px] items-center gap-4 border-t border-[var(--aw-border)] px-5 py-4 first:border-t-0 hover:bg-[var(--aw-primary-soft)]/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--aw-text)]">
                    {holding.name}
                    {holding.ticker ? ` (${holding.ticker})` : ""}
                  </p>
                  {holding.notes ? (
                    <p className="mt-1 truncate text-xs text-[var(--aw-text-muted)]">{holding.notes}</p>
                  ) : null}
                </div>
                <p className="aw-number text-sm text-[var(--aw-text-muted)]">{holding.quantity}</p>
                <p className="aw-number text-sm text-[var(--aw-text-muted)]">
                  {holding.averageCost ? fmt(holding.averageCost) : "-"}
                </p>
                <p className="truncate text-sm text-[var(--aw-text-muted)]">{holding.accountName || "-"}</p>
                <p className="aw-number text-right text-sm font-semibold text-[var(--aw-text)]">
                  {fmt(holding.currentValue ?? holding.value)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {allocationRows.map((row) => (
              <div key={row.id} className="aw-card aw-card-compact !p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--aw-text)]">{row.label}</p>
                    <p className="truncate text-xs text-[var(--aw-text-muted)]">{row.subLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="aw-number text-sm text-[var(--aw-text)]">{fmt(row.value)}</p>
                    <p className="text-xs text-[var(--aw-text-muted)]">{row.weight.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-[var(--aw-border)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(3, row.weight)}%`, background: row.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </WorkspacePanel>

      <ManualEntryModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Add holding"
        description="Add a manual holding to include it in portfolio totals, allocation, and net worth."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Asset name</span>
              <input
                value={assetName}
                onChange={(event) => setAssetName(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Apple Inc."
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Ticker (optional)</span>
              <input
                value={ticker}
                onChange={(event) => setTicker(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="AAPL"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Quantity</span>
              <input
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                min="0"
                step="0.0001"
                placeholder="0"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Average cost (optional)</span>
              <input
                value={averageCost}
                onChange={(event) => setAverageCost(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Current value (optional)</span>
              <input
                value={currentValue}
                onChange={(event) => setCurrentValue(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Account (optional)</span>
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Brokerage"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="aw-input min-h-[92px] py-2 text-sm"
              placeholder="Optional notes"
            />
          </label>

          {manualError ? (
            <p className="rounded-lg border border-[var(--aw-danger)]/25 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
              {manualError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setManualModalOpen(false)}
              className="aw-button-secondary h-10 px-4 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addManualHolding}
              className="aw-button-primary h-10 px-4 text-sm"
            >
              Save holding
            </button>
          </div>
        </div>
      </ManualEntryModal>
    </div>
  );
}
