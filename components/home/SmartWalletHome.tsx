"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { CustomizableDashboard } from "@/components/dashboard/CustomizableDashboard";
import type { Wallet } from "@/lib/types";
import { fetchConnectedAccountsBundle, type ConnectedAccountRecord } from "@/services/connect";
import { fetchSmartHomePayload, type SmartHomePayload } from "@/services/smartWallet";
import {
  fetchConnectedTransactionsList,
  fetchSuspectedSubscriptions,
  type DetectedSubscription,
  type StatementTransaction,
} from "@/services/statements";
import { fetchWallet } from "@/services/wallet";
import { calicoTheme } from "@/styles/theme";
import {
  MANUAL_STORAGE_KEYS,
  readLocalStorageJson,
  type ManualAccountRecord,
  type ManualInvestmentHolding,
  type ManualNetWorthItem,
} from "@/lib/manualMode";
import type { DashboardInvestmentHolding } from "@/components/dashboard/dashboardTypes";
import { normalizeRecordSourceType } from "@/lib/sourceType";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

interface DashboardSupportData {
  wallet: Wallet | null;
  accounts: ConnectedAccountRecord[];
  transactions: StatementTransaction[];
  recurring: DetectedSubscription[];
  investments: DashboardInvestmentHolding[];
}

interface ManualCashflowEntry {
  id: string;
  label: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  occurredAt: string;
}

interface ManualReportEntry {
  id: string;
  label: string;
  type: "income" | "expense";
  amount: number;
  date: string;
}

