"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchConnectedAccountsBundle,
  refreshConnectedBalances,
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
  type ManualNetWorthItem,
} from "@/lib/manualMode";
import { normalizeRecordSourceType } from "@/lib/sourceType";
import {
  cashflowToTransactions,
  reportsToTransactions,
  deduplicateTransactions,
  manualAccountToConnected,
  manualNetWorthItemToConnected,
  summarizeAccounts,
  summarizeCurrentMonthTransactions,
  type ManualCashflowEntry,
  type ManualReportEntry,
  type ManualRecurringItem,
  type FinancialSummary,
} from "@/lib/financialTypes";
import { readFromCache, writeToCache, invalidateDomain, FRESHNESS } from "@/lib/cache";

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
  /** Manual net worth items from localStorage */
  manualNetWorthItems: ManualNetWorthItem[];
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

  /** Refresh all data from APIs + localStorage. Pass { invalidate: true } to clear cache first. */
  refresh: (options?: { invalidate?: boolean }) => Promise<void>;

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
  const [manualNetWorthItems, setManualNetWorthItems] = useState<ManualNetWorthItem[]>([]);
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
    setManualNetWorthItems(
      readLocalStorageJson<ManualNetWorthItem[]>(MANUAL_STORAGE_KEYS.netWorth, []),
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

  // ── Fetch connected data from APIs (cache-first) ───────────────────────
  // Accounts + transactions load first (critical path).
  // Subscriptions load in background (non-blocking) to avoid delaying
  // the initial dashboard render.
  //
  // Cache strategy: if a fresh cache entry exists, set state immediately
  // (avoids loading spinner) then refresh in the background. On cache miss,
  // fetch normally (show loading).
  const fetchConnectedData = useCallback(async () => {
    // Sequential to reduce concurrent DB connections across serverless invocations.
    // With Supabase session mode, each API call holds a DB connection for its
    // full duration. Parallel calls = parallel connections = pool exhaustion.
    // Accounts first (fast, ~50ms), then transactions.

    // --- Accounts: try cache first ---
    const cachedAccounts = readFromCache<{ accounts: ConnectedAccountRecord[] }>(
      'accounts', 'bundle', FRESHNESS.accounts,
    );
    let hadCachedAccounts = false;
    if (cachedAccounts.status !== 'miss') {
      setConnectedAccounts(cachedAccounts.data.accounts);
      hadCachedAccounts = true;
    }

    try {
      const bundle = await fetchConnectedAccountsBundle();
      setConnectedAccounts(bundle.accounts);
      writeToCache('accounts', 'bundle', { accounts: bundle.accounts }, FRESHNESS.accounts);
    } catch {
      if (!hadCachedAccounts) {
        setConnectedAccounts((prev) => prev.length > 0 ? prev : []);
      }
    }

    // --- Transactions: try cache first ---
    const cachedTx = readFromCache<{ transactions: StatementTransaction[] }>(
      'transactions', 'unified', FRESHNESS.transactions,
    );
    let hadCachedTx = false;
    if (cachedTx.status !== 'miss') {
      setConnectedTransactions(cachedTx.data.transactions);
      hadCachedTx = true;
    }

    try {
      const statement = await fetchUnifiedStatement({ page_size: 250 });
      const txList = statement.transactions ?? [];
      setConnectedTransactions(txList);
      writeToCache('transactions', 'unified', { transactions: txList }, FRESHNESS.transactions);
    } catch (err) {
      if (!hadCachedTx) {
        setConnectedTransactions((prev) => {
          if (prev.length > 0) return prev;
          const message = err instanceof Error ? err.message : "Failed to load transactions.";
          const isNoDataError = /no\s+connected|no\s+account|not\s+connected|empty/i.test(message);
          const isDbError = /maxclient|max clients|pool|connection/i.test(message);
          if (!isNoDataError && !isDbError) {
            setError(message);
          }
          if (isDbError) {
            setError("Temporarily unable to load transactions. Try refreshing in a moment.");
          }
          return [];
        });
      }
    }
  }, []);

  // ── Deferred subscription fetch (non-blocking background load) ────────
  const fetchRecurringData = useCallback(async () => {
    // Try cache first for subscriptions
    const cachedSubs = readFromCache<{ subscriptions: DetectedSubscription[] }>(
      'subscriptions', 'suspected', FRESHNESS.subscriptions,
    );
    if (cachedSubs.status !== 'miss' && mountedRef.current) {
      setConnectedRecurring(cachedSubs.data.subscriptions);
      setEpoch((prev) => prev + 1);
    }

    try {
      const subs = await fetchSuspectedSubscriptions();
      if (mountedRef.current) {
        setConnectedRecurring(subs);
        setEpoch((prev) => prev + 1);
        writeToCache('subscriptions', 'suspected', { subscriptions: subs }, FRESHNESS.subscriptions);
      }
    } catch {
      if (cachedSubs.status === 'miss') {
        setConnectedRecurring((prev) => prev.length > 0 ? prev : []);
      }
    }
  }, []);

  // ── Background balance refresh (non-blocking) ─────────────────────────
  const backgroundRefreshBalances = useCallback(async () => {
    // Skip if no accounts are connected — avoids unnecessary Plaid call + DB session
    if (connectedAccounts.length === 0) return;
    try {
      const result = await refreshConnectedBalances();
      if (mountedRef.current && result.accounts.length > 0) {
        setConnectedAccounts(result.accounts);
        setEpoch((prev) => prev + 1);
        writeToCache('balances', 'latest', { accounts: result.accounts }, FRESHNESS.balances);
        // Also update the accounts cache since balances refresh returns fresh account data
        writeToCache('accounts', 'bundle', { accounts: result.accounts }, FRESHNESS.accounts);
      }
    } catch {
      // Silent — cached balances are already displayed
    }
  }, [connectedAccounts.length]);

  // ── Full refresh ────────────────────────────────────────────────────────
  const refresh = useCallback(async (options?: { invalidate?: boolean }) => {
    // If explicit invalidation requested (e.g. user-triggered refresh),
    // clear relevant cache domains so we fetch fresh data.
    if (options?.invalidate) {
      invalidateDomain('accounts');
      invalidateDomain('transactions');
      invalidateDomain('subscriptions');
      invalidateDomain('balances');
    }

    // Determine if we can skip the loading spinner by checking cache.
    // If both accounts and transactions are cached, the user will see
    // data immediately while background refresh runs.
    const accountsCached = readFromCache('accounts', 'bundle', FRESHNESS.accounts);
    const txCached = readFromCache('transactions', 'unified', FRESHNESS.transactions);
    const hasCachedData = accountsCached.status !== 'miss' && txCached.status !== 'miss';

    if (!hasCachedData) {
      setLoading(true);
    }
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
    // Non-critical data loads in background after first paint
    void fetchRecurringData();
    void backgroundRefreshBalances();
  }, [fetchConnectedData, fetchRecurringData, readManualData, backgroundRefreshBalances]);

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
    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string }>).detail;
      if (detail?.key && manualKeys.has(detail.key)) {
        readManualData();
      }
    };
    window.addEventListener("calico:storage-change", onLocalChange);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("calico:storage-change", onLocalChange);
    };
  }, [readManualData]);

  // ── Merged accounts ─────────────────────────────────────────────────────
  const allAccounts = useMemo<ConnectedAccountRecord[]>(() => {
    const mapped = manualAccounts.map(manualAccountToConnected);
    const mappedNetWorthItems = manualNetWorthItems.map(manualNetWorthItemToConnected);
    return [...connectedAccounts, ...mapped, ...mappedNetWorthItems];
  }, [connectedAccounts, manualAccounts, manualNetWorthItems]);

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
    const accountSummary = summarizeAccounts(allAccounts);
    const monthSummary = summarizeCurrentMonthTransactions(allTransactions);

    return {
      ...accountSummary,
      ...monthSummary,
    };
  }, [allAccounts, allTransactions]);

  return {
    loading,
    error,
    connectedAccounts,
    manualAccounts,
    manualNetWorthItems,
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
