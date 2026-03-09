import {
  ChatMessage, AgentTask, VendorOption, TaskState, TaskProgressData,
  OptionsData, ApprovalData, ReceiptData, AgentLogData, FundingData, EvidenceData,
} from '@/lib/types';
import { uid, delay } from '@/lib/utils';
import * as tinyfish from './tinyfish';
import * as walletService from './wallet';
import { buildReasoningPlan, type ReasoningPlan } from './reasoning';
import type { Wallet, Recipient } from '@/lib/types';

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

interface ParsedIntent {
  action: 'buy' | 'procurement' | 'send' | 'fund' | 'balance' | 'history' | 'settings' | 'help' | 'unknown';
  query: string;
  amount?: number;
  maxBudget?: number;
  recipientName?: string;
}

export interface AgentIntentParseResult {
  intent:
    | 'send_money'
    | 'fund_wallet'
    | 'procurement_task'
    | 'compare_and_buy'
    | 'signup_and_prepare_checkout'
    | 'cancel_subscription'
    | 'review_spend';
  amount: number | null;
  currency: 'USD';
  recipient_name: string | null;
  recipient_stripe_account_id?: string | null;
  merchant: string | null;
  description: string;
  budget_limit: number | null;
  confidence: number;
  missing_fields: string[];
  required_profile_fields?: string[];
  profile_updates?: Record<string, string>;
}

export interface AgentOrchestrationResult {
  route:
    | 'clarification'
    | 'send_money_approval'
    | 'procurement_task'
    | 'signup_and_prepare_checkout'
    | 'fund_wallet'
    | 'review_spend'
    | 'cancel_subscription';
  taskId: string;
  status: 'awaiting_clarification' | 'awaiting_approval' | 'ready' | 'blocked';
  intent: AgentIntentParseResult;
  message: string;
  missingFields?: string[];
  sendMoney?: {
    amount: number;
    recipientName: string;
    recipientId: string;
  };
  fundWallet?: {
    amount: number;
  };
  procurement?: {
    goal: string;
  };
  signup?: {
    merchant: string | null;
    requiredProfileFields: string[];
  };
  reviewSpend?: {
    balance: number;
    currency: string;
    dailySpent: number;
    monthlySpent: number;
  };
  cancelSubscription?: {
    vendorName: string;
    taskId: string;
  };
  taskState?: 'received' | 'parsing' | 'needs_clarification' | 'ready_to_execute' | 'executing' | 'awaiting_approval' | 'completed' | 'failed';
  toolRoute?: 'reason' | 'ask_clarification' | 'tinyfish' | 'stripe_wallet' | 'database_query';
  executionResult?: {
    status: 'success' | 'failed' | 'queued' | 'noop' | 'pending_checkout' | 'needs_input';
    message?: string;
    [key: string]: unknown;
  } | null;
  lifecycle?: Array<{
    state: 'received' | 'parsing' | 'needs_clarification' | 'ready_to_execute' | 'executing' | 'awaiting_approval' | 'completed' | 'failed';
    at: string;
    note: string;
  }>;
}

// ---------------------------------------------------------------------------
// Client-side quick regex parser (fallback / pre-filter)
// ---------------------------------------------------------------------------

