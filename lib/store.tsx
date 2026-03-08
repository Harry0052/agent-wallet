'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import {
  Wallet, WalletSettings, ChatMessage, AgentTask,
  VendorOption, ApprovalData, ProcurementPlan, ProcurementTaskRecord, AgentStep,
} from '@/lib/types';
import { uid } from '@/lib/utils';
import * as walletService from '@/services/wallet';
import * as agent from '@/services/agent';
import * as fundingService from '@/services/funding';
import * as procurementService from '@/services/procurement';
import * as subscriptionService from '@/services/subscriptions';

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
          content: 'Agent Wallet is ready. Tell me what you need — I\'ll handle the work and only pause for approvals or clarifications.',
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

  // -----------------------------------------------------------------------
  // Inline recipient creation + send continuation
  // -----------------------------------------------------------------------

  const continueWithNewRecipient = useCallback(async (
    stripeAccountId: string,
    recipientName: string,
    amount: number,
  ) => {
    try {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: `Adding ${recipientName} as a recipient...`,
        type: 'thinking',
        timestamp: new Date().toISOString(),
      });

      const newRecipient = await walletService.createRecipient(recipientName, stripeAccountId);
      const updatedWallet = await walletService.fetchWallet();
      setWallet(updatedWallet);

      // Update the thinking message
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant' && last.type === 'thinking') {
          copy[copy.length - 1] = {
            ...last,
            content: `Added ${recipientName} to your recipients. Continuing with the transfer...`,
            type: 'text',
          };
        }
        return copy;
      });

      // Now autonomously continue with the send flow
      const task = await agent.executeSendMoney({
        amount,
        recipientName: newRecipient.name,
        recipient: newRecipient,
        wallet: updatedWallet,
        cb: callbacks,
      });

      setActiveTask(task);
    } catch (error) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: error instanceof Error
          ? `Failed to add recipient: ${error.message}`
          : 'Failed to add recipient.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
    }
  }, [addMessage, callbacks]);

  const runAutonomousProcurementMission = useCallback(async (userPrompt: string) => {
    await refreshWallet();

    addMessage({
      id: uid(),
      role: 'assistant',
      content: 'Building a structured procurement mission plan...',
      type: 'thinking',
      timestamp: new Date().toISOString(),
    });

    const planning = await procurementService.planProcurementTask(userPrompt, walletRef.current);
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
        content: `I need a few details before I run live research:\n${questions}`,
        type: 'text',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    addMessage({
      id: uid(),
      role: 'assistant',
      content: `Plan ready for **${planning.planning.category}**. Starting live TinyFish research across ${planning.planning.targetVendorCandidates.length} candidate services.`,
      type: 'text',
      timestamp: new Date().toISOString(),
    });

    await procurementService.startProcurementResearch(planning.task.id);

    const waitForTaskStatus = async (
      taskId: string,
      done: (status: ProcurementTaskRecord['status']) => boolean,
      timeoutMs = 300000,
    ) => {
      const startedAt = Date.now();
      let cursor: string | undefined;

      while ((Date.now() - startedAt) < timeoutMs) {
        const status = await procurementService.fetchProcurementResearchStatus(taskId, cursor);
        cursor = status.serverTime;
        setLatestProcurementTask(status.task);
        if (done(status.task.status)) return status;
        await new Promise((resolve) => setTimeout(resolve, 2200));
      }

      throw new Error(`Timed out waiting for procurement task ${taskId} to advance`);
    };

    const researchStatus = await waitForTaskStatus(
      planning.task.id,
      (status) => [
        'researched',
        'awaiting_approval',
        'purchase_preparing',
        'purchase_prepared',
        'needs_clarification',
        'failed',
        'rejected',
      ].includes(status),
    );

    if (researchStatus.task.status === 'failed') {
      throw new Error(researchStatus.task.error || 'TinyFish research failed');
    }

    if (researchStatus.task.status === 'needs_clarification') {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: researchStatus.task.error
          ? `I hit a blocker and need input: ${researchStatus.task.error}`
          : 'I need one clarification before continuing the mission.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    addMessage({
      id: uid(),
      role: 'assistant',
      content: 'Live findings collected. Comparing options and applying policy checks now.',
      type: 'thinking',
      timestamp: new Date().toISOString(),
    });

    const compared = await procurementService.compareProcurementFindings(planning.task.id);
    setLatestProcurementTask(compared.task);

    const winner = compared.recommendation.winner;
    const policy = compared.recommendation.policy;
    if (!winner) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: compared.recommendation.noFitExplanation || 'No option fit the budget and policy constraints from live findings.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!policy || !policy.allowed) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: policy?.reason || 'Recommendation is blocked by spend policy checks.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const monthlyPrice = winner.monthlyPrice !== null ? `$${winner.monthlyPrice.toFixed(2)}/month` : 'monthly price unavailable';
    addMessage({
      id: uid(),
      role: 'assistant',
      content: `Top recommendation: **${winner.vendorName} — ${winner.planName}** (${monthlyPrice}). Evidence: ${winner.pricingPageUrl}`,
      type: 'text',
      timestamp: new Date().toISOString(),
    });

    if (policy.approvalRequired) {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: 'Approval is required before I continue into signup and payment execution.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    addMessage({
      id: uid(),
      role: 'assistant',
      content: 'Policy allows autonomous continuation. Starting signup and payment preparation now.',
      type: 'thinking',
      timestamp: new Date().toISOString(),
    });

    await procurementService.submitProcurementApproval(planning.task.id, 'approved');

    const purchaseStatus = await waitForTaskStatus(
      planning.task.id,
      (status) => ['purchase_prepared', 'needs_clarification', 'failed', 'rejected'].includes(status),
      360000,
    );

    if (purchaseStatus.task.status === 'purchase_prepared') {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: `Autonomous execution completed for **${winner.vendorName} ${winner.planName}**. Purchase prep and payment routing finished with real ledger/audit updates.`,
        type: 'text',
        timestamp: new Date().toISOString(),
      });
      await refreshWallet();
      return;
    }

    if (purchaseStatus.task.status === 'needs_clarification') {
      addMessage({
        id: uid(),
        role: 'assistant',
        content: purchaseStatus.task.error
          ? `Execution paused for required input: ${purchaseStatus.task.error}`
          : 'Execution paused for a required clarification or security checkpoint.',
        type: 'text',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    throw new Error(purchaseStatus.task.error || 'Autonomous execution did not complete');
  }, [addMessage, refreshWallet]);

  // -----------------------------------------------------------------------
  // Main sendMessage — autonomous flow
  // -----------------------------------------------------------------------

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

    try {
      // -----------------------------------------------------------------
      // Handle pending recipient resolution (user is providing Stripe ID)
      // -----------------------------------------------------------------
      if (activeTask?.taskState === 'resolving_recipient' && activeTask.pendingRecipientName && activeTask.pendingAmount) {
        const trimmed = text.trim();

        if (agent.isNegativeResponse(trimmed)) {
          addMessage({
            id: uid(),
            role: 'assistant',
            content: 'Send cancelled.',
            type: 'text',
            timestamp: new Date().toISOString(),
          });
          setActiveTask((prev) => prev ? { ...prev, status: 'cancelled', taskState: 'failed' } : null);
          setIsProcessing(false);
          return;
        }

        // Check if user provided a Stripe account ID
        if (/^acct_/i.test(trimmed)) {
          await continueWithNewRecipient(trimmed, activeTask.pendingRecipientName, activeTask.pendingAmount);
          setIsProcessing(false);
          return;
        }

        // User might be confirming "yes" to add them
        if (agent.isAffirmativeResponse(trimmed)) {
          addMessage({
            id: uid(),
            role: 'assistant',
            content: `What is ${activeTask.pendingRecipientName}'s Stripe Connect account ID? (starts with acct_)`,
            type: 'text',
            timestamp: new Date().toISOString(),
          });
          setIsProcessing(false);
          return;
        }

        // Treat as a name correction or other input
        addMessage({
          id: uid(),
          role: 'assistant',
          content: `To add ${activeTask.pendingRecipientName} as a recipient, I need their Stripe Connect account ID (starts with acct_). Or say "cancel" to abort.`,
          type: 'text',
          timestamp: new Date().toISOString(),
        });
        setIsProcessing(false);
        return;
      }

      // -----------------------------------------------------------------
      // Handle pending approval
      // -----------------------------------------------------------------
      if (activeTask?.status === 'awaiting-approval' && activeTask.selectedOption) {
        if (agent.isAffirmativeResponse(text)) {
          const completed = activeTask.category === 'send'
            ? await agent.completeSendFlow(activeTask, activeTask.selectedOption, callbacks)
            : await agent.completePurchase(activeTask, activeTask.selectedOption, callbacks);
          setActiveTask(completed);
          setIsProcessing(false);
          return;
        }

        if (agent.isNegativeResponse(text)) {
          addMessage({
            id: uid(),
            role: 'assistant',
            content: 'Action cancelled.',
            type: 'text',
            timestamp: new Date().toISOString(),
          });
          setActiveTask((prev) => prev ? { ...prev, status: 'cancelled', taskState: 'failed' } : null);
          setIsProcessing(false);
          return;
        }
      }

      // -----------------------------------------------------------------
      // Quick-match local intents (settings, help, history) before OpenAI
      // -----------------------------------------------------------------
      const normalizedText = text.trim().toLowerCase();

      if (/^(settings|config|preferences|budget|cap|limit|guardrail)/i.test(normalizedText)) {
        setShowSettings(true);
        addMessage({
          id: uid(),
          role: 'assistant',
          content: 'Guardrail settings are open in the right panel.',
          type: 'text',
          timestamp: new Date().toISOString(),
        });
        setIsProcessing(false);
        return;
      }

      if (/^(help|what can|how do|commands)/i.test(normalizedText)) {
        agent.handleHelp(callbacks);
        setIsProcessing(false);
        return;
      }

      if (/^(history|transactions|past|recent|log)/i.test(normalizedText)) {
        setShowHistory(true);
        addMessage({
          id: uid(),
          role: 'assistant',
          content: 'Transaction history is open in the right panel.',
          type: 'text',
          timestamp: new Date().toISOString(),
        });
        setIsProcessing(false);
        return;
      }

      // -----------------------------------------------------------------
      // Parse + orchestrate server-side (Claude intent + task routing)
      // -----------------------------------------------------------------
      addMessage({
        id: uid(),
        role: 'assistant',
        content: 'Parsing your request...',
        type: 'thinking',
        timestamp: new Date().toISOString(),
      });

      const orchestration = await agent.orchestrateAgentMessage(text);
      const parsed = orchestration.intent;

      if (Array.isArray(orchestration.lifecycle) && orchestration.lifecycle.length > 0) {
        const lifecycleSteps = orchestration.lifecycle.map((snapshot, index) => {
          const isLast = index === orchestration.lifecycle!.length - 1;
          const type: AgentStep['type'] = snapshot.state === 'awaiting_approval'
            ? 'guardrail'
            : snapshot.state === 'executing'
              ? 'checkout'
              : snapshot.state === 'completed'
                ? 'confirm'
                : snapshot.state === 'failed'
                  ? 'guardrail'
                  : 'plan';
          const status: AgentStep['status'] = snapshot.state === 'failed'
            ? 'error'
            : (isLast && snapshot.state !== 'completed' ? 'running' : 'done');

          return {
            id: `${orchestration.taskId}_${snapshot.state}_${index}`,
            type,
            description: `${snapshot.state.replace(/_/g, ' ')}: ${snapshot.note}`,
            status,
            timestamp: snapshot.at,
          };
        });

        addMessage({
          id: uid(),
          role: 'assistant',
          content: 'Runtime lifecycle updated.',
          type: 'agent-log',
          data: { steps: lifecycleSteps },
          timestamp: new Date().toISOString(),
        });
      }

      if (orchestration.route === 'clarification' || orchestration.status === 'blocked') {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant' && last.type === 'thinking') {
            copy[copy.length - 1] = {
              ...last,
              content: orchestration.message,
              type: 'text',
            };
          }
          return copy;
        });
        setIsProcessing(false);
        return;
      }

      // Replace thinking with intent confirmation
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant' && last.type === 'thinking') {
          copy[copy.length - 1] = {
            ...last,
            content: `${orchestration.message}\n\nIntent: **${parsed.intent.replace(/_/g, ' ')}**${parsed.confidence < 0.7 ? ' (low confidence)' : ''}`,
            type: 'text',
          };
        }
        return copy;
      });

      // -----------------------------------------------------------------
      // Route to intent handler
      // -----------------------------------------------------------------
      switch (parsed.intent) {
        case 'procurement_task':
        case 'compare_and_buy':
        case 'signup_and_prepare_checkout': {
          await runAutonomousProcurementMission(text);
          break;
        }

        case 'send_money': {
          await refreshWallet();

          const amount = parsed.amount;
          const recipientHint = parsed.recipient_name?.trim() || null;

          // Missing amount
          if (amount === null || amount <= 0) {
            addMessage({
              id: uid(),
              role: 'assistant',
              content: recipientHint
                ? `How much should I send to ${recipientHint}?`
                : 'How much should I send, and to whom?',
              type: 'text',
              timestamp: new Date().toISOString(),
            });
            break;
          }

          // Missing recipient
          if (!recipientHint) {
            addMessage({
              id: uid(),
              role: 'assistant',
              content: `I can send $${amount.toFixed(2)}. Who should receive it?`,
              type: 'text',
              timestamp: new Date().toISOString(),
            });
            break;
          }

          // Try to resolve recipient
          const recipient = agent.resolveRecipient(walletRef.current, recipientHint);

          if (recipient) {
            // Recipient found — autonomously execute
            const task = await agent.executeSendMoney({
              amount,
              recipientName: recipientHint,
              recipient,
              wallet: walletRef.current,
              cb: callbacks,
            });
            setActiveTask(task);
          } else {
            // Recipient not found — initiate inline creation flow
            const pendingTask = agent.createTask(text, 'send', amount);
            pendingTask.taskState = 'resolving_recipient';
            pendingTask.pendingRecipientName = recipientHint;
            pendingTask.pendingAmount = amount;
            setActiveTask(pendingTask);

            const approvedRecipients = walletRef.current.recipients.filter((r) => r.status === 'approved');
            if (approvedRecipients.length === 0) {
              addMessage({
                id: uid(),
                role: 'assistant',
                content: `I don't see "${recipientHint}" in your recipients. Would you like me to add them so I can send the $${amount.toFixed(2)}?`,
                type: 'text',
                timestamp: new Date().toISOString(),
              });
            } else {
              const recipientsList = approvedRecipients.slice(0, 5).map((c) => c.name).join(', ');
              addMessage({
                id: uid(),
                role: 'assistant',
                content: `I don't see "${recipientHint}" in your recipients (available: ${recipientsList}). Want me to add them so I can complete the $${amount.toFixed(2)} transfer?`,
                type: 'text',
                timestamp: new Date().toISOString(),
              });
            }
          }
          break;
        }

        case 'fund_wallet': {
          const amount = parsed.amount;
          if (amount === null || amount <= 0) {
            addMessage({
              id: uid(),
              role: 'assistant',
              content: 'How much should I add to your wallet?',
              type: 'text',
              timestamp: new Date().toISOString(),
            });
            break;
          }

          agent.handleFundFlow({
            action: 'fund',
            query: text,
            amount,
          }, callbacks);
          break;
        }

        case 'review_spend':
          await refreshWallet();
          setShowHistory(true);
          agent.handleBalanceFlow(callbacks);
          break;

        case 'cancel_subscription': {
          const merchant = parsed.merchant?.trim();
          if (!merchant) {
            addMessage({
              id: uid(),
              role: 'assistant',
              content: 'Which subscription should I cancel?',
              type: 'text',
              timestamp: new Date().toISOString(),
            });
            break;
          }

          addMessage({
            id: uid(),
            role: 'assistant',
            content: `Looking up your ${merchant} subscription...`,
            type: 'thinking',
            timestamp: new Date().toISOString(),
          });

          const status = await subscriptionService.fetchSubscriptionStatus();
          if (status.activeSubscriptions.length === 0) {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === 'assistant' && last.type === 'thinking') {
                copy[copy.length - 1] = {
                  ...last,
                  content: 'No active approved subscriptions found to cancel.',
                  type: 'text',
                };
              }
              return copy;
            });
            break;
          }

          const normalizedMerchant = merchant.toLowerCase();
          const target = status.activeSubscriptions.find((subscription) => {
            const vendor = subscription.vendorName.toLowerCase();
            return vendor === normalizedMerchant
              || vendor.includes(normalizedMerchant)
              || normalizedMerchant.includes(vendor);
          });

          if (!target) {
            const list = status.activeSubscriptions.slice(0, 6).map((subscription) => subscription.vendorName).join(', ');
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === 'assistant' && last.type === 'thinking') {
                copy[copy.length - 1] = {
                  ...last,
                  content: `I couldn't match "${merchant}" to an active subscription. Available: ${list}.`,
                  type: 'text',
                };
              }
              return copy;
            });
            break;
          }

          const result = await subscriptionService.runSubscriptionOperation({
            taskId: target.taskId,
            operation: 'cancel',
          });

          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant' && last.type === 'thinking') {
              copy[copy.length - 1] = {
                ...last,
                content: result.started
                  ? `Launching cancellation for ${target.vendorName}. TinyFish will handle the browser workflow autonomously.`
                  : `Cancellation for ${target.vendorName} is already running.`,
                type: 'text',
              };
            }
            return copy;
          });
          break;
        }

        default:
          agent.handleHelp(callbacks);
          break;
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
  }, [isProcessing, activeTask, callbacks, addMessage, refreshWallet, continueWithNewRecipient, runAutonomousProcurementMission]);

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

    setActiveTask((prev) => prev ? { ...prev, status: 'cancelled', taskState: 'failed' } : null);
  }, [activeTask, addMessage]);

  const selectOption = useCallback((option: VendorOption) => {
    if (!activeTask) return;

    setActiveTask((prev) => prev ? { ...prev, selectedOption: option } : null);

    addMessage({
      id: uid(),
      role: 'assistant',
      content: `Switched to **${option.name}** — ${option.item} for **$${option.price.toFixed(2)}**. Approve?`,
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
