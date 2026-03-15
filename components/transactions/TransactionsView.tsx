"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  CalendarDays,
  Filter,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { fmt, fmtDate } from "@/lib/utils";
import {
  fetchUnifiedStatement,
  type StatementTransaction,
  type UnifiedStatement,
} from "@/services/statements";
import { fetchConnectedAccountsBundle, type ConnectedAccountRecord } from "@/services/connect";
import {
  ToolbarButton,
  WorkspaceHeader,
  WorkspaceEmpty,
  WorkspacePanel,
} from "@/components/finance/WorkspacePrimitives";
import { ManualEntryModal } from "@/components/finance/ManualDataControls";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { MANUAL_STORAGE_KEYS, type ManualAccountRecord } from "@/lib/manualMode";
import { normalizeTransactionType, type ManualTransactionType } from "@/lib/manualTransactions";

type FilterMode = "all" | "income" | "expense" | "transfer" | "recurring";

interface AccountOption {
  id: string;
  name: string;
}

const FILTER_LABELS: Array<{ key: FilterMode; label: string }> = [
  { key: "all", label: "All" },
  { key: "income", label: "Income" },
  { key: "expense", label: "Expense" },
  { key: "transfer", label: "Transfer" },
  { key: "recurring", label: "Recurring" },
];

function sortByDateDesc(a: StatementTransaction, b: StatementTransaction): number {
  return Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
}