export function parseIntent(text: string): ParsedIntent {
  const lower = text.toLowerCase().trim();

  // send/pay/transfer TO A PERSON (must have a person-like target, not a product)
  const sendMatch = lower.match(/^(send|pay|transfer)\s+(.+)/i);
  if (sendMatch) {
    const rest = sendMatch[2];
    // "pay for notion" / "pay my bill" => NOT send_money, it's procurement
    if (/^(for|my)\s+(bill|subscription|plan|service|software)/i.test(rest)) {
      // Fall through to procurement/buy matching
    } else {
      const amountMatch = lower.match(/\$?(\d+(?:\.\d{1,2})?)/);
      // Extract recipient: "send liz 5", "send 5 to liz", "pay my fiancee a dollar"
      const toRecipient = lower.match(/(?:to|for)\s+([a-z][a-z0-9 .'-]{0,30})$/i);
      const leadRecipient = lower.match(/^(?:send|pay|transfer)\s+([a-z][a-z .'-]{0,30}?)\s+\$?\d/i);
      const nameOnly = lower.match(/^(?:send|pay|transfer)\s+([a-z][a-z .'-]{1,30}?)(?:\s+(?:money|some|cash))?$/i);
      const recipientName = toRecipient?.[1]?.trim() || leadRecipient?.[1]?.trim() || nameOnly?.[1]?.trim();
      return {
        action: 'send',
        query: text,
        amount: amountMatch ? parseFloat(amountMatch[1]) : undefined,
        recipientName: recipientName || undefined,
      };
    }
  }

  if (/^(add|deposit|fund|load|top.?up)\b/i.test(lower)) {
    const amountMatch = lower.match(/\$?(\d+(?:\.\d{1,2})?)/);
    return { action: 'fund', query: text, amount: amountMatch ? parseFloat(amountMatch[1]) : undefined };
  }

  if (/^(balance|how much|wallet|funds)/i.test(lower)) {
    return { action: 'balance', query: text };
  }

  if (/^(history|transactions|past|recent|log)/i.test(lower)) {
    return { action: 'history', query: text };
  }

  if (/^(settings|config|preferences|budget|cap|limit|guardrail)/i.test(lower)) {
    return { action: 'settings', query: text };
  }

  if (/^(help|what can|how do|commands)/i.test(lower)) {
    return { action: 'help', query: text };
  }

  const procurementPhrase = /(compare|best|cheapest|find)\b.*\b(tool|software|platform|crm|service|suite|vendor|solution|app)s?\b/i.test(lower);
  const procurementBudget = /\bunder\s+\$?\d+(?:\.\d{1,2})?\s*(?:\/\s*(month|mo|monthly|year|annual|yearly))?/i.test(lower);
  const procurementScope = /\b(note-?taking|outreach|crm|pipeline|email|procurement|saas|subscription)\b/i.test(lower);

  if (procurementPhrase || (procurementBudget && procurementScope)) {
    return { action: 'procurement', query: text };
  }

  if (/buy|order|get|find|subscribe|purchase|book|rent|grab|pick.?up|coffee|lunch|parking/i.test(lower)) {
    const budgetMatch = lower.match(/under\s+\$?(\d+(?:\.\d{1,2})?)/);
    return {
      action: 'buy',
      query: text,
      maxBudget: budgetMatch ? parseFloat(budgetMatch[1]) : undefined,
    };
  }

  return { action: 'unknown', query: text };
}

// ---------------------------------------------------------------------------
// OpenAI intent parser (server call)
// ---------------------------------------------------------------------------

export async function parseAgentIntent(message: string): Promise<AgentIntentParseResult> {
  const response = await fetch('/api/agent/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    intent?: AgentIntentParseResult;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !body.intent) {
    const error = body.errorCode && body.error
      ? `${body.errorCode}: ${body.error}`
      : body.error || 'Failed to parse intent';
    throw new Error(error);
  }

  return body.intent;
}

export async function orchestrateAgentMessage(message: string): Promise<AgentOrchestrationResult> {
  const response = await fetch('/api/agent/orchestrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    orchestration?: AgentOrchestrationResult;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !body.orchestration) {
    const error = body.errorCode && body.error
      ? `${body.errorCode}: ${body.error}`
      : body.error || 'Failed to orchestrate agent message';
    throw new Error(error);
  }

  return body.orchestration;
}

// ---------------------------------------------------------------------------
// Response matchers
// ---------------------------------------------------------------------------

export function isAffirmativeResponse(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(yes|yep|yeah|y|confirm|approved?|do it|send it|go ahead|ok|okay|sure|proceed)$/i.test(normalized);
}

export function isNegativeResponse(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(no|nope|nah|n|reject|cancel|stop|don'?t|never mind)$/i.test(normalized);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(role: ChatMessage['role'], content: string, type: ChatMessage['type'] = 'text', data?: ChatMessage['data']): ChatMessage {
  return { id: uid(), role, content, type, data, timestamp: new Date().toISOString() };
}

function planToSteps(plan: ReasoningPlan): AgentLogData {
  return {
    steps: [
      ...plan.plan.map((description) => ({
        id: uid(),
        type: 'plan' as const,
        description,
        status: 'done' as const,
        timestamp: new Date().toISOString(),
      })),
      ...plan.guardrailChecks.map((description) => ({
        id: uid(),
        type: 'guardrail' as const,
        description,
        status: 'done' as const,
        timestamp: new Date().toISOString(),
      })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Task state machine helpers
// ---------------------------------------------------------------------------

export function createTask(intent: string, category: string, maxBudget: number): AgentTask {
  return {
    id: uid(),
    intent,
    category,
    maxBudget,
    status: 'active',
    taskState: 'received',
    steps: [],
    startedAt: new Date().toISOString(),
  };
}

export function transitionTask(task: AgentTask, newState: TaskState): AgentTask {
  return { ...task, taskState: newState };
}

export function makeProgressData(task: AgentTask, stateLabels: Array<{ state: TaskState; label: string }>): TaskProgressData {
  return {
    taskState: task.taskState,
    stateHistory: stateLabels.map((entry) => ({
      ...entry,
      timestamp: new Date().toISOString(),
    })),
  };
}

function progressMsg(content: string, task: AgentTask, labels: Array<{ state: TaskState; label: string }>): ChatMessage {
  return msg('assistant', content, 'task-progress', makeProgressData(task, labels));
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export interface AgentCallbacks {
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string, data?: ChatMessage['data']) => void;
  setWallet: (wallet: Wallet) => void;
  getWallet: () => Wallet;
  refreshWallet: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

export function resolveRecipient(wallet: Wallet, name: string): Recipient | null {
  const normalizedLookup = name.toLowerCase();
  const approved = wallet.recipients.filter((r) => r.status === 'approved');
  return approved.find((candidate) => {
    const norm = candidate.name.toLowerCase();
    return norm === normalizedLookup
      || norm.includes(normalizedLookup)
      || normalizedLookup.includes(norm);
  }) || null;
}

// ---------------------------------------------------------------------------
// Autonomous send money executor
// ---------------------------------------------------------------------------

export async function executeSendMoney(params: {
  amount: number;
  recipientName: string;
  recipient: Recipient;
  wallet: Wallet;
  cb: AgentCallbacks;
}): Promise<AgentTask> {
  const { amount, recipientName, recipient, wallet, cb } = params;
  const task = createTask(`Send $${amount.toFixed(2)} to ${recipientName}`, 'send', amount);

  // State: parsing → ready_to_execute
  task.taskState = 'ready_to_execute';

  const progressLabels: Array<{ state: TaskState; label: string }> = [
    { state: 'received', label: 'Request received' },
    { state: 'parsing', label: 'Parsed intent: send_money' },
    { state: 'ready_to_execute', label: `Recipient resolved: ${recipient.name}` },
  ];

  // Guardrail check
  const check = walletService.canSpendSnapshot(wallet, amount, recipient.name);
  if (!check.allowed) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    progressLabels.push({ state: 'failed', label: `Guardrail blocked: ${check.reason}` });
    cb.addMessage(progressMsg(`Cannot send $${amount.toFixed(2)} to ${recipient.name}: ${check.reason}.`, task, progressLabels));
    return task;
  }

  progressLabels.push({ state: 'ready_to_execute', label: 'Policy checks passed' });

  // Auto-approve or request approval
  if (amount < wallet.settings.approvalThreshold) {
    task.taskState = 'executing';
    progressLabels.push({ state: 'executing', label: 'Under approval threshold — auto-executing' });
    cb.addMessage(progressMsg(`Sending $${amount.toFixed(2)} to ${recipient.name}...`, task, progressLabels));

    return completeSendFlow(task, {
      id: uid(),
      name: recipient.name,
      item: 'Direct transfer',
      price: amount,
    }, cb);
  }

  // Needs approval
  task.taskState = 'awaiting_approval';
  task.status = 'awaiting-approval';
  task.selectedOption = {
    id: uid(),
    name: recipient.name,
    item: 'Direct transfer',
    price: amount,
  };
  task.recipientId = recipient.id;

  progressLabels.push({ state: 'awaiting_approval', label: 'Awaiting your approval' });
  cb.addMessage(progressMsg(
    `Ready to send **$${amount.toFixed(2)}** to **${recipient.name}**. Approve?`,
    task,
    progressLabels,
  ));

  cb.addMessage(msg('assistant', `Send **$${amount.toFixed(2)}** to **${recipient.name}**?`, 'approval', {
    merchant: recipient.name,
    item: 'Direct transfer',
    amount,
    taskId: task.id,
  } as ApprovalData));

  return task;
}

// ---------------------------------------------------------------------------
// Buy flow (procurement_task quick buy)
// ---------------------------------------------------------------------------

export async function handleBuyFlow(
  intent: ParsedIntent,
  location: string | undefined,
  cb: AgentCallbacks,
): Promise<AgentTask> {
  const w = cb.getWallet();
  const task = createTask(intent.query, 'buy', intent.maxBudget ?? w.settings.maxTransaction);
  task.location = location;

  const progressLabels: Array<{ state: TaskState; label: string }> = [
    { state: 'received', label: 'Request received' },
    { state: 'parsing', label: 'Intent: procurement / buy' },
  ];

  if (w.balance <= 0) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    progressLabels.push({ state: 'failed', label: 'Insufficient balance' });
    cb.addMessage(progressMsg('Your available balance is $0.00. Add real funds via Stripe before making purchases.', task, progressLabels));
    return task;
  }

  task.taskState = 'executing';
  progressLabels.push({ state: 'executing', label: 'Building reasoning plan...' });
  cb.addMessage(progressMsg('Reasoning through your request and guardrails...', task, progressLabels));

  let reasoning: ReasoningPlan;
  try {
    reasoning = await buildReasoningPlan(intent.query, w);
  } catch (error) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    cb.updateLastMessage(
      error instanceof Error
        ? `OpenAI reasoning failed: ${error.message}`
        : 'OpenAI reasoning failed.',
    );
    return task;
  }

  if (reasoning.needsClarification) {
    task.taskState = 'needs_clarification';
    task.status = 'cancelled';
    cb.updateLastMessage(
      reasoning.clarifyingQuestion || 'One quick clarification: what should I buy and what budget should I use?',
    );
    return task;
  }

  const resolvedBudget = Math.min(reasoning.budgetMax, w.settings.maxTransaction, w.balance);
  if (resolvedBudget <= 0) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    cb.updateLastMessage('Insufficient available balance for this action.');
    return task;
  }

  task.maxBudget = resolvedBudget;
  task.reasoningPlan = reasoning.plan;

  cb.updateLastMessage(
    `Plan ready. Searching for options under $${resolvedBudget.toFixed(2)}...`,
    planToSteps(reasoning),
  );

  await delay(120);
  cb.addMessage(msg('assistant', 'Launching TinyFish to search live vendor options...', 'thinking'));

  const { options, pricing, steps: searchSteps } = await tinyfish.searchOptions(reasoning.searchQuery, location, resolvedBudget);
  task.steps.push(...searchSteps);

  cb.updateLastMessage('TinyFish research complete:', { steps: searchSteps } as AgentLogData);

  cb.addMessage(msg(
    'assistant',
    `Extracted ${pricing.length} live pricing evidence point${pricing.length === 1 ? '' : 's'}.`,
    'evidence',
    { findings: pricing } as EvidenceData,
  ));

  if (options.length === 0) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    cb.addMessage(msg('assistant', `No options were found within $${resolvedBudget.toFixed(2)}.`));
    return task;
  }

  const sorted = [...options].sort((a, b) => {
    const scoreA = (a.rating ?? 0) - a.price / 10;
    const scoreB = (b.rating ?? 0) - b.price / 10;
    return scoreB - scoreA;
  });

  const recommended = sorted[0];
  task.selectedOption = recommended;

  cb.addMessage(msg('assistant', `Top pick: **${recommended.name}** — ${recommended.item} for **$${recommended.price.toFixed(2)}**.`, 'options', {
    options,
    recommendedId: recommended.id,
  } as OptionsData));

  const canPay = walletService.canSpendSnapshot(w, recommended.price, recommended.name);
  if (!canPay.allowed) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    cb.addMessage(msg('assistant', `Blocked by guardrails: ${canPay.reason}.`));
    return task;
  }

  if (recommended.price < w.settings.approvalThreshold) {
    task.taskState = 'executing';
    cb.addMessage(msg('assistant', `Under approval threshold ($${w.settings.approvalThreshold.toFixed(2)}). Proceeding autonomously...`));
    return completePurchase(task, recommended, cb);
  }

  task.taskState = 'awaiting_approval';
  task.status = 'awaiting-approval';

  cb.addMessage(msg('assistant', 'Approve this purchase?', 'approval', {
    merchant: recommended.name,
    item: recommended.item,
    amount: recommended.price,
    taskId: task.id,
  } as ApprovalData));

  return task;
}

// ---------------------------------------------------------------------------
// Complete purchase (autonomous execution after approval)
// ---------------------------------------------------------------------------

export async function completePurchase(
  task: AgentTask,
  option: VendorOption,
  cb: AgentCallbacks,
): Promise<AgentTask> {
  task.taskState = 'executing';
  cb.addMessage(msg('assistant', `Launching TinyFish to prepare checkout at ${option.name}...`, 'thinking'));

  const { steps: checkoutSteps } = await tinyfish.prepareCheckout(option);
  task.steps.push(...checkoutSteps);

  cb.updateLastMessage('Checkout prepared. Running payment step...', {
    steps: checkoutSteps,
  } as AgentLogData);

  const latestWallet = cb.getWallet();
  const check = walletService.canSpendSnapshot(latestWallet, option.price, option.name);
  if (!check.allowed) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    cb.addMessage(msg('assistant', `Payment blocked: ${check.reason}.`));
    return task;
  }

  const { steps: confirmSteps, success } = await tinyfish.confirmPurchase(option);
  task.steps.push(...confirmSteps);

  if (!success) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    cb.addMessage(msg('assistant', 'Purchase failed during browser confirmation. No transfer was sent.'));
    return task;
  }

  const previousBalance = latestWallet.balance;

  try {
    const result = await walletService.sendMoney({
      amount: option.price,
      recipientName: option.name,
      merchant: option.name,
      sourceUrl: option.url,
      description: `${option.item} from ${option.name}`,
      approved: true,
      idempotencyKey: task.id,
    });

    cb.setWallet(result.wallet);

    cb.addMessage(msg('assistant', 'Payment complete.', 'agent-log', {
      steps: confirmSteps,
    } as AgentLogData));

    cb.addMessage(msg('assistant', 'Done. Receipt:', 'receipt', {
      merchant: option.name,
      item: option.item,
      amount: option.price,
      previousBalance,
      newBalance: result.wallet.balance,
      transactionId: result.transaction.id,
    } as ReceiptData));

    task.taskState = 'completed';
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    return task;
  } catch (error) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    cb.addMessage(msg(
      'assistant',
      error instanceof Error
        ? `Real transfer failed: ${error.message}`
        : 'Real transfer failed. Balance unchanged.',
    ));
    return task;
  }
}

// ---------------------------------------------------------------------------
// Complete send (autonomous execution after approval)
// ---------------------------------------------------------------------------

export async function completeSendFlow(
  task: AgentTask,
  option: VendorOption,
  cb: AgentCallbacks,
): Promise<AgentTask> {
  task.taskState = 'executing';
  const previousBalance = cb.getWallet().balance;

  try {
    const result = await walletService.sendMoney({
      amount: option.price,
      recipientName: option.name,
      description: `Direct send to ${option.name}`,
      approved: true,
      idempotencyKey: task.id,
    });

    cb.setWallet(result.wallet);

    cb.addMessage(msg('assistant', 'Transfer succeeded.', 'receipt', {
      merchant: option.name,
      item: 'Direct transfer',
      amount: option.price,
      previousBalance,
      newBalance: result.wallet.balance,
      transactionId: result.transaction.id,
    } as ReceiptData));

    task.taskState = 'completed';
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    return task;
  } catch (error) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    cb.addMessage(msg('assistant', error instanceof Error ? `Send failed: ${error.message}` : 'Send failed.'));
    return task;
  }
}

// ---------------------------------------------------------------------------
// Fund wallet flow
// ---------------------------------------------------------------------------

export function handleFundFlow(intent: ParsedIntent, cb: AgentCallbacks): void {
  const amount = intent.amount;
  if (!amount || amount <= 0) {
    cb.addMessage(msg('assistant', 'How much should I add? Example: "Add $25".'));
    return;
  }

  cb.addMessage(msg(
    'assistant',
    `I will fund your wallet with **$${amount.toFixed(2)}** via Stripe. This requires Stripe Checkout for payment processing.`,
    'funding',
    { amount } as FundingData,
  ));
}

// ---------------------------------------------------------------------------
// Balance / Help
// ---------------------------------------------------------------------------

export function handleBalanceFlow(cb: AgentCallbacks): void {
  const w = cb.getWallet();
  const dailySpent = walletService.getDailySpent(w);
  const monthlySpent = walletService.getMonthlySpent(w);

  cb.addMessage(msg(
    'assistant',
    `Balance: **$${w.balance.toFixed(2)}**\n\n` +
      `Daily spent: $${dailySpent.toFixed(2)} / $${w.settings.dailyLimit.toFixed(2)}\n` +
      `Monthly spent: $${monthlySpent.toFixed(2)} / $${w.settings.monthlyBudget.toFixed(2)}\n` +
      `Max transaction: $${w.settings.maxTransaction.toFixed(2)}`,
  ));
}

export function handleHelp(cb: AgentCallbacks): void {
  cb.addMessage(msg(
    'assistant',
    `I can help with:\n` +
      `- **Send money**: "Send $10 to Alice", "Pay my fiancee $5"\n` +
      `- **Buy / Procure**: "Buy me coffee", "Find the best CRM under $15/mo"\n` +
      `- **Fund wallet**: "Add $20 to my wallet"\n` +
      `- **Cancel subscriptions**: "Cancel my Grammarly"\n` +
      `- **Review spending**: "What's my balance?"\n\n` +
      `I'll handle the work autonomously and only pause for approvals, clarifications, or credentials.`,
  ));
}
