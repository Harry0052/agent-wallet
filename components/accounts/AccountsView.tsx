"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Loader2, Plus, RefreshCw } from "lucide-react";
import {
  fetchConnectedAccountsBundle,
  type ConnectedAccountRecord,
  type ConnectedInstitutionRecord,
} from "@/services/connect";
import {
  dismissFinancialNotification,
  fetchFinancialOsDashboard,
} from "@/services/financialOs";
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

interface AccountsBundle {
  accounts: ConnectedAccountRecord[];
  institutions: ConnectedInstitutionRecord[];
}

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

function NetWorthTrendChart(props: { data: TrendPoint[] }) {
  const chartWidth = 100;
  const chartHeight = 64;
  const paddingX = 8;
  const paddingY = 8;
  const values = props.data.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const hasVariance = maxValue !== minValue;
  const domainMin = hasVariance ? minValue : minValue - Math.max(Math.abs(minValue) * 0.04, 1);
  const domainMax = hasVariance ? maxValue : maxValue + Math.max(Math.abs(maxValue) * 0.04, 1);
  const range = Math.max(domainMax - domainMin, 1);
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / (tickCount - 1);
    return domainMax - ratio * range;
  });
  const usableWidth = chartWidth - paddingX * 2;
  const usableHeight = chartHeight - paddingY * 2;
  const points = props.data.map((point, index) => {
    const x = props.data.length === 1
      ? chartWidth / 2
      : paddingX + (usableWidth * index) / (props.data.length - 1);
    const y = paddingY + ((domainMax - point.value) / range) * usableHeight;
    return {
      ...point,
      x,
      y,
    };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="grid gap-3 md:grid-cols-[72px_minmax(0,1fr)]">
      <div className="hidden h-[248px] flex-col justify-between py-1 text-[11px] text-[var(--aw-text-muted)] md:flex">
        {ticks.map((tick) => (
          <span key={tick} className="aw-number">
            {fmt(tick)}
          </span>
        ))}
      </div>

      <div className="min-w-0">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="none"
          className="h-[248px] w-full"
          aria-label="Net worth trend"
          role="img"
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
                stroke="var(--aw-chart-grid)"
                strokeWidth="0.6"
              />
            );
          })}
          <polyline
            fill="none"
            stroke="var(--aw-chart-primary)"
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={polyline}
          />
          {points.map((point) => (
            <circle
              key={`${point.label}-${point.value}`}
              cx={point.x}
              cy={point.y}
              r="1.9"
              fill="var(--aw-chart-primary)"
              stroke="#ffffff"
              strokeWidth="0.9"
            />
          ))}
        </svg>

        <div
          className="mt-3 grid gap-2 text-[11px] text-[var(--aw-text-muted)]"
          style={{ gridTemplateColumns: `repeat(${props.data.length}, minmax(0, 1fr))` }}
        >
          {props.data.map((point) => (
            <span key={`${point.label}-${point.value}`} className="truncate text-center">
              {point.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AccountsView() {
  const router = useRouter();
  const [bundle, setBundle] = useState<AccountsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    const requestId = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestId;
    setLoading(true);
    setError(null);
    setFinancialInfraLoading(true);

    const accountsResult = await fetchConnectedAccountsBundle().then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason) => ({ status: "rejected" as const, reason }),
    );

    if (requestId !== loadSequenceRef.current) {
      return;
    }

    if (accountsResult.status === "fulfilled") {
      setBundle(accountsResult.value);
    } else {
      setBundle(null);
      setError(accountsResult.reason instanceof Error ? accountsResult.reason.message : "Failed to load accounts.");
    }

    setLoading(false);

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
    void load();
  }, [load]);

  const connectedAccounts = bundle?.accounts ?? [];

  const connectedKnownBalanceSum = connectedAccounts.reduce(
    (sum, account) => sum + (typeof account.balance === "number" ? account.balance : 0),
    0,
  );
  const connectedKnownBalanceCount = connectedAccounts.filter(
    (account) => typeof account.balance === "number",
  ).length;

  const connectedTotalBalance =
    connectedKnownBalanceSum;

  const connectedAverageBalance =
    connectedKnownBalanceCount > 0
      ? connectedKnownBalanceSum / connectedKnownBalanceCount
      : 0;

  const summary = useMemo(() => summarizeAccounts([
    ...connectedAccounts,
    ...manualAccounts.map(manualAccountToConnected),
  ]), [connectedAccounts, manualAccounts]);
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
                void load();
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
                              void dismissFinancialNotification(item.id).then(() => load());
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

      <WorkspacePanel title="Net worth chart">
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <p className="aw-number text-4xl tracking-[-0.04em] text-[var(--aw-text)]">
            {fmt(summary.netWorth)}
          </p>
          <p className="pb-1 text-sm text-[var(--aw-text-muted)]">
            {accountRows.length > 0
              ? "Unified account history"
              : "Add an account to begin tracking"}
          </p>
        </div>

        <div className="min-w-0 rounded-[16px] border border-[var(--aw-border)] bg-white px-3 py-4">
          {chartData.length === 0 ? (
            <div className="flex h-[248px] flex-col items-center justify-center text-center">
              <p className="text-sm text-[var(--aw-text-muted)]">
                Add an account to start tracking your net worth over time.
              </p>
            </div>
          ) : (
            <NetWorthTrendChart data={chartData} />
          )}
        </div>
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
