'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import {
  Wallet, WalletSettings, ChatMessage, AgentTask,
  VendorOption, ApprovalData, ProcurementPlan, ProcurementTaskRecord,
} from '@/lib/types';
import { uid } from '@/lib/utils';
import * as walletService from '@/services/wallet';
import * as agent from '@/services/agent';
import * as fundingService from '@/services/funding';
import * as procurementService from '@/services/procurement';

interface AppState {
  wallet: Wallet;
  messages: ChatMessage[];
  activeTask: AgentTask | null;
  latestProcurementTask: ProcurementTaskRecord | null;
  latestProcurementPlan: ProcurementPlan | null;
  showSettings: boolean;
  showHistory: boolean;
  isProcessing: boolean;

  sendMessage: (text: string) => void;
  approveTask: (taskId: string) => void;
  rejectTask: (taskId: string) => void;
  addFunds: (amount: number) => void;
  startFunding: (amount: number) => Promise<void>;
  refreshWallet: () => Promise<void>;
  updateSettings: (updates: Partial<WalletSettings>) => Promise<void>;
  addRecipient: (name: string, stripeAccountId: string) => Promise<void>;
  toggleSettings: () => void;
  toggleHistory: () => void;
  selectOption: (option: VendorOption) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet>(walletService.getDefaultWallet);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const [latestProcurementTask, setLatestProcurementTask] = useState<ProcurementTaskRecord | null>(null);
  const [latestProcurementPlan, setLatestProcurementPlan] = useState<ProcurementPlan | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const updateLastMessage = useCallback((content: string, data?: ChatMessage['data']) => {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant') {
        copy[copy.length - 1] = { ...last, content, type: data ? 'agent-log' : 'text', data };
      }
      return copy;
    });
  }, []);

  const refreshWallet = useCallback(async () => {
    try {
      const latest = await walletService.fetchWallet();
      setWallet(latest);
    } catch (error) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: error instanceof Error
          ? `Could not refresh wallet from server: ${error.message}`
          : 'Could not refresh wallet from server.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
    }
  }, [addMessage]);

  const getWallet = useCallback(() => walletRef.current, []);

  const callbacks = useMemo<agent.AgentCallbacks>(() => ({
    addMessage,
    updateLastMessage,
    setWallet,
    getWallet,
    refreshWallet,
  }), [addMessage, updateLastMessage, getWallet, refreshWallet]);

  const startFunding = useCallback(async (amount: number) => {
    if (amount <= 0) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: 'Top-up amount must be greater than 0.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const session = await fundingService.createFundingSession(amount);
      window.location.assign(session.checkoutUrl);
    } catch (error) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: error instanceof Error
          ? `Funding setup failed: ${error.message}`
          : 'Funding setup failed. Please try again.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
    }
  }, [addMessage]);

  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet]);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          id: 'welcome',
          role: 'assistant',
          content: 'Agent Wallet is ready. Wallet balance is server-truth only and starts at $0.00 until real Stripe funding succeeds.',
          type: 'text',
          timestamp: new Date().toISOString(),
        },
      ];
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fundingStatus = params.get('funding_status');
    const sessionId = params.get('session_id');
    const cancelled = params.get('funding_cancelled');

    if (cancelled) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: 'Funding cancelled. No wallet changes applied.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (fundingStatus !== 'success') return;

    addMessage({
      id: uid(),
      role: 'assistant',
      content: sessionId
        ? `Stripe checkout completed (session ${sessionId}). Waiting for webhook confirmation before crediting balance.`
        : 'Stripe checkout completed. Waiting for webhook confirmation before crediting balance.',
      type: 'text',
      timestamp: new Date().toISOString(),
    });

    let cancelledPolling = false;
    const startingBalance = walletRef.current.balance;

    const poll = async () => {
      for (let i = 0; i < 6; i += 1) {
        if (cancelledPolling) return;
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const latest = await walletService.fetchWallet();
          setWallet(latest);
          if (latest.balance > startingBalance) {
            addMessage({
              id: uid(),
              role: 'assistant',
              content: `Webhook confirmed. New balance: $${latest.balance.toFixed(2)}.`,
              type: 'text',
              timestamp: new Date().toISOString(),
            });
            break;
          }
        } catch {
          // Keep polling; webhook and API may still be in flight.
        }
      }

      window.history.replaceState({}, '', window.location.pathname);
    };

    void poll();

    return () => {
      cancelledPolling = true;
    };
  }, [addMessage]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: text,
      type: 'text',
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);

    const intent = agent.parseIntent(text);

    try {
      switch (intent.action) {
        case 'procurement': {
          await refreshWallet();
          addMessage({
            id: uid(),
            role: 'assistant',
            content: 'Building a procurement plan with structured reasoning...',
            type: 'thinking',
            timestamp: new Date().toISOString(),
          });

          const planning = await procurementService.planProcurementTask(intent.query, walletRef.current);
          setLatestProcurementTask(planning.task);
          setLatestProcurementPlan(planning.planning);
          setActiveTask(null);

          if (planning.planning.clarificationNeeded) {
            const questions = planning.planning.followUpQuestions.length > 0
              ? planning.planning.followUpQuestions.map((q) => `- ${q}`).join('\n')
              : '- Please clarify your required features and budget cadence.';
            addMessage({
              id: uid(),
              role: 'assistant',
              content: `Procurement plan requires clarification:\n${questions}`,
              type: 'text',
              timestamp: new Date().toISOString(),
            });
          } else {
            addMessage({
              id: uid(),
              role: 'assistant',
              content: `Procurement plan ready for **${planning.planning.category}**. Review the planning panel for criteria, vendors, and budget framing.`,
              type: 'text',
              timestamp: new Date().toISOString(),
            });
          }
          break;
        }
        case 'buy': {
          await refreshWallet();
          const location = walletRef.current.settings.requireLocation ? 'San Francisco, CA' : undefined;
          const task = await agent.handleBuyFlow(intent, location, callbacks);
          setActiveTask(task);
          break;
        }
        case 'send': {
          await refreshWallet();
          const task = await agent.handleSendFlow(intent, callbacks);
          setActiveTask(task);
          break;
        }
        case 'fund':
          agent.handleFundFlow(intent, callbacks);
          break;
        case 'balance':
          await refreshWallet();
          agent.handleBalanceFlow(callbacks);
          break;
        case 'history':
          setShowHistory(true);
          addMessage({
            id: uid(),
            role: 'assistant',
            content: 'Transaction history is open in the right panel.',
            type: 'text',
            timestamp: new Date().toISOString(),
          });
          break;
        case 'settings':
          setShowSettings(true);
          addMessage({
            id: uid(),
            role: 'assistant',
            content: 'Guardrail settings are open in the right panel.',
            type: 'text',
            timestamp: new Date().toISOString(),
          });
          break;
        case 'help':
          agent.handleHelp(callbacks);
          break;
        default:
          addMessage({
            id: uid(),
            role: 'assistant',
            content: 'Try: "Find the best AI note-taking tool under $15/month", "Buy me coffee", "Send $5 to Alice", or "Add $20".',
            type: 'text',
            timestamp: new Date().toISOString(),
          });
      }
    } catch (error) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: error instanceof Error
          ? `Request failed: ${error.message}`
          : 'Something went wrong. Please try again.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
    }

    setIsProcessing(false);
  }, [isProcessing, callbacks, addMessage, refreshWallet]);

  const approveTask = useCallback(async (taskId: string) => {
    if (!activeTask || activeTask.id !== taskId || !activeTask.selectedOption) return;
    setIsProcessing(true);

    addMessage({
      id: uid(),
      role: 'user',
      content: 'Approved',
      type: 'text',
      timestamp: new Date().toISOString(),
    });

    const completed = activeTask.category === 'send'
      ? await agent.completeSendFlow(activeTask, activeTask.selectedOption, callbacks)
      : await agent.completePurchase(activeTask, activeTask.selectedOption, callbacks);

    setActiveTask(completed);
    setIsProcessing(false);
  }, [activeTask, addMessage, callbacks]);

  const rejectTask = useCallback((taskId: string) => {
    if (!activeTask || activeTask.id !== taskId) return;

    addMessage({
      id: uid(),
      role: 'user',
      content: 'Rejected',
      type: 'text',
      timestamp: new Date().toISOString(),
    });

    addMessage({
      id: uid(),
      role: 'assistant',
      content: 'Action cancelled.',
      type: 'text',
      timestamp: new Date().toISOString(),
    });

    setActiveTask((prev) => prev ? { ...prev, status: 'cancelled' } : null);
  }, [activeTask, addMessage]);

  const selectOption = useCallback((option: VendorOption) => {
    if (!activeTask) return;

    setActiveTask((prev) => prev ? { ...prev, selectedOption: option } : null);

    addMessage({
      id: uid(),
      role: 'assistant',
      content: `Switched to **${option.name}** — ${option.item} for **$${option.price.toFixed(2)}**. Approve this action?`,
      type: 'approval',
      data: {
        merchant: option.name,
        item: option.item,
        amount: option.price,
        taskId: activeTask.id,
      } as ApprovalData,
      timestamp: new Date().toISOString(),
    });
  }, [activeTask, addMessage]);

  const addFunds = useCallback((amount: number) => {
    void startFunding(amount);
  }, [startFunding]);

  const doUpdateSettings = useCallback(async (updates: Partial<WalletSettings>) => {
    try {
      const updated = await walletService.updateSettings(updates);
      setWallet(updated);
    } catch (error) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'Failed to update settings.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
    }
  }, [addMessage]);

  const doAddRecipient = useCallback(async (name: string, stripeAccountId: string) => {
    try {
      await walletService.createRecipient(name, stripeAccountId);
      const updated = await walletService.fetchWallet();
      setWallet(updated);
      addMessage({
        id: uid(),
        role: 'assistant',
        content: `Recipient ${name} added and approved.`,
        type: 'text',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'Failed to add recipient.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
    }
  }, [addMessage]);

  const value: AppState = {
    wallet,
    messages,
    activeTask,
    latestProcurementTask,
    latestProcurementPlan,
    showSettings,
    showHistory,
    isProcessing,
    sendMessage,
    approveTask,
    rejectTask,
    addFunds,
    startFunding,
    refreshWallet,
    updateSettings: doUpdateSettings,
    addRecipient: doAddRecipient,
    toggleSettings: () => setShowSettings((p) => !p),
    toggleHistory: () => setShowHistory((p) => !p),
    selectOption,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