export function TransactionsView() {
  const [statement, setStatement] = useState<UnifiedStatement | null>(null);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [manualTransactions, setManualTransactions] = useLocalStorageState<StatementTransaction[]>(
    MANUAL_STORAGE_KEYS.transactions,
    [],
  );
  const [manualAccounts] = useLocalStorageState<ManualAccountRecord[]>(
    MANUAL_STORAGE_KEYS.accounts,
    [],
  );

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualAmount, setManualAmount] = useState("");
  const [manualType, setManualType] = useState<ManualTransactionType>("expense");
  const [manualCategory, setManualCategory] = useState("");
  const [manualMerchantOrSource, setManualMerchantOrSource] = useState("");
  const [manualAccountId, setManualAccountId] = useState("manual");
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualNotes, setManualNotes] = useState("");
  const [manualRecurring, setManualRecurring] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [statementResult, accountsResult] = await Promise.allSettled([
      fetchUnifiedStatement({ page_size: 120 }),
      fetchConnectedAccountsBundle(),
    ]);

    if (statementResult.status === "fulfilled") {
      setStatement(statementResult.value);
    } else {
      setStatement(null);
      const message = statementResult.reason instanceof Error
        ? statementResult.reason.message
        : "Failed to load transactions.";
      const safeNoDataError = /no\s+connected|no\s+account|not\s+connected|empty/i.test(message);
      if (!safeNoDataError) {
        setError(message);
      }
    }

    if (accountsResult.status === "fulfilled") {
      setConnectedAccounts(accountsResult.value.accounts);
    } else {
      setConnectedAccounts([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const accountOptions = useMemo<AccountOption[]>(() => {
    const fromConnected: AccountOption[] = connectedAccounts.map((account) => ({
      id: account.id,
      name: account.nickname || `${account.institution_name} •••• ${account.mask}`,
    }));

    const fromManual: AccountOption[] = manualAccounts.map((account) => ({
      id: account.id,
      name: account.name,
    }));

    return [
      { id: "manual", name: "Manual account" },
      ...fromConnected,
      ...fromManual,
    ];
  }, [connectedAccounts, manualAccounts]);

  const mergedTransactions = useMemo(() => {
    const connected = statement?.transactions ?? [];
    const byId = new Map<string, StatementTransaction>();

    for (const tx of [...connected, ...manualTransactions]) {
      byId.set(tx.id, tx);
    }

    return [...byId.values()].sort(sortByDateDesc);
  }, [manualTransactions, statement?.transactions]);

  const filteredTransactions = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();

    return mergedTransactions.filter((tx) => {
      const transactionType = normalizeTransactionType(tx);
      const merchant = (tx.merchant_name || tx.normalized_merchant || "").toLowerCase();
      const category = (tx.category || "").toLowerCase();
      const accountName = (tx.account_name || "").toLowerCase();
      const notes = (tx.notes || "").toLowerCase();

      const matchesQuery =
        query.length === 0
        || merchant.includes(query)
        || category.includes(query)
        || accountName.includes(query)
        || notes.includes(query);

      if (!matchesQuery) return false;

      if (filterMode === "income") return transactionType === "income";
      if (filterMode === "expense") return transactionType === "expense";
      if (filterMode === "transfer") return transactionType === "transfer";
      if (filterMode === "recurring") return Boolean(tx.recurring);
      return true;
    });
  }, [debouncedSearch, filterMode, mergedTransactions]);

  const openManualTransaction = () => {
    setManualModalOpen(true);
  };

  const addManualTransaction = () => {
    setManualError(null);
    const amount = Number(manualAmount);
    const merchantOrSource = manualMerchantOrSource.trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      setManualError("Amount must be greater than zero.");
      return;
    }

    if (!merchantOrSource) {
      setManualError("Merchant or source is required.");
      return;
    }

    if (!manualDate) {
      setManualError("Date is required.");
      return;
    }

    const signedAmount = manualType === "income" ? Math.abs(amount) : -Math.abs(amount);
    const selectedAccount = accountOptions.find((option) => option.id === manualAccountId);

    setManualTransactions((prev) => [
      {
        id: `manual-${Date.now()}`,
        user_id: "manual",
        linked_account_id: manualAccountId,
        merchant_name: merchantOrSource,
        normalized_merchant: merchantOrSource.toLowerCase(),
        amount: signedAmount,
        currency: "USD",
        category: manualCategory.trim() || "Manual",
        pending: false,
        occurred_at: new Date(`${manualDate}T12:00:00.000Z`).toISOString(),
        transaction_type: manualType,
        account_name: selectedAccount?.name,
        notes: manualNotes.trim() || undefined,
        recurring: manualRecurring,
        sourceType: "manual",
      },
      ...prev,
    ]);

    setManualAmount("");
    setManualType("expense");
    setManualCategory("");
    setManualMerchantOrSource("");
    setManualAccountId("manual");
    setManualDate(new Date().toISOString().slice(0, 10));
    setManualNotes("");
    setManualRecurring(false);
    setManualModalOpen(false);
  };

  return (
    <div className="aw-workspace-page">
      <WorkspaceHeader
        title="Transactions"
        actions={(
          <>
            <div className="relative min-w-[220px]">
              <Search
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--aw-text-muted)]"
              />
              <input
                type="text"
                placeholder="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="aw-input h-[38px] rounded-xl pl-10 text-sm"
              />
            </div>
            <ToolbarButton icon={<CalendarDays size={14} />}>Date</ToolbarButton>
            <ToolbarButton icon={<Filter size={14} />}>Filters</ToolbarButton>
            <button
              type="button"
              onClick={openManualTransaction}
              className="aw-button-primary inline-flex h-[38px] items-center gap-1.5 rounded-xl px-4 text-sm"
            >
              <Plus size={14} />
              Add
            </button>
          </>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTER_LABELS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilterMode(item.key)}
            className="aw-toolbar-btn"
            data-active={filterMode === item.key ? "true" : "false"}
          >
            {item.label}
          </button>
        ))}
        <p className="ml-auto text-xs font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
          {filteredTransactions.length} transaction{filteredTransactions.length === 1 ? "" : "s"}
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-[var(--aw-border)] bg-white px-4 py-3 text-sm text-[var(--aw-text)]">
          {error}
        </div>
      ) : null}

      <WorkspacePanel>
        {loading ? (
          <div className="flex min-h-[480px] items-center justify-center">
            <Loader2 size={20} className="animate-spin text-[var(--aw-primary)]" />
          </div>
        ) : filteredTransactions.length === 0 ? (
          <WorkspaceEmpty
            icon={<ArrowLeftRight size={22} />}
            title="No transactions yet"
            description={connectedAccounts.length === 0
              ? "Connect an account or add a transaction manually to get started."
              : "No matching transactions for these filters. Connect another account or add a transaction manually."}
            action={(
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="aw-button-secondary inline-flex h-11 items-center rounded-[10px] px-5 text-sm"
                  onClick={() => {
                    window.location.href = "/connect";
                  }}
                >
                  Connect an account
                </button>
                <button
                  type="button"
                  className="aw-button-primary inline-flex h-11 items-center rounded-[10px] px-5 text-sm"
                  onClick={openManualTransaction}
                >
                  Add transaction manually
                </button>
              </div>
            )}
            className="min-h-[520px]"
          />
        ) : (
          <div className="aw-card-table">
            <div className="grid grid-cols-[minmax(0,1.2fr)_180px_120px_130px] gap-4 border-b border-[var(--aw-border)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">
              <span>Transaction</span>
              <span>Account</span>
              <span className="text-right">Date</span>
              <span className="text-right">Amount</span>
            </div>
            {filteredTransactions.map((tx) => {
              const transactionType = normalizeTransactionType(tx);
              const displayAmount = Math.abs(tx.amount);

              return (
                <div
                  key={tx.id}
                  className="grid grid-cols-[minmax(0,1.2fr)_180px_120px_130px] gap-4 border-t border-[var(--aw-border)] px-4 py-4 transition hover:bg-[var(--aw-primary-soft)]/40 first:border-t-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--aw-text)]">
                        {tx.merchant_name || tx.normalized_merchant}
                      </p>
                      {tx.sourceType === "manual" ? <span className="aw-pill">Manual</span> : null}
                      {tx.recurring ? <span className="aw-pill">Recurring</span> : null}
                      <span className="aw-pill">{transactionType}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--aw-text-muted)]">
                      {tx.category || "Uncategorized"}
                      {tx.notes ? ` • ${tx.notes}` : ""}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--aw-text)]">{tx.account_name || "-"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-[var(--aw-text)]">{fmtDate(tx.occurred_at)}</p>
                    {tx.pending ? (
                      <span className="mt-1 block text-[11px] font-semibold text-[var(--aw-primary)]">
                        Pending
                      </span>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p
                      className={`aw-number text-sm ${
                        transactionType === "income"
                          ? "text-[var(--aw-success)]"
                          : transactionType === "transfer"
                            ? "text-[var(--aw-primary)]"
                            : "text-[var(--aw-text)]"
                      }`}
                    >
                      {transactionType === "income" ? "+" : "-"}
                      {fmt(displayAmount)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </WorkspacePanel>

      <ManualEntryModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Add manual transaction"
        description="Create a transaction without a connected account."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Amount</span>
              <input
                value={manualAmount}
                onChange={(event) => setManualAmount(event.target.value)}
                className="aw-input h-10 text-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Type</span>
              <select
                value={manualType}
                onChange={(event) => setManualType(event.target.value as ManualTransactionType)}
                className="aw-input h-10 text-sm"
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="transfer">Transfer</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Category</span>
              <input
                value={manualCategory}
                onChange={(event) => setManualCategory(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Groceries"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Merchant or source</span>
              <input
                value={manualMerchantOrSource}
                onChange={(event) => setManualMerchantOrSource(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Payroll"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Account</span>
              <select
                value={manualAccountId}
                onChange={(event) => setManualAccountId(event.target.value)}
                className="aw-input h-10 text-sm"
              >
                {accountOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Date</span>
              <input
                value={manualDate}
                onChange={(event) => setManualDate(event.target.value)}
                className="aw-input h-10 text-sm"
                type="date"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs text-[var(--aw-text-muted)]">Notes</span>
            <textarea
              value={manualNotes}
              onChange={(event) => setManualNotes(event.target.value)}
              className="aw-input min-h-[92px] py-2 text-sm"
              placeholder="Optional notes"
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5 text-sm text-[var(--aw-text)]">
            <input
              checked={manualRecurring}
              onChange={(event) => setManualRecurring(event.target.checked)}
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--aw-border)] text-[var(--aw-primary)] focus:ring-[var(--aw-primary)]"
            />
            Mark as recurring (optional)
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
              onClick={addManualTransaction}
              className="aw-button-primary h-10 px-4 text-sm"
            >
              Save transaction
            </button>
          </div>
        </div>
      </ManualEntryModal>
    </div>
  );
}
