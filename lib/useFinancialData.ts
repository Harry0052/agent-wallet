"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchConnectedAccountsBundle,
  type ConnectedAccountRecord,
} from "@/services/connect";
import {
  fetchUnifiedStatement,
  fetchSuspectedSubscriptions,
  type DetectedSubscription,
  type StatementTransaction,
} from "@/services/statements";
import {
  MANUAL_STORAGE_KEYS,
  readLocalStorageJson,
  type ManualAccountRecord,
} from "@/lib/manualMode";
import { normalizeTransactionType } from "@/lib/manualTransactions";
import { normalizeRecordSourceType } from "@/lib/sourceType";
import {
  cashflowToTransactions,
  reportsToTransactions,
  deduplicateTransactions,
  manualAccountToConnected,
  type ManualCashflowEntry,
  type ManualReportEntry,
  type ManualRecurringItem,
  type FinancialSummary,
} from "@/lib/financialTypes";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FinancialData {
  /** Loading state for initial fetch */
  loading: boolean;
  /** Error message if initial fetch failed */
  error: string | null;

  /** Connected accounts from Plaid */
  connectedAccounts: ConnectedAccountRecord[];
  /** Manual accounts from localStorage */
  manualAccounts: ManualAccountRecord[];
  /** All accounts merged (connected + manual) */
  allAccounts: ConnectedAccountRecord[];

  /** Connected transactions from API */
  connectedTransactions: StatementTransaction[];
  /** Manual transactions from localStorage */
  manualTransactions: StatementTransaction[];
  /** All transactions merged and deduplicated */
  allTransactions: StatementTransaction[];

  /** Connected recurring items */
  connectedRecurring: DetectedSubscription[];
  /** Manual recurring items */
  manualRecurring: ManualRecurringItem[];
  /** All recurring merged */
  allRecurring: DetectedSubscription[];

  /** Centrally computed financial summary */
  summary: FinancialSummary;

  /** Refresh all data from APIs + localStorage */
  refresh: () => Promise<void>;

  /** Epoch counter that increments on every data change (for dependency tracking) */
  epoch: number;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Shared financial data hook.
 *
 * Fetches connected data from APIs, reads manual data from localStorage,
 * merges them into a single unified dataset, and derives summary metrics.
 *
 * Listens for `storage` events so manual data changes in other tabs/components
 * are picked up automatically.
 */
export function useFinancialData(): FinancialData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Connected data (from API)
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccountRecord[]>([]);
  const [connectedTransactions, setConnectedTransactions] = useState<StatementTransaction[]>([]);
  const [connectedRecurring, setConnectedRecurring] = useState<DetectedSubscription[]>([]);

  // Manual data (from localStorage — re-read on every refresh / storage event)
  const [manualAccounts, setManualAccounts] = useState<ManualAccountRecord[]>([]);
  const [manualTransactions, setManualTransactions] = useState<StatementTransaction[]>([]);
  const [manualCashflow, setManualCashflow] = useState<ManualCashflowEntry[]>([]);
  const [manualReports, setManualReports] = useState<ManualReportEntry[]>([]);
  const [manualRecurring, setManualRecurring] = useState<ManualRecurringItem[]>([]);

  const [epoch, setEpoch] = useState(0);
  const mountedRef = useRef(true);

  // ── Read all manual data from localStorage ──────────────────────────────
  const readManualData = useCallback(() => {
    setManualAccounts(
      readLocalStorageJson<ManualAccountRecord[]>(MANUAL_STORAGE_KEYS.accounts, []),
    );
    setManualTransactions(
      readLocalStorageJson<StatementTransaction[]>(MANUAL_STORAGE_KEYS.transactions, []),
    );
    setManualCashflow(
      readLocalStorageJson<ManualCashflowEntry[]>(MANUAL_STORAGE_KEYS.cashflow, []),
    );
    setManualReports(
      readLocalStorageJson<ManualReportEntry[]>(MANUAL_STORAGE_KEYS.reports, []),
    );
    setManualRecurring(
      readLocalStorageJson<ManualRecurringItem[]>(MANUAL_STORAGE_KEYS.recurring, []),
    );
    setEpoch((prev) => prev + 1);
  }, []);

  // ── Fetch connected data from APIs ──────────────────────────────────────
  const fetchConnectedData = useCallback(async () => {
    const [accountsResult, statementResult, recurringResult] = await Promise.allSettled([
      fetchConnectedAccountsBundle(),
      fetchUnifiedStatement({ page_size: 160 }),
      fetchSuspectedSubscriptions(),
    ]);

    if (accountsResult.status === "fulfilled") {
      setConnectedAccounts(accountsResult.value.accounts);
    } else {
      setConnectedAccounts([]);
    }

    if (statementResult.status === "fulfilled") {
      setConnectedTransactions(statementResult.value.transactions ?? []);
    } else {
      setConnectedTransactions([]);
      // Only set error for real failures, not "no accounts connected"
      const message =
        statementResult.reason instanceof Error
          ? statementResult.reason.message
          : "Failed to load transactions.";
      const isNoDataError = /no\s+connected|no\s+account|not\s+connected|empty/i.test(message);
      if (!isNoDataError) {
        setError(message);
      }
    }

    if (recurringResult.status === "fulfilled") {
      setConnectedRecurring(recurringResult.value);
    } else {
      setConnectedRecurring([]);
    }
  }, []);

  // ── Full refresh ────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchConnectedData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load financial data.");
    }
    readManualData();
    if (mountedRef.current) {
      setLoading(false);
    }
  }, [fetchConnectedData, readManualData]);

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // ── Listen for localStorage changes (cross-tab + same-page) ────────────
  useEffect(() => {
    const manualKeys = new Set<string>(Object.values(MANUAL_STORAGE_KEYS));

    const onStorage = (event: StorageEvent) => {
      if (event.key && manualKeys.has(event.key)) {
        readManualData();
      }
    };

    // Cross-tab: native StorageEvent fires on other tabs
    window.addEventListener("storage", onStorage);

    // Same-page: custom event dispatched by our patched useLocalStorageState
    const onLocalChange = () => readManualData();
    window.addEventListener("calico:storage-change", onLocalChange);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("calico:storage-change", onLocalChange);
    };
  }, [readManualData]);

  // ── Merged accounts ─────────────────────────────────────────────────────
  const allAccounts = useMemo<ConnectedAccountRecord[]>(() => {
    const mapped = manualAccounts.map(manualAccountToConnected);
    return [...connectedAccounts, ...mapped];
  }, [connectedAccounts, manualAccounts]);

  // ── Merged transactions ─────────────────────────────────────────────────
  const allTransactions = useMemo<StatementTransaction[]>(() => {
    const fromCashflow = cashflowToTransactions(manualCashflow);
    const fromReports = reportsToTransactions(manualReports);
    return deduplicateTransactions(
      connectedTransactions,
      manualTransactions,
      fromCashflow,
      fromReports,
    );
  }, [connectedTransactions, manualTransactions, manualCashflow, manualReports]);

  // ── Merged recurring ────────────────────────────────────────────────────
  const allRecurring = useMemo<DetectedSubscription[]>(() => {
    const normalizedConnected = connectedRecurring.map((item) => ({
      ...item,
      sourceType: normalizeRecordSourceType(item.sourceType ?? item.source_state, "connected"),
    }));
    const normalizedManual = manualRecurring.map((item) => ({
      ...item,
      sourceType: normalizeRecordSourceType(item.sourceType ?? item.source_state, "manual"),
    }));
    return [...normalizedConnected, ...normalizedManual];
  }, [connectedRecurring, manualRecurring]);

  // ── Derived financial summary ───────────────────────────────────────────
  const summary = useMemo<FinancialSummary>(() => {
    // Balances
    const connectedBalance = connectedAccounts.reduce(
      (sum, a) => sum + (typeof a.balance === "number" ? a.balance : 0),
      0,
    );
    const manualBalance = manualAccounts.reduce((sum, a) => sum + a.balance, 0);
    const netWorth = connectedBalance + manualBalance;

    const manualAssets = manualAccounts
      .filter((a) => a.balance >= 0)
      .reduce((sum, a) => sum + a.balance, 0);
    const manualLiabilities = manualAccounts
      .filter((a) => a.balance < 0)
      .reduce((sum, a) => sum + Math.abs(a.balance), 0);

    const totalAssets = Math.max(connectedBalance, 0) + manualAssets;
    const totalLiabilities =
      (connectedBalance < 0 ? Math.abs(connectedBalance) : 0) + manualLiabilities;

    // Current month income/expenses from ALL transactions
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let monthIncome = 0;
    let monthExpenses = 0;

    for (const tx of allTransactions) {
      const txDate = new Date(tx.occurred_at);
      if (txDate.getMonth() !== currentMonth || txDate.getFullYear() !== currentYear) continue;

      const txType = normalizeTransactionType(tx);
      if (txType === "transfer") continue;

      const absAmount = Math.abs(tx.amount);
      if (txType === "income") {
        monthIncome += absAmount;
      } else {
        monthExpenses += absAmount;
      }
    }

    const monthNet = monthIncome - monthExpenses;
    const savingsRate = monthIncome > 0 ? Math.round((monthNet / monthIncome) * 100) : 0;

    return {
      totalAccounts: allAccounts.length,
      connectedBalance,
      manualBalance,
      netWorth,
      totalAssets,
      totalLiabilities,
      monthIncome,
      monthExpenses,
      monthNet,
      savingsRate,
    };
  }, [allAccounts.length, allTransactions, connectedAccounts, manualAccounts]);

  return {
    loading,
    error,
    connectedAccounts,
    manualAccounts,
    allAccounts,
    connectedTransactions,
    manualTransactions,
    allTransactions,
    connectedRecurring,
    manualRecurring,
    allRecurring,
    summary,
    refresh,
    epoch,
  };
}