export function SmartWalletHome() {
  const [home, setHome] = useState<SmartHomePayload | null>(null);
  const [supportData, setSupportData] = useState<DashboardSupportData>({
    wallet: null,
    accounts: [],
    transactions: [],
    recurring: [],
    investments: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [homeResult, walletResult, accountsResult, transactionsResult, recurringResult] = await Promise.allSettled([
        fetchSmartHomePayload(),
        fetchWallet(),
        fetchConnectedAccountsBundle(),
        fetchConnectedTransactionsList(),
        fetchSuspectedSubscriptions(),
      ]);

      if (homeResult.status !== "fulfilled") {
        throw homeResult.reason;
      }

      const connectedAccounts =
        accountsResult.status === "fulfilled" ? accountsResult.value.accounts : [];
      const connectedTransactions =
        transactionsResult.status === "fulfilled" ? transactionsResult.value : [];
      const connectedRecurring =
        recurringResult.status === "fulfilled" ? recurringResult.value : [];

      const manualAccounts = readLocalStorageJson<ManualAccountRecord[]>(
        MANUAL_STORAGE_KEYS.accounts,
        [],
      );
      const manualTransactions = readLocalStorageJson<StatementTransaction[]>(
        MANUAL_STORAGE_KEYS.transactions,
        [],
      );
      const manualCashflow = readLocalStorageJson<ManualCashflowEntry[]>(
        MANUAL_STORAGE_KEYS.cashflow,
        [],
      );
      const manualReports = readLocalStorageJson<ManualReportEntry[]>(
        MANUAL_STORAGE_KEYS.reports,
        [],
      );
      const manualRecurring = readLocalStorageJson<DetectedSubscription[]>(
        MANUAL_STORAGE_KEYS.recurring,
        [],
      );
      const manualInvestments = readLocalStorageJson<ManualInvestmentHolding[]>(
        MANUAL_STORAGE_KEYS.investments,
        [],
      );
      const manualNetWorthItems = readLocalStorageJson<ManualNetWorthItem[]>(
        MANUAL_STORAGE_KEYS.netWorth,
        [],
      );

      const mappedManualAccounts: ConnectedAccountRecord[] = manualAccounts.map((account) => ({
        id: account.id,
        user_id: "manual",
        institution_name: "Manual",
        account_type:
          account.type === "credit"
            ? "credit"
            : account.type === "loan"
              ? "loan"
              : account.type === "cash"
                ? "cash"
                : account.type === "investment" || account.type === "other_asset"
                  ? "savings"
                  : account.type === "other_liability"
                    ? "loan"
                    : account.type,
        mask: account.mask ?? "manual",
        nickname: account.name,
        last_synced_at: account.updatedAt,
        balance: account.balance,
        sourceType: "manual",
      }));

      const mappedNetWorthItems: ConnectedAccountRecord[] = manualNetWorthItems.map((item) => ({
        id: item.id,
        user_id: "manual",
        institution_name: "Manual net worth",
        account_type: item.kind === "liability" ? "loan" : "savings",
        mask: "item",
        nickname: item.label,
        last_synced_at: item.updatedAt,
        balance: item.kind === "liability" ? -Math.abs(item.amount) : item.amount,
        sourceType: "manual",
      }));

      const mappedManualInvestments: DashboardInvestmentHolding[] = manualInvestments.map((holding) => ({
        id: holding.id,
        symbol: holding.symbol,
        name: holding.name,
        value: holding.currentValue ?? holding.value,
        changePct: 0,
      }));

      const mappedCashflowTransactions: StatementTransaction[] = manualCashflow.map((entry) => ({
        id: `cashflow-${entry.id}`,
        user_id: "manual",
        linked_account_id: "manual",
        merchant_name: entry.label,
        normalized_merchant: entry.label,
        amount: entry.type === "expense" ? -Math.abs(entry.amount) : Math.abs(entry.amount),
        currency: "USD",
        category: entry.category || "Manual",
        pending: false,
        occurred_at: entry.occurredAt,
        sourceType: "manual",
      }));

      const mappedReportTransactions: StatementTransaction[] = manualReports.map((entry) => ({
        id: `report-${entry.id}`,
        user_id: "manual",
        linked_account_id: "manual",
        merchant_name: entry.label,
        normalized_merchant: entry.label,
        amount: entry.type === "expense" ? -Math.abs(entry.amount) : Math.abs(entry.amount),
        currency: "USD",
        category: "Manual report",
        pending: false,
        occurred_at: new Date(`${entry.date}T12:00:00.000Z`).toISOString(),
        sourceType: "manual",
      }));

      const mergedTransactionsById = new Map<string, StatementTransaction>();
      for (const tx of [...connectedTransactions, ...manualTransactions, ...mappedCashflowTransactions, ...mappedReportTransactions]) {
        mergedTransactionsById.set(tx.id, tx);
      }

      setHome(homeResult.value);
      setSupportData({
        wallet: walletResult.status === "fulfilled" ? walletResult.value : null,
        accounts: [...connectedAccounts, ...mappedManualAccounts, ...mappedNetWorthItems],
        transactions: [...mergedTransactionsById.values()],
        recurring: [
          ...connectedRecurring.map((item) => ({
            ...item,
            sourceType: normalizeRecordSourceType(item.sourceType ?? item.source_state, "connected"),
          })),
          ...manualRecurring.map((item) => ({
            ...item,
            sourceType: normalizeRecordSourceType(item.sourceType ?? item.source_state, "manual"),
          })),
        ],
        investments: mappedManualInvestments,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center py-32" style={{ background: calicoTheme.background }}>
        <Loader2 size={20} className="animate-spin" color={calicoTheme.primary} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-16" style={{ background: calicoTheme.background }}>
        <div className="w-full max-w-lg rounded-[16px] px-5 py-4 text-sm shadow-[0_12px_28px_rgba(15,23,42,0.08)]" style={{ background: calicoTheme.card, border: `1px solid ${calicoTheme.border}`, color: calicoTheme.text }}>
          {error}
        </div>
      </div>
    );
  }

  if (!home) return null;

  return (
    <CustomizableDashboard
      greeting={getGreeting()}
      home={home}
      wallet={supportData.wallet}
      dataSource={{
        accounts: supportData.accounts,
        transactions: supportData.transactions,
        recurring: supportData.recurring,
        investments: supportData.investments,
      }}
      accountsConnected={
        supportData.accounts.length > 0
        || supportData.transactions.length > 0
        || supportData.recurring.length > 0
        || supportData.investments.length > 0
      }
      useLiveData
    />
  );
}
