"use client";

import Link from "next/link";
import { ReportsSkeleton } from "@/components/skeleton";
import { useMemo, useState } from "react";
import { fmt } from "@/lib/utils";
import {
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import { normalizeTransactionType } from "@/lib/manualTransactions";
import { useFinancialData } from "@/lib/useFinancialData";

type RecordType = "income" | "expense" | "transfer";
type TimeRange = "month" | "quarter" | "year";

interface SourceRecord {
  type: RecordType;
  amount: number;
  category?: string;
}

interface AggregateTotals {
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
}

interface CategoryTotal {
  category: string;
  amount: number;
  percent: number;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function inRange(date: Date, range: TimeRange): boolean {
  const now = new Date();
  if (range === "month") {
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }

  if (range === "quarter") {
    return date >= addMonths(startOfMonth(now), -2);
  }

  return date >= addMonths(startOfMonth(now), -11);
}

function rangeLabel(range: TimeRange): string {
  if (range === "month") return "This month";
  if (range === "quarter") return "Last 3 months";
  return "Last 12 months";
}

function toTotals(records: SourceRecord[]): AggregateTotals {
  const income = records
    .filter((r) => r.type === "income")
    .reduce((sum, r) => sum + r.amount, 0);
  const expenses = records
    .filter((r) => r.type === "expense")
    .reduce((sum, r) => sum + r.amount, 0);
  const net = income - expenses;
  const savingsRate = income > 0 ? Math.round((net / income) * 100) : 0;
  return { income, expenses, net, savingsRate };
}

function topCategories(records: SourceRecord[], limit: number): CategoryTotal[] {
  const map = new Map<string, number>();
  for (const r of records) {
    if (r.type !== "expense") continue;
    const cat = (r.category || "").trim().toLowerCase().replace(/_/g, " ") || "uncategorized";
    map.set(cat, (map.get(cat) ?? 0) + r.amount);
  }

  const totalExpenses = [...map.values()].reduce((sum, v) => sum + v, 0);
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category, amount]) => ({
      category: category.charAt(0).toUpperCase() + category.slice(1),
      amount,
      percent: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
    }));
}

