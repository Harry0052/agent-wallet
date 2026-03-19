"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Landmark, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  connectAccountsViaSupportedFlow,
  fetchConnectedAccountsBundle,
  removeConnectedAccount,
  syncConnectedTransactions,
  type ConnectedAccountRecord,
} from "@/services/connect";
import { fmt, fmtDate } from "@/lib/utils";
import {
  DataSourceToggle,
  ManualEntryButton,
  ManualEntryModal,
  type DataSourceMode,
} from "@/components/finance/ManualDataControls";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import {
  MANUAL_STORAGE_KEYS,
  type ManualAccountRecord,
  type ManualAccountType,
} from "@/lib/manualMode";

const MANUAL_ACCOUNT_OPTIONS: Array<{ value: ManualAccountType; label: string }> = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "cash", label: "Cash account" },
  { value: "credit", label: "Credit card" },
  { value: "loan", label: "Loan" },
];

function accountHealth(account: ConnectedAccountRecord): "healthy" | "stale" {
  if (!account.last_synced_at) return "stale";
  const ageMs = Date.now() - Date.parse(account.last_synced_at);
  return ageMs <= 1000 * 60 * 60 * 24 * 3 ? "healthy" : "stale";
}

function toConnectionFlowError(error: unknown): {
  message: string;
  isConfig: boolean;
} {
  const raw = error instanceof Error ? error.message : "Account linking failed.";
  const lower = raw.toLowerCase();
  if (
    lower.includes("plaid") ||
    lower.includes("link token") ||
    lower.includes("client_id") ||
    lower.includes("secret") ||
    lower.includes("missing required")
  ) {
    return {
      message: "Account linking isn't available right now. Please try again later.",
      isConfig: true,
    };
  }
  if (lower.includes("canceled")) {
    return { message: "Account linking was canceled.", isConfig: false };
  }
  return { message: raw, isConfig: false };
}

function normalizeManualBalance(type: ManualAccountType, amount: number): number {
  if (type === "credit" || type === "loan") {
    return -Math.abs(amount);
  }
  return amount;
}

