"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { CustomizableDashboard } from "@/components/dashboard/CustomizableDashboard";
import type { DashboardGoalSummary, DashboardInvestmentHolding } from "@/components/dashboard/dashboardTypes";
import { useFinancialData } from "@/lib/useFinancialData";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import {
  MANUAL_STORAGE_KEYS,
  type ManualInvestmentHolding,
} from "@/lib/manualMode";
import { FRESHNESS } from "@/lib/cache";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { fetchSmartHomePayload, type SmartHomePayload } from "@/services/smartWallet";
import { fetchWallet } from "@/services/wallet";
import { calicoTheme } from "@/styles/theme";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function SmartWalletHome() {
  const financialData = useFinancialData();

  const {
    data: home,
    loading: homeLoading,
    error: homeError,
    stale: homeStale,
  } = useCachedFetch<SmartHomePayload>(
    'dashboard',
    'home',
    fetchSmartHomePayload,
    FRESHNESS.dashboard,
  );

  const {
    data: wallet,
    loading: walletLoading,
    stale: walletStale,
  } = useCachedFetch(
    'wallet',
    'main',
    fetchWallet,
    FRESHNESS.wallet,
  );

  const loading = homeLoading || walletLoading;
  const error = homeError;
  const isStale = homeStale || walletStale;

  const [manualInvestments] = useLocalStorageState<ManualInvestmentHolding[]>(
    MANUAL_STORAGE_KEYS.investments,
    [],
  );
  const [storedGoals] = useLocalStorageState<Array<{
    id: string;
    name?: string;
    label?: string;
    targetAmount?: number;
    target?: number;
    currentSavedAmount?: number;
    saved?: number;
    manualContributionTotal?: number;
  }>>(MANUAL_STORAGE_KEYS.goals, []);

  // Skip redundant financialData.refresh() on /home — SmartHome API already
  // loads accounts, transactions, and recurring in buildSmartHomePayload().
  // The useFinancialData hook's initial mount load covers this page adequately.
  // Calling refresh() here would duplicate all API calls and double load time.

  const investments = useMemo<DashboardInvestmentHolding[]>(
    () => manualInvestments.map((holding) => ({
      id: holding.id,
      symbol: holding.symbol,
      name: holding.name,
      value: holding.currentValue ?? holding.value,
      changePct: 0,
    })),
    [manualInvestments],
  );

  const goals = useMemo<DashboardGoalSummary[]>(
    () => storedGoals.map((goal) => {
      const name = goal.name ?? goal.label ?? "";
      const targetAmount = Math.max(0, Number(goal.targetAmount ?? goal.target) || 0);
      const saved = Math.max(0, Number(goal.currentSavedAmount ?? goal.saved) || 0);
      const manual = Math.max(0, Number(goal.manualContributionTotal) || 0);
      const totalSaved = saved + manual;

      return {
        id: goal.id,
        name,
        targetAmount,
        totalSaved,
        progress: targetAmount > 0 ? Math.min(Math.round((totalSaved / targetAmount) * 100), 100) : 0,
      };
    }),
    [storedGoals],
  );

  const dashboardLoading = loading && !home && financialData.loading;
  const dashboardError = !home && error ? (error ?? financialData.error) : null;
  const hasLiveFinancialData =
    financialData.allAccounts.length > 0
    || financialData.allTransactions.length > 0
    || financialData.allRecurring.length > 0
    || investments.length > 0;

  if (dashboardLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center py-32" style={{ background: calicoTheme.background }}>
        <Loader2 size={20} className="animate-spin" color={calicoTheme.primary} />
      </div>
    );
  }

  if (dashboardError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-16" style={{ background: calicoTheme.background }}>
        <div className="w-full max-w-lg rounded-[16px] px-5 py-4 text-sm shadow-[0_12px_28px_rgba(15,23,42,0.08)]" style={{ background: calicoTheme.card, border: `1px solid ${calicoTheme.border}`, color: calicoTheme.text }}>
          {dashboardError}
        </div>
      </div>
    );
  }

  if (!home) return null;

  return (
    <>
      {isStale && (
        <div className="fixed top-2 right-4 z-50 rounded-full px-3 py-1 text-xs" style={{ background: calicoTheme.card, border: `1px solid ${calicoTheme.border}`, color: calicoTheme.text, opacity: 0.65 }}>
          Updating...
        </div>
      )}
      <CustomizableDashboard
        greeting={getGreeting()}
        home={home}
        wallet={wallet}
        dataSource={{
          accounts: financialData.allAccounts,
          transactions: financialData.allTransactions,
          recurring: financialData.allRecurring,
          investments,
          goals,
        }}
        accountsConnected={hasLiveFinancialData}
        useLiveData
      />
    </>
  );
}