function FlowVisualization(props: { income: number; expenses: number; net: number }) {
  const saved = Math.max(props.net, 0);
  const overspent = Math.max(-props.net, 0);
  const maxFlow = Math.max(props.income, props.expenses, 1);

  // Scale node heights proportionally (min 32px, max 120px)
  const incomeH = Math.max(32, Math.round((props.income / maxFlow) * 120));
  const expenseH = Math.max(32, Math.round((props.expenses / maxFlow) * 120));
  const savedH = saved > 0 ? Math.max(24, Math.round((saved / maxFlow) * 80)) : 0;
  const overspentH = overspent > 0 ? Math.max(24, Math.round((overspent / maxFlow) * 80)) : 0;

  const centerH = Math.max(incomeH, expenseH + savedH + 8);
  const viewH = Math.max(centerH + 60, 200);

  // Y positions
  const incomeY = Math.round((viewH - incomeH) / 2);
  const centerY = Math.round((viewH - centerH) / 2);
  const expenseY = centerY;
  const savedY = expenseY + expenseH + 8;

  // Build flow paths dynamically
  const incomePath = `M 74 ${incomeY} C 220 ${incomeY}, 310 ${centerY}, 438 ${centerY} L 438 ${centerY + centerH} C 310 ${centerY + centerH}, 220 ${incomeY + incomeH}, 74 ${incomeY + incomeH} Z`;
  const expensePath = `M 462 ${centerY} C 600 ${centerY}, 720 ${expenseY}, 840 ${expenseY} L 840 ${expenseY + expenseH} C 720 ${expenseY + expenseH}, 600 ${centerY + expenseH}, 462 ${centerY + expenseH} Z`;
  const savedPath = savedH > 0
    ? `M 462 ${centerY + expenseH + 4} C 600 ${centerY + expenseH + 4}, 720 ${savedY}, 840 ${savedY} L 840 ${savedY + savedH} C 720 ${savedY + savedH}, 600 ${centerY + expenseH + 4 + savedH}, 462 ${centerY + expenseH + 4 + savedH} Z`
    : "";

  const nodes: Array<{ key: string; label: string; value: string; color: string; x: number; y: number; height: number }> = [
    { key: "income", label: "Income", value: fmt(props.income), color: "var(--aw-chart-positive-fill)", x: 40, y: incomeY, height: incomeH },
    { key: "center", label: "Cash flow", value: fmt(props.net), color: "var(--aw-chart-primary)", x: 438, y: centerY, height: centerH },
    { key: "expenses", label: "Expenses", value: fmt(props.expenses), color: "var(--aw-chart-negative-fill)", x: 840, y: expenseY, height: expenseH },
  ];

  if (savedH > 0) {
    nodes.push({ key: "saved", label: "Saved", value: fmt(saved), color: "var(--aw-chart-positive-fill)", x: 840, y: savedY, height: savedH });
  }
  if (overspentH > 0) {
    nodes.push({ key: "overspent", label: "Overspent", value: fmt(overspent), color: "var(--aw-chart-negative-fill)", x: 840, y: savedY, height: overspentH });
  }

  return (
    <div className="rounded-2xl bg-[var(--aw-surface-1)] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">
            Where your money goes
          </p>
          <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[var(--aw-text)]">
            {fmt(props.income)} in · {fmt(props.expenses)} out
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 940 ${viewH}`} className="w-full" style={{ minHeight: 200, maxHeight: 360 }}>
          <defs>
            <linearGradient id="rpt-income-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(187,247,208,0.3)" />
              <stop offset="100%" stopColor="rgba(253,186,116,0.2)" />
            </linearGradient>
            <linearGradient id="rpt-expense-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(253,186,116,0.2)" />
              <stop offset="100%" stopColor="rgba(254,205,211,0.3)" />
            </linearGradient>
            <linearGradient id="rpt-saved-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(253,186,116,0.2)" />
              <stop offset="100%" stopColor="rgba(187,247,208,0.25)" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="940" height={viewH} rx="16" fill="var(--aw-surface-1)" />
          <path d={incomePath} fill="url(#rpt-income-flow)" />
          <path d={expensePath} fill="url(#rpt-expense-flow)" />
          {savedPath ? <path d={savedPath} fill="url(#rpt-saved-flow)" /> : null}

          {nodes.map((node) => (
            <g key={node.key}>
              <rect x={node.x} y={node.y} width="16" height={node.height} rx="8" fill={node.color} opacity="0.8" />
              <text x={node.x + 30} y={node.y + 14} fill="var(--aw-text-muted)" fontSize="11" fontWeight="600" letterSpacing="0.08em">
                {node.label.toUpperCase()}
              </text>
              <text x={node.x + 30} y={node.y + 36} fill="var(--aw-text)" fontSize="20" fontWeight="600">
                {node.value}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

export function ReportsView() {
  const { loading, error, allTransactions, connectedAccounts } = useFinancialData();
  const [range, setRange] = useState<TimeRange>("month");

  const allRecords = useMemo<SourceRecord[]>(() => {
    const records: SourceRecord[] = [];

    for (const tx of allTransactions) {
      const type = normalizeTransactionType(tx);
      if (type === "transfer") continue;
      const date = new Date(tx.occurred_at);
      if (Number.isNaN(date.getTime()) || !inRange(date, range)) continue;
      records.push({ type, amount: Math.abs(tx.amount), category: tx.category });
    }

    return records;
  }, [allTransactions, range]);

  const totals = useMemo(() => toTotals(allRecords), [allRecords]);
  const categories = useMemo(() => topCategories(allRecords, 6), [allRecords]);
  const hasConnectedAccounts = connectedAccounts.length > 0;

  if (loading) {
    return <ReportsSkeleton />;
  }

  return (
    <div className="aw-workspace-page">
      <WorkspaceHeader
        title="Reports"
        subtitle="How your money moved this period, what changed, and what Agent Wallet recommends next."
        actions={(
          <div className="aw-segmented">
            <button type="button" data-active={range === "month"} onClick={() => setRange("month")}>Month</button>
            <button type="button" data-active={range === "quarter"} onClick={() => setRange("quarter")}>Quarter</button>
            <button type="button" data-active={range === "year"} onClick={() => setRange("year")}>Year</button>
          </div>
        )}
      />

      {error ? (
        <div className="mb-4 rounded-2xl border border-[var(--aw-border)] bg-white px-4 py-3 text-sm text-[var(--aw-text)]">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Income</p>
          <p className="aw-number mt-3 text-2xl text-[var(--aw-success)]">{fmt(totals.income)}</p>
          <p className="mt-2 text-sm text-[var(--aw-text-muted)]">{rangeLabel(range)}</p>
        </div>
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Expenses</p>
          <p className="aw-number mt-3 text-2xl text-[var(--aw-text)]">{fmt(totals.expenses)}</p>
          <p className="mt-2 text-sm text-[var(--aw-text-muted)]">{rangeLabel(range)}</p>
        </div>
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Net</p>
          <p className={`aw-number mt-3 text-2xl ${totals.net >= 0 ? "text-[var(--aw-text)]" : "text-[var(--aw-danger)]"}`}>
            {fmt(totals.net)}
          </p>
          <p className="mt-2 text-sm text-[var(--aw-text-muted)]">{rangeLabel(range)}</p>
        </div>
        <div className="aw-card aw-card-compact">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Savings rate</p>
          <p className="aw-number mt-3 text-2xl text-[var(--aw-text)]">{totals.savingsRate}%</p>
          <p className="mt-2 text-sm text-[var(--aw-text-muted)]">{rangeLabel(range)}</p>
        </div>
      </div>

      <WorkspacePanel className="mt-4" title="Income vs expenses">
        {allRecords.length === 0 ? (
          <WorkspaceEmpty
            title="No reporting data yet"
            description={hasConnectedAccounts
              ? "Add a few transactions to see category breakdowns and reporting totals for this period."
              : "Connect an account or add manual transactions to unlock reporting totals and category breakdowns."}
            action={(
              <div className="flex flex-wrap items-center justify-center gap-2">
                {!hasConnectedAccounts ? (
                  <Link href="/connect" className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm">
                    Connect an account
                  </Link>
                ) : null}
                <Link href="/transactions" className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm">
                  Add a transaction
                </Link>
              </div>
            )}
            className="min-h-[220px]"
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-[var(--aw-text-muted)]">
              Showing actual transactions for {rangeLabel(range).toLowerCase()}.
            </p>
            <FlowVisualization income={totals.income} expenses={totals.expenses} net={totals.net} />
          </>
        )}
      </WorkspacePanel>

      {categories.length > 0 ? (
        <WorkspacePanel className="mt-4" title="Top spending categories">
          <div className="space-y-4">
            {categories.map((cat) => (
              <div key={cat.category}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[var(--aw-text)]">{cat.category}</span>
                  <div className="flex items-center gap-3">
                    <span className="aw-number text-[var(--aw-text-muted)]">{fmt(cat.amount)}</span>
                    <span className="aw-number w-10 text-right font-semibold text-[var(--aw-text)]">{cat.percent}%</span>
                  </div>
                </div>
                <div className="mt-2 h-2 rounded-full bg-[var(--aw-border)]">
                  <div
                    className="h-full rounded-full bg-[var(--aw-chart-negative-fill)]"
                    style={{ width: `${Math.max(3, cat.percent)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </WorkspacePanel>
      ) : null}
    </div>
  );
}