export function ConnectWorkspace() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccountRecord[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<DataSourceMode>("connected");
  const [manualAccounts, setManualAccounts] = useLocalStorageState<ManualAccountRecord[]>(
    MANUAL_STORAGE_KEYS.accounts,
    [],
    { broadcast: false },
  );
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualType, setManualType] = useState<ManualAccountType>("checking");
  const [manualMask, setManualMask] = useState("");
  const [manualBalance, setManualBalance] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (sourceMode !== "connected") {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const bundle = await fetchConnectedAccountsBundle();
      setAccounts(bundle.accounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  }, [sourceMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const onLink = async () => {
    setError(null);
    setNotice(null);
    setLinking(true);
    try {
      const result = await connectAccountsViaSupportedFlow();
      if (result.accounts.length > 0) {
        setNotice(
          `Connected ${result.accounts.length} account${result.accounts.length === 1 ? "" : "s"}.`,
        );
        setSyncing(true);
        try {
          await syncConnectedTransactions();
        } catch {
          // sync can fail silently
        }
        setSyncing(false);
      } else {
        setNotice("No accounts were linked.");
      }
      await load();
    } catch (e) {
      const parsed = toConnectionFlowError(e);
      setError(parsed.message);
    } finally {
      setLinking(false);
    }
  };

  const onRemove = async (account: ConnectedAccountRecord) => {
    const label = account.nickname || `${account.institution_name} ••••${account.mask}`;
    if (!window.confirm(`Remove ${label}?`)) return;
    setRemovingId(account.id);
    try {
      await removeConnectedAccount(account.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove account.");
    } finally {
      setRemovingId(null);
    }
  };

  const addManualAccount = () => {
    setManualError(null);
    const name = manualName.trim();
    const balance = Number(manualBalance);

    if (!name) {
      setManualError("Account name is required.");
      return;
    }

    if (!Number.isFinite(balance)) {
      setManualError("Enter a valid balance.");
      return;
    }

    setManualAccounts((prev) => [
      {
        id: `manual-${Date.now()}`,
        name,
        type: manualType,
        mask: manualMask.trim() || undefined,
        balance: normalizeManualBalance(manualType, balance),
        updatedAt: new Date().toISOString(),
        sourceType: "manual",
      },
      ...prev,
    ]);

    setManualName("");
    setManualType("checking");
    setManualMask("");
    setManualBalance("");
    setManualModalOpen(false);
  };

  return (
    <div className="aw-page">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--aw-text-muted)] transition-colors hover:text-[var(--aw-text)]"
      >
        <ArrowLeft size={15} />
        Settings
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--aw-text)]">
            Connected Accounts
          </h1>
          <p className="mt-1 text-sm text-[var(--aw-text-muted)]">
            Manage bank connections or track accounts manually.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DataSourceToggle mode={sourceMode} onChange={setSourceMode} />
          {sourceMode === "connected" ? (
            <button
              type="button"
              onClick={() => {
                void onLink();
              }}
              disabled={linking || syncing}
              className="aw-button-primary inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold"
            >
              {linking ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {linking ? "Linking..." : syncing ? "Syncing..." : "Connect account"}
            </button>
          ) : null}
          <ManualEntryButton onClick={() => setManualModalOpen(true)}>
            Add account manually
          </ManualEntryButton>
        </div>
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-[var(--aw-success)]/20 bg-[var(--aw-success)]/10 px-4 py-3 text-sm text-[var(--aw-success)]">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-[var(--aw-danger)]/20 bg-[var(--aw-danger)]/10 px-4 py-3 text-sm text-[var(--aw-danger)]">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
        </div>
      ) : sourceMode === "manual" ? (
        manualAccounts.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)]">
              <Landmark size={24} className="text-[var(--aw-text-muted)]" />
            </div>
            <p className="mt-5 text-[15px] font-medium text-[var(--aw-text)]">
              No manual accounts yet
            </p>
            <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-[var(--aw-text-muted)]">
              Add an account manually to track balances without a provider connection.
            </p>
            <button
              type="button"
              onClick={() => setManualModalOpen(true)}
              className="aw-button-primary mt-6 inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold"
            >
              Add account manually
            </button>
          </div>
        ) : (
          <div className="mt-6 divide-y divide-[var(--aw-border)] overflow-hidden rounded-xl border border-[var(--aw-border)] bg-white">
            {manualAccounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-[var(--aw-text)]">{account.name}</p>
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--aw-primary)]" />
                    <span className="aw-pill">Manual</span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
                    {account.type}
                    {account.mask ? ` •••• ${account.mask}` : ""} · Added {fmtDate(account.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <p className={`aw-number text-sm ${account.balance < 0 ? "text-[var(--aw-danger)]" : "text-[var(--aw-text)]"}`}>
                    {fmt(account.balance)}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setManualAccounts((prev) => prev.filter((entry) => entry.id !== account.id))
                    }
                    className="rounded-lg p-2 text-[var(--aw-text-muted)] transition hover:bg-[var(--aw-danger)]/10 hover:text-[var(--aw-danger)]"
                    title="Remove account"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)]">
            <Landmark size={24} className="text-[var(--aw-text-muted)]" />
          </div>
          <p className="mt-5 text-[15px] font-medium text-[var(--aw-text)]">No accounts connected</p>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-[var(--aw-text-muted)]">
            Link a bank or credit card to sync automatically, or track your finances manually.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                void onLink();
              }}
              disabled={linking}
              className="aw-button-secondary inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold"
            >
              {linking ? "Linking..." : "Connect account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceMode("manual");
                setManualModalOpen(true);
              }}
              className="aw-button-primary inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold"
            >
              Add account manually
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 divide-y divide-[var(--aw-border)] overflow-hidden rounded-xl border border-[var(--aw-border)] bg-white">
          {accounts.map((account) => {
            const health = accountHealth(account);
            const label =
              account.nickname || `${account.institution_name} ••••${account.mask}`;
            return (
              <div key={account.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-[var(--aw-text)]">{label}</p>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        health === "healthy" ? "bg-[var(--aw-success)]" : "bg-[var(--aw-warning)]"
                      }`}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--aw-text-muted)]">
                    {account.account_type}
                    {account.last_synced_at
                      ? ` · Synced ${fmtDate(account.last_synced_at)}`
                      : " · Not yet synced"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void onRemove(account);
                  }}
                  disabled={removingId === account.id}
                  className="rounded-lg p-2 text-[var(--aw-text-muted)] transition hover:bg-[var(--aw-danger)]/10 hover:text-[var(--aw-danger)] disabled:opacity-40"
                  title="Remove account"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <ManualEntryModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Add manual account"
        description="Create a local account entry for manual tracking."
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
              <span className="text-xs text-[var(--aw-text-muted)]">Type</span>
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
              <span className="text-xs text-[var(--aw-text-muted)]">Last 4 (optional)</span>
              <input
                value={manualMask}
                onChange={(event) => setManualMask(event.target.value.replace(/\D/g, "").slice(-4))}
                className="aw-input h-10 text-sm"
                placeholder="1234"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">
              {manualType === "loan" || manualType === "credit"
                ? "Current balance owed"
                : "Current balance"}
            </span>
            <input
              value={manualBalance}
              onChange={(event) => setManualBalance(event.target.value)}
              className="aw-input h-10 text-sm"
              type="number"
              step="0.01"
              placeholder="0.00"
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
              onClick={addManualAccount}
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
