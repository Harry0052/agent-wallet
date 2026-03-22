"use client";

import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/utils";
import {
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import { ManualEntryModal } from "@/components/finance/ManualDataControls";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import {
  MANUAL_STORAGE_KEYS,
  type ManualInvestmentHolding,
  type ManualNetWorthItem,
} from "@/lib/manualMode";

type HoldingRow = ManualInvestmentHolding;

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

function allocationColor(index: number): string {
  const palette = [
    "var(--aw-chart-primary)",
    "var(--aw-chart-secondary)",
    "var(--aw-chart-positive)",
    "var(--aw-text-muted)",
    "var(--aw-chart-positive-fill)",
    "var(--aw-chart-negative-fill)",
  ];
  return palette[index % palette.length];
}

export function InvestmentsView() {
  const [loading, setLoading] = useState(true);

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

    return { totalValue, totalCostBasis, gainLoss, gainLossPct, count: holdings.length };
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

  // Sync investment total to net worth
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
        subtitle="Track your portfolio, see how it's allocated, and understand your long-term wealth."
        actions={(
          <button
            type="button"
            onClick={openManualHolding}
            className="aw-button-primary inline-flex h-[38px] items-center gap-1.5 rounded-xl px-4 text-sm"
          >
            <Plus size={14} />
            Add holding
          </button>
        )}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Portfolio value</p>
          <p className="aw-number mt-3 text-2xl text-[var(--aw-text)]">{fmt(totals.totalValue)}</p>
          <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
            {totals.count} holding{totals.count === 1 ? "" : "s"} · Manually tracked
          </p>
        </div>
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Cost basis</p>
          <p className="aw-number mt-3 text-2xl text-[var(--aw-text)]">{fmt(totals.totalCostBasis)}</p>
          <p className="mt-1 text-xs text-[var(--aw-text-muted)]">Total invested</p>
        </div>
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Gain / Loss</p>
          <p className={`aw-number mt-3 text-2xl ${totals.gainLoss >= 0 ? "text-[var(--aw-success)]" : "text-[var(--aw-danger)]"}`}>
            {totals.gainLoss >= 0 ? "+" : ""}{fmt(totals.gainLoss)}
          </p>
          <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
            {totals.gainLossPct >= 0 ? "+" : ""}{totals.gainLossPct.toFixed(1)}% vs cost basis
          </p>
        </div>
      </div>

      <WorkspacePanel className="mt-4" title="Holdings">
        {holdings.length === 0 ? (
          <WorkspaceEmpty
            title="See your full financial picture"
            description="Add stocks, funds, crypto, or other investments. Calico tracks them alongside your cash and debt so you can see your complete net worth."
            action={(
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/connect" className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm">
                  Connect an account
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
        ) : (
          <div className="aw-card-table">
            <div className="grid grid-cols-[minmax(0,1.4fr)_100px_110px_140px_140px] gap-4 border-b border-[var(--aw-border)] px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
              <span>Asset</span>
              <span>Qty</span>
              <span>Avg cost</span>
              <span>Account</span>
              <span className="text-right">Value</span>
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
        )}
      </WorkspacePanel>

      {allocationRows.length > 0 ? (
        <WorkspacePanel className="mt-4" title="Allocation">
          <div className="space-y-3">
            {allocationRows.map((row) => (
              <div key={row.id} className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-[var(--aw-text)]">{row.label}</p>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="aw-number text-[var(--aw-text-muted)]">{fmt(row.value)}</span>
                      <span className="aw-number w-12 text-right font-semibold text-[var(--aw-text)]">{row.weight.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[var(--aw-border)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(3, row.weight)}%`, background: row.color }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </WorkspacePanel>
      ) : null}

      {holdings.length > 0 ? (
        <WorkspacePanel className="mt-4" title="Portfolio Insights">
          <div className="space-y-3">
            {/* Largest holding */}
            {allocationRows.length > 0 ? (
              <div className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3">
                <p className="text-sm text-[var(--aw-text)]">
                  <span className="font-semibold">{allocationRows[0].label}</span> is your largest holding at{" "}
                  <span className="font-semibold">{allocationRows[0].weight.toFixed(0)}%</span> of your portfolio.
                </p>
              </div>
            ) : null}

            {/* Concentration check */}
            {allocationRows.length > 0 && allocationRows[0].weight > 50 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
                <p className="text-sm text-amber-900">
                  <span className="font-semibold">Concentration risk:</span> More than half your portfolio is in {allocationRows[0].label}.
                  Consider diversifying to reduce risk.
                </p>
              </div>
            ) : allocationRows.length >= 3 ? (
              <div className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3">
                <p className="text-sm text-[var(--aw-text)]">
                  Your portfolio is spread across <span className="font-semibold">{allocationRows.length} holdings</span>.
                  {allocationRows[0].weight < 40 ? " That's reasonably diversified." : ""}
                </p>
              </div>
            ) : null}

            {/* Total vs cost */}
            {totals.totalCostBasis > 0 ? (
              <div className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3">
                <p className="text-sm text-[var(--aw-text)]">
                  You've invested <span className="font-semibold">{fmt(totals.totalCostBasis)}</span> and it's now worth{" "}
                  <span className={`font-semibold ${totals.gainLoss >= 0 ? "text-[var(--aw-success)]" : "text-[var(--aw-danger)]"}`}>
                    {fmt(totals.totalValue)}
                  </span>
                  {" "}({totals.gainLoss >= 0 ? "+" : ""}{totals.gainLossPct.toFixed(1)}%).
                </p>
              </div>
            ) : null}
          </div>
        </WorkspacePanel>
      ) : null}

      <ManualEntryModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Add holding"
        description="Track an investment alongside the rest of your money."
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
