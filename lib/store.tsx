'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { Wallet, WalletSettings } from '@/lib/types';
import { setCacheUserId } from '@/lib/cache';
import { fetchAuthenticatedAccount } from '@/services/account';
import * as walletService from '@/services/wallet';
import * as fundingService from '@/services/funding';


interface AppState {
  wallet: Wallet;
  showSettings: boolean;
  showHistory: boolean;
  isProcessing: boolean;

  addFunds: (amount: number) => void;
  startFunding: (amount: number, options?: {
    paymentMethodId?: string;
    forgetAfterUse?: boolean;
  }) => Promise<void>;
  refreshWallet: () => Promise<void>;
  updateSettings: (updates: Partial<WalletSettings>) => Promise<void>;
  addRecipient: (name: string, stripeAccountId: string) => Promise<void>;
  toggleSettings: () => void;
  toggleHistory: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet>(walletService.getDefaultWallet);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Scope the cache to the authenticated user before loading wallet data.
    // This ensures all cached API responses are isolated per user.
    fetchAuthenticatedAccount()
      .then((account) => {
        setCacheUserId(account.walletUserId);
      })
      .catch(() => {
        // Auth check failed — cache will operate in anonymous mode
      })
      .finally(() => {
        void refreshWallet();
      });
  }, []);

  const refreshWallet = useCallback(async () => {
    try {
      const data = await walletService.fetchWallet();
      setWallet(data);
    } catch {
      // keep current state on error
    }
  }, []);

  const addFunds = useCallback((amount: number) => {
    setWallet((prev) => ({
      ...prev,
      balance: prev.balance + amount,
    }));
  }, []);

  const startFunding = useCallback(async (amount: number, _options?: {
    paymentMethodId?: string;
    forgetAfterUse?: boolean;
  }) => {
    setIsProcessing(true);
    try {
      await fundingService.createFundingSession(amount);
      await refreshWallet();
    } finally {
      setIsProcessing(false);
    }
  }, [refreshWallet]);

  const updateSettings = useCallback(async (updates: Partial<WalletSettings>) => {
    try {
      await walletService.updateSettings(updates);
      await refreshWallet();
    } catch {
      // keep current state on error
    }
  }, [refreshWallet]);

  const addRecipient = useCallback(async (name: string, stripeAccountId: string) => {
    try {
      await walletService.createRecipient(name, stripeAccountId);
      await refreshWallet();
    } catch {
      // keep current state on error
    }
  }, [refreshWallet]);

  const toggleSettings = useCallback(() => setShowSettings((prev) => !prev), []);
  const toggleHistory = useCallback(() => setShowHistory((prev) => !prev), []);

  const state: AppState = {
    wallet,
    showSettings,
    showHistory,
    isProcessing,
    addFunds,
    startFunding,
    refreshWallet,
    updateSettings,
    addRecipient,
    toggleSettings,
    toggleHistory,
  };

  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}
