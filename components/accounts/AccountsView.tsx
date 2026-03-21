"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Loader2, Plus, RefreshCw } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  dismissFinancialNotification,
  fetchFinancialOsDashboard,
} from "@/services/financialOs";
import { useFinancialData } from "@/lib/useFinancialData";
import { fmt } from "@/lib/utils";
import {
  ToolbarButton,
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import { ManualEntryModal } from "@/components/finance/ManualDataControls";
import { ComboboxInput } from "@/components/finance/ComboboxInput";
import {
  manualAccountToConnected,
  summarizeAccounts,
} from "@/lib/financialTypes";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import {
  MANUAL_STORAGE_KEYS,
  type ManualAccountRecord,
  type ManualAccountType,
} from "@/lib/manualMode";
import { sourceTypeUiLabel } from "@/lib/sourceType";
import type { UnifiedFinancialAccountDashboard } from "@/lib/server/financialOs/types";

interface NetWorthHistoryPoint {
  dayKey: string;
  label: string;
  recordedAt: string;
  source?: "connected" | "manual";
  connectedTotal: number;
  manualTotal: number;
  total: number;
}

interface AccountRow {
  id: string;
  label: string;
  subtitle: string;
  balance: number;
  updatedLabel: string;
  sourceType: "connected" | "manual";
  notes?: string;
}

interface TrendPoint {
  label: string;
  value: number;
}

const MANUAL_ACCOUNT_OPTIONS: Array<{
  value: ManualAccountType;
  label: string;
  kind: "asset" | "liability";
}> = [
  { value: "cash", label: "Cash account", kind: "asset" },
  { value: "checking", label: "Checking", kind: "asset" },
  { value: "savings", label: "Savings", kind: "asset" },
  { value: "credit", label: "Credit card", kind: "liability" },
  { value: "loan", label: "Loan", kind: "liability" },
  { value: "investment", label: "Investment account", kind: "asset" },
  { value: "other_asset", label: "Other asset", kind: "asset" },
  { value: "other_liability", label: "Other liability", kind: "liability" },
];

function manualTypeMeta(type: ManualAccountType) {
  return MANUAL_ACCOUNT_OPTIONS.find((option) => option.value === type) ?? MANUAL_ACCOUNT_OPTIONS[0];
}

function isLiabilityType(type: ManualAccountType): boolean {
  return manualTypeMeta(type).kind === "liability";
}

function normalizeManualBalance(type: ManualAccountType, amount: number): number {
  if (isLiabilityType(type)) {
    return -Math.abs(amount);
  }
  return Math.abs(amount);
}

function formatTypeLabel(type: string): string {
  const labelMap: Record<string, string> = {
    cash: "Cash account",
    checking: "Checking",
    savings: "Savings",
    credit: "Credit card",
    loan: "Loan",
    investment: "Investment account",
    other_asset: "Other asset",
    other_liability: "Other liability",
  };

  return labelMap[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function formatLastUpdated(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) return "Sync pending";
  const date = new Date(lastSyncedAt);
  if (Number.isNaN(date.getTime())) return "Sync pending";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDayLabel(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function recordHistoryPoint(
  prev: NetWorthHistoryPoint[],
  dayKey: string,
  connectedTotal: number,
  manualTotal: number,
): NetWorthHistoryPoint[] {
  const total = connectedTotal + manualTotal;
  const point: NetWorthHistoryPoint = {
    dayKey,
    label: formatDayLabel(dayKey),
    recordedAt: new Date().toISOString(),
    connectedTotal,
    manualTotal,
    total,
  };

  const next = [...prev];
  const existingIndex = next.findIndex((item) => item.dayKey === dayKey);

  if (existingIndex >= 0) {
    const existing = next[existingIndex];
    if (
      existing.total === point.total
      && existing.connectedTotal === point.connectedTotal
      && existing.manualTotal === point.manualTotal
    ) {
      return prev;
    }
    next[existingIndex] = point;
  } else {
    next.push(point);
  }

  return next.sort((a, b) => a.dayKey.localeCompare(b.dayKey)).slice(-90);
}

// ── Recharts-based net worth chart ───────────────────────────────────────────

function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return fmt(value);
}

function ChartTooltipContent(props: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string | number;
}) {
  if (!props.active || !props.payload?.length) return null;
  const value = props.payload[0].value;
  if (typeof value !== "number") return null;
  return (
    <div className="rounded-lg border border-[var(--aw-border)] bg-white px-3 py-2 shadow-md">
      <p className="text-[11px] text-[var(--aw-text-muted)]">{props.label}</p>
      <p className="aw-number mt-0.5 text-sm font-semibold text-[var(--aw-text)]">
        {fmt(value)}
      </p>
    </div>
  );
}

function NetWorthTrendChart(props: { data: TrendPoint[] }) {
  const data = props.data;

  if (data.length === 0) return null;

  // Single point: minimal centered state
  if (data.length === 1) {
    return (
      <div className="flex h-[200px] flex-col items-center justify-center">
        <p className="aw-number text-2xl font-semibold text-[var(--aw-text)]">
          {fmt(data[0].value)}
        </p>
        <p className="mt-1.5 text-[11px] text-[var(--aw-text-muted)]">{data[0].label}</p>
        <p className="mt-4 text-[11px] text-[var(--aw-text-muted)]/60">
          More history will appear as balances update.
        </p>
      </div>
    );
  }

  // Domain: use auto with generous padding
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const isFlat = max === min;
  const pad = isFlat ? Math.max(Math.abs(min) * 0.08, 200) : (max - min) * 0.15;
  const domainMin = min - pad;
  const domainMax = max + pad;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart
        data={data}
        margin={{ top: 16, right: 12, bottom: 4, left: -8 }}
      >
        <defs>
          <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FDBA74" stopOpacity={0.06} />
            <stop offset="100%" stopColor="#FDBA74" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: "#9B8B7B" }}
          dy={8}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[domainMin, domainMax]}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: "#9B8B7B" }}
          tickFormatter={fmtCompact}
          width={52}
          tickCount={4}
        />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Tooltip
          content={ChartTooltipContent as any}
          cursor={{ stroke: "#E7C6A3", strokeWidth: 0.5, strokeDasharray: "3 3" }}
        />
        <Area
          type="linear"
          dataKey="value"
          stroke="#E8A45E"
          strokeWidth={1}
          fill="url(#nw-fill)"
          dot={false}
          activeDot={{
            r: 2.5,
            fill: "#E8A45E",
            stroke: "white",
            strokeWidth: 1.5,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function AccountsView() {
  const router = useRouter();
  const financialData = useFinancialData();
  const [financialInfra, setFinancialInfra] = useState<UnifiedFinancialAccountDashboard | null>(null);
  const [financialInfraLoading, setFinancialInfraLoading] = useState(false);
  const loadSequenceRef = useRef(0);

  const [manualAccounts, setManualAccounts] = useLocalStorageState<ManualAccountRecord[]>(
    MANUAL_STORAGE_KEYS.accounts,
    [],
    { broadcast: false },
  );
  const [netWorthHistory, setNetWorthHistory] = useLocalStorageState<NetWorthHistoryPoint[]>(
    MANUAL_STORAGE_KEYS.netWorthHistory,
    [],
    { broadcast: false },
  );

  const [addAccountChoiceOpen, setAddAccountChoiceOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);

  const [manualName, setManualName] = useState("");
  const [manualType, setManualType] = useState<ManualAccountType>("checking");
  const [manualBalance, setManualBalance] = useState("");
  const [manualInstitution, setManualInstitution] = useState("");
  const [manualLastUpdated, setManualLastUpdated] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualNotes, setManualNotes] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  // Fetch financial OS dashboard (page-specific, not in useFinancialData)
  const loadFinancialInfra = useCallback(async () => {
    const requestId = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestId;
    setFinancialInfraLoading(true);

    void fetchFinancialOsDashboard()
      .then((value) => {
        if (requestId !== loadSequenceRef.current) return;
        setFinancialInfra(value);
      })
      .catch(() => {
        if (requestId !== loadSequenceRef.current) return;
        setFinancialInfra(null);
      })
      .finally(() => {
        if (requestId !== loadSequenceRef.current) return;
        setFinancialInfraLoading(false);
      });
  }, []);

  useEffect(() => {
    void loadFinancialInfra();
  }, [loadFinancialInfra]);

  const loading = financialData.loading;
  const error = financialData.error;
  const connectedAccounts = financialData.connectedAccounts;

  // Exclude accounts that need relinking from balance aggregates
  const activeConnectedAccounts = connectedAccounts.filter(
    (a) => a.item_status !== "relink_required" && a.item_status !== "error",
  );

  const connectedKnownBalanceSum = activeConnectedAccounts.reduce(
    (sum, account) => sum + (typeof account.balance === "number" ? account.balance : 0),
    0,
  );
  const connectedKnownBalanceCount = activeConnectedAccounts.filter(
    (account) => typeof account.balance === "number",
  ).length;

  const connectedTotalBalance =
    connectedKnownBalanceSum;

  const connectedAverageBalance =
    connectedKnownBalanceCount > 0
      ? connectedKnownBalanceSum / connectedKnownBalanceCount
      : 0;

  const summary = useMemo(() => summarizeAccounts([
    ...activeConnectedAccounts,
    ...manualAccounts.map(manualAccountToConnected),
  ]), [activeConnectedAccounts, manualAccounts]);
  const manualTotalBalance = summary.manualBalance;
  const combinedNetWorth = summary.netWorth;

  useEffect(() => {
    const total = connectedTotalBalance + manualTotalBalance;
    if (!Number.isFinite(total)) return;
    if (connectedAccounts.length === 0 && manualAccounts.length === 0) return;

    const dayKey = new Date().toISOString().slice(0, 10);
    setNetWorthHistory((prev) =>
      recordHistoryPoint(prev, dayKey, connectedTotalBalance, manualTotalBalance),
    );
  }, [connectedAccounts.length, connectedTotalBalance, manualAccounts.length, manualTotalBalance, setNetWorthHistory]);

  const chartData = useMemo(() => {
    const latestByDay = new Map<string, NetWorthHistoryPoint>();
    for (const point of netWorthHistory) {
      const existing = latestByDay.get(point.dayKey);
      if (!existing || point.dayKey > existing.dayKey || Date.parse(point.recordedAt) >= Date.parse(existing.recordedAt)) {
        latestByDay.set(point.dayKey, point);
      }
    }

    const history = [...latestByDay.values()]
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
      .slice(-8)
      .map((item) => ({
        label: item.label,
        value: item.total,
      }));

    if (history.length > 0) {
      return history;
    }

    // No history yet — show current state as a single point.
    if (connectedAccounts.length > 0 || manualAccounts.length > 0) {
      const today = new Date();
      return [{
        label: today.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        value: combinedNetWorth,
      }];
    }

    return [];
  }, [combinedNetWorth, connectedAccounts.length, manualAccounts.length, netWorthHistory]);

  const accountRows = useMemo<AccountRow[]>(() => {
    const connectedRows = connectedAccounts.map((account) => ({
      id: account.id,
      label: account.nickname || account.institution_name,
      subtitle: `${formatTypeLabel(account.account_type)} • ${account.institution_name} •••• ${account.mask}`,
      balance: typeof account.balance === "number" ? account.balance : connectedAverageBalance,
      updatedLabel: formatLastUpdated(account.last_synced_at),
      sourceType: "connected" as const,
    }));

    const manualRows = manualAccounts.map((account) => ({
      id: account.id,
      label: account.name,
      subtitle: `${formatTypeLabel(account.type)}${account.institutionName ? ` • ${account.institutionName}` : ""}`,
      balance: account.balance,
      updatedLabel: formatLastUpdated(account.updatedAt),
      sourceType: "manual" as const,
      notes: account.notes,
    }));

    return [...connectedRows, ...manualRows].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [connectedAccounts, connectedAverageBalance, manualAccounts]);

  const topTimeline = useMemo(
    () => (financialInfra?.timeline || []).slice(0, 6),
    [financialInfra?.timeline],
  );
  const topNotifications = useMemo(
    () => (financialInfra?.notifications || []).slice(0, 4),
    [financialInfra?.notifications],
  );

  const onCreateManualAccount = () => {
    setManualError(null);
    const name = manualName.trim();
    const balance = Number(manualBalance);

    if (!name) {
      setManualError("Account name is required.");
      return;
    }

    if (!Number.isFinite(balance)) {
      setManualError("Enter a valid current balance.");
      return;
    }

    if (!manualLastUpdated) {
      setManualError("Last updated is required.");
      return;
    }

    const updatedAt = new Date(`${manualLastUpdated}T12:00:00.000Z`).toISOString();

    const normalizedBalance = normalizeManualBalance(manualType, balance);

    setManualAccounts((prev) => [
      {
        id: `manual-${Date.now()}`,
        name,
        type: manualType,
        balance: normalizedBalance,
        institutionName: manualInstitution.trim() || undefined,
        notes: manualNotes.trim() || undefined,
        updatedAt,
        lastUpdated: manualLastUpdated,
        sourceType: "manual",
      },
      ...prev,
    ]);

    // Record a net worth history point on the account's actual date so the
    // graph reflects the change at the right point in time.
    const accountDayKey = manualLastUpdated;
    const newManualTotal = manualTotalBalance + normalizedBalance;
    setNetWorthHistory((prev) =>
      recordHistoryPoint(prev, accountDayKey, connectedTotalBalance, newManualTotal),
    );

    setManualName("");
    setManualType("checking");
    setManualBalance("");
    setManualInstitution("");
    setManualNotes("");
    setManualLastUpdated(new Date().toISOString().slice(0, 10));
    setManualModalOpen(false);
  };

  if (loading) {
    return (
      <div className="aw-workspace-page flex items-center justify-center py-32">
        <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="aw-workspace-page">
        <div className="rounded-2xl border border-[var(--aw-border)] bg-white px-4 py-3 text-sm text-[var(--aw-text)] shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="aw-workspace-page">
      <WorkspaceHeader
        title="Accounts"
        actions={(
          <>
            <ToolbarButton
              icon={<RefreshCw size={14} />}
              onClick={() => {
                void financialData.refresh();
                void loadFinancialInfra();
              }}
            >
              Refresh all
            </ToolbarButton>
            <ToolbarButton
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => setAddAccountChoiceOpen(true)}
            >
              Add account
            </ToolbarButton>
          </>
        )}
      />

      {(financialInfra || financialInfraLoading) ? (
        <WorkspacePanel
          title="Financial OS Infrastructure"
          action={financialInfraLoading ? (
            <div className="inline-flex items-center gap-2 text-xs text-[var(--aw-text-muted)]">
              <Loader2 size={12} className="animate-spin" />
              Refreshing
            </div>
          ) : null}
        >
          {financialInfra ? (
            <>
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <article className="rounded-xl border border-[var(--aw-border)] bg-white p-3">
                  <p className="text-xs text-[var(--aw-text-muted)]">Connected accounts</p>
                  <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                    {financialInfra.sync.connectedAccountCount}
                  </p>
                </article>
                <article className="rounded-xl border border-[var(--aw-border)] bg-white p-3">
                  <p className="text-xs text-[var(--aw-text-muted)]">Fresh sync</p>
                  <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                    {financialInfra.sync.freshAccountCount}
                  </p>
                </article>
                <article className="rounded-xl border border-[var(--aw-border)] bg-white p-3">
                  <p className="text-xs text-[var(--aw-text-muted)]">Internal transfers</p>
                  <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                    {fmt(financialInfra.moneyFlow.internalTransferAmount)}
                  </p>
                </article>
                <article className="rounded-xl border border-[var(--aw-border)] bg-white p-3">
                  <p className="text-xs text-[var(--aw-text-muted)]">Task center active</p>
                  <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                    {financialInfra.taskCenter.activeCount}
                  </p>
                </article>
              </div>

              {topNotifications.length > 0 ? (
                <div className="mb-4 rounded-xl border border-[var(--aw-border)] bg-white p-3">
                  <p className="text-xs font-semibold text-[var(--aw-text)]">Actionable notifications</p>
                  <div className="mt-2 space-y-2">
                    {topNotifications.map((item) => (
                      <div key={item.id} className="rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[var(--aw-text)]">{item.title}</p>
                          <button
                            type="button"
                            className="text-[11px] text-[var(--aw-text-muted)] hover:text-[var(--aw-text)]"
                            onClick={() => {
                              void dismissFinancialNotification(item.id).then(() => loadFinancialInfra());
                            }}
                          >
                            Dismiss
                          </button>
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">{item.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-[var(--aw-border)] bg-white p-3">
                <p className="text-xs font-semibold text-[var(--aw-text)]">Financial timeline</p>
                <div className="mt-2 space-y-2">
                  {topTimeline.length === 0 ? (
                    <p className="text-xs text-[var(--aw-text-muted)]">No timeline events yet.</p>
                  ) : (
                    topTimeline.map((event) => (
                      <a
                        key={event.id}
                        href={event.deepLink}
                        className="block rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2 transition hover:border-[var(--aw-border-strong)]"
                      >
                        <p className="text-xs font-semibold text-[var(--aw-text)]">{event.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">{event.summary}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--aw-text-muted)]">
                          {new Date(event.occurredAt).toLocaleDateString()} · {event.priority.toUpperCase()}
                        </p>
                      </a>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-[var(--aw-border)] bg-white px-4 py-3 text-sm text-[var(--aw-text-muted)]">
              Loading background sync status...
            </div>
          )}
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel title="Net worth">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <p className="aw-number text-3xl font-semibold tracking-[-0.03em] text-[var(--aw-text)]">
            {fmt(summary.netWorth)}
          </p>
          {accountRows.length > 0 ? (
            <p className="pb-0.5 text-xs text-[var(--aw-text-muted)]">
              Unified history
            </p>
          ) : null}
        </div>

        {chartData.length === 0 ? (
          <div className="flex h-[180px] flex-col items-center justify-center text-center">
            <p className="text-sm text-[var(--aw-text-muted)]">
              Add an account to start tracking your net worth over time.
            </p>
          </div>
        ) : (
          <NetWorthTrendChart data={chartData} />
        )}
      </WorkspacePanel>

      <div className="aw-workspace-grid mt-4" data-columns="2-1">
        <WorkspacePanel title="Accounts list">
          {accountRows.length === 0 ? (
            <WorkspaceEmpty
              icon={<Landmark size={22} />}
              title="No accounts yet"
              description="Connect your first account, or add one manually."
              action={(
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => router.push("/connect")}
                    className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Connect your first account
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualModalOpen(true)}
                    className="aw-button-primary inline-flex h-11 items-center rounded-xl px-5 text-sm"
                  >
                    Add account manually
                  </button>
                </div>
              )}
              className="min-h-[280px]"
            />
          ) : (
            <div className="aw-card-table">
              <div className="grid grid-cols-[minmax(0,1.5fr)_130px_180px] gap-4 border-b border-[var(--aw-border)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
                <span>Account</span>
                <span className="text-right">Balance</span>
                <span className="text-right">Last updated</span>
              </div>
              {accountRows.map((account) => (
                <div
                  key={account.id}
                  className="grid grid-cols-[minmax(0,1.5fr)_130px_180px] gap-4 border-t border-[var(--aw-border)] px-4 py-4 transition hover:bg-[var(--aw-primary-soft)]/40 first:border-t-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--aw-text)]">{account.label}</p>
                      {account.sourceType === "manual" ? <span className="aw-pill">{sourceTypeUiLabel(account.sourceType)}</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-[var(--aw-text-muted)]">{account.subtitle}</p>
                    {account.notes ? (
                      <p className="mt-1 text-xs text-[var(--aw-text-muted)]">{account.notes}</p>
                    ) : null}
                  </div>
                  <p className={`aw-number text-right text-sm ${account.balance < 0 ? "text-[var(--aw-danger)]" : "text-[var(--aw-text)]"}`}>
                    {fmt(account.balance)}
                  </p>
                  <p className="text-right text-sm text-[var(--aw-text-muted)]">{account.updatedLabel}</p>
                </div>
              ))}
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel title="Summary">
          <div className="space-y-5">
            <div className="aw-card aw-card-compact">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Connected balances</p>
              <p className="aw-number mt-3 text-2xl text-[var(--aw-text)]">{fmt(summary.connectedBalance)}</p>
              <p className="mt-1 text-xs text-[var(--aw-text-muted)]">Synced accounts</p>
            </div>

            <div className="aw-card aw-card-compact">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Manual balances</p>
              <p className={`aw-number mt-3 text-2xl ${summary.manualBalance < 0 ? "text-[var(--aw-danger)]" : "text-[var(--aw-text)]"}`}>
                {fmt(summary.manualBalance)}
              </p>
              <p className="mt-1 text-xs text-[var(--aw-text-muted)]">Manual accounts</p>
            </div>

            <div className="rounded-[16px] border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--aw-text-muted)]">Total assets</span>
                <span className="aw-number text-[var(--aw-text)]">{fmt(summary.totalAssets)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-[var(--aw-text-muted)]">Total liabilities</span>
                <span className="aw-number text-[var(--aw-text)]">{fmt(summary.totalLiabilities)}</span>
              </div>
              <div className="mt-3 border-t border-[var(--aw-border)] pt-3">
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span className="text-[var(--aw-text)]">Net worth</span>
                  <span className="aw-number text-[var(--aw-text)]">{fmt(summary.netWorth)}</span>
                </div>
              </div>
            </div>
          </div>
        </WorkspacePanel>
      </div>

      <ManualEntryModal
        open={addAccountChoiceOpen}
        onClose={() => setAddAccountChoiceOpen(false)}
        title="Add account"
        description="Choose how you want to add an account to Calico."
      >
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              setAddAccountChoiceOpen(false);
              router.push("/connect");
            }}
            className="flex w-full items-start justify-between rounded-2xl border border-[var(--aw-border)] bg-white px-4 py-4 text-left transition hover:border-[var(--aw-primary)]/30 hover:bg-[var(--aw-primary-soft)]/40"
          >
            <div>
              <p className="text-sm font-semibold text-[var(--aw-text)]">Connect account</p>
              <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                Sync balances and transactions from your bank, card, or provider.
              </p>
            </div>
            <span className="aw-pill">Synced</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAddAccountChoiceOpen(false);
              setManualModalOpen(true);
            }}
            className="flex w-full items-start justify-between rounded-2xl border border-[var(--aw-border)] bg-white px-4 py-4 text-left transition hover:border-[var(--aw-primary)]/30 hover:bg-[var(--aw-primary-soft)]/40"
          >
            <div>
              <p className="text-sm font-semibold text-[var(--aw-text)]">Add account manually</p>
              <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                Create a manual account with your current balance and track it alongside synced data.
              </p>
            </div>
            <span className="aw-pill">Manual</span>
          </button>

          <div className="pt-1 text-right">
            <button
              type="button"
              onClick={() => setAddAccountChoiceOpen(false)}
              className="aw-button-secondary h-10 px-4 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </ManualEntryModal>

      <ManualEntryModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Add manual account"
        description="Create a local account record with your current balance."
      >
        <div className="space-y-4">
          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Account name</span>
            <input
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
              className="aw-input h-10 text-sm"
              placeholder="Main checking"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Account type</span>
              <select
                value={manualType}
                onChange={(event) => setManualType(event.target.value as ManualAccountType)}
                className="aw-input h-10 text-sm"
              >
                {MANUAL_ACCOUNT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Current balance</span>
              <input
                value={manualBalance}
                onChange={(event) => setManualBalance(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                step="0.01"
                placeholder="0.00"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Institution name (optional)</span>
              <ComboboxInput
                value={manualInstitution}
                onChange={setManualInstitution}
                options={(() => {
                  const names = manualAccounts
                    .map((a) => (a.institutionName || "").trim())
                    .filter((n) => n.length > 0);
                  return [...new Set(names)].sort();
                })()}
                placeholder="Select or type institution"
                allowCustom
                customLabel="Add new institution"
              />
            </div>

            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Last updated</span>
              <input
                value={manualLastUpdated}
                onChange={(event) => setManualLastUpdated(event.target.value)}
                className="aw-input h-10 text-sm"
                type="date"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Notes (optional)</span>
            <textarea
              value={manualNotes}
              onChange={(event) => setManualNotes(event.target.value)}
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
              onClick={onCreateManualAccount}
              className="aw-button-primary h-10 px-4 text-sm"
            >
              Save account
            </button>
          </div>
        </div>
      </ManualEntryModal>
    </div>
  );
}
