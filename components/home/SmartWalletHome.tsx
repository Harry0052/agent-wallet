"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CustomizableDashboard } from "@/components/dashboard/CustomizableDashboard";
import type { DashboardGoalSummary, DashboardInvestmentHolding } from "@/components/dashboard/dashboardTypes";
import { useFinancialData } from "@/lib/useFinancialData";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import {
  MANUAL_STORAGE_KEYS,
  type ManualInvestmentHolding,
} from "@/lib/manualMode";
import type { Wallet } from "@/lib/types";
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
  const pathname = usePathname();
  const financialData = useFinancialData();
  const [home, setHome] = useState<SmartHomePayload | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [homeResult, walletResult] = await Promise.allSettled([
        fetchSmartHomePayload(),
        fetchWallet(),
      ]);

      if (homeResult.status !== "fulfilled") {
        throw homeResult.reason;
      }

      setHome(homeResult.value);
      setWallet(walletResult.status === "fulfilled" ? walletResult.value : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pathname !== "/home") return;
    void financialData.refresh();
  }, [financialData.refresh, pathname]);

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

  const dashboardLoading = loading || financialData.loading;
  const dashboardError = error ?? financialData.error;
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
  );
}
