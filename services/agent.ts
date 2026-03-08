import {
  ChatMessage, AgentTask, VendorOption,
  OptionsData, ApprovalData, ReceiptData, AgentLogData, FundingData, EvidenceData,
} from '@/lib/types';
import { uid, delay } from '@/lib/utils';
import * as tinyfish from './tinyfish';
import * as walletService from './wallet';
import { buildReasoningPlan, type ReasoningPlan } from './reasoning';
import type { Wallet } from '@/lib/types';

interface ParsedIntent {
  action: 'buy' | 'procurement' | 'send' | 'fund' | 'balance' | 'history' | 'settings' | 'help' | 'unknown';
  query: string;
  amount?: number;
  maxBudget?: number;
  recipientName?: string;
}

export function parseIntent(text: string): ParsedIntent {
  const lower = text.toLowerCase().trim();

  if (/^(send|pay|transfer)\b/i.test(lower)) {
    const amountMatch = lower.match(/\$?(\d+(?:\.\d{1,2})?)/);
    const recipientMatch = lower.match(/(?:to|for)\s+([a-z0-9 .'-]{2,})$/i);
    return {
      action: 'send',
      query: text,
      amount: amountMatch ? parseFloat(amountMatch[1]) : undefined,
      recipientName: recipientMatch ? recipientMatch[1].trim() : undefined,
    };
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

export interface AgentCallbacks {
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string, data?: ChatMessage['data']) => void;
  setWallet: (wallet: Wallet) => void;
  getWallet: () => Wallet;
  refreshWallet: () => Promise<void>;
}

export async function handleBuyFlow(
  intent: ParsedIntent,
  location: string | undefined,
  cb: AgentCallbacks,
): Promise<AgentTask> {
  const w = cb.getWallet();
  const taskId = uid();

  const task: AgentTask = {
    id: taskId,
    intent: intent.query,
    category: 'buy',
    maxBudget: intent.maxBudget ?? w.settings.maxTransaction,
    location,
    status: 'active',
    steps: [],
    startedAt: new Date().toISOString(),
  };

  if (w.balance <= 0) {
    cb.addMessage(msg('assistant', 'Your available balance is $0.00. Add real funds via Stripe before making purchases.'));
    task.status = 'cancelled';
    return task;
  }

  cb.addMessage(msg('assistant', 'Reasoning through your request and guardrails...', 'thinking'));

  let reasoning: ReasoningPlan;
  try {
    reasoning = await buildReasoningPlan(intent.query, w);
  } catch (error) {
    cb.updateLastMessage(
      error instanceof Error
        ? `OpenAI reasoning failed: ${error.message}`
        : 'OpenAI reasoning failed.',
    );
    task.status = 'cancelled';
    return task;
  }

  if (reasoning.needsClarification) {
    cb.updateLastMessage(
      reasoning.clarifyingQuestion || 'One quick clarification: what should I buy and what budget should I use?',
    );
    task.status = 'cancelled';
    return task;
  }

  const resolvedBudget = Math.min(reasoning.budgetMax, w.settings.maxTransaction, w.balance);
  if (resolvedBudget <= 0) {
    cb.updateLastMessage('Insufficient available balance for this action.');
    task.status = 'cancelled';
    return task;
  }

  task.maxBudget = resolvedBudget;
  task.reasoningPlan = reasoning.plan;

  cb.updateLastMessage(
    `Plan ready. I will search for options under $${resolvedBudget.toFixed(2)}.`,
    planToSteps(reasoning),
  );

  await delay(120);
  cb.addMessage(msg('assistant', 'Searching live options with TinyFish...', 'thinking'));

  const { options, pricing, steps: searchSteps } = await tinyfish.searchOptions(reasoning.searchQuery, location, resolvedBudget);
  task.steps.push(...searchSteps);

  cb.updateLastMessage('Here is what TinyFish found:', { steps: searchSteps } as AgentLogData);

  cb.addMessage(msg(
    'assistant',
    `TinyFish extracted ${pricing.length} live pricing evidence point${pricing.length === 1 ? '' : 's'}.`,
    'evidence',
    { findings: pricing } as EvidenceData,
  ));

  if (options.length === 0) {
    cb.addMessage(msg('assistant', `No options were found within $${resolvedBudget.toFixed(2)}.`));
    task.status = 'cancelled';
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
    cb.addMessage(msg('assistant', `Blocked by guardrails: ${canPay.reason}.`));
    task.status = 'cancelled';
    return task;
  }

  if (recommended.price < w.settings.approvalThreshold) {
    cb.addMessage(msg('assistant', `Under approval threshold ($${w.settings.approvalThreshold.toFixed(2)}). Proceeding...`));
    return completePurchase(task, recommended, cb);
  }

  cb.addMessage(msg('assistant', 'Approve this purchase?', 'approval', {
    merchant: recommended.name,
    item: recommended.item,
    amount: recommended.price,
    taskId,
  } as ApprovalData));

  task.status = 'awaiting-approval';
  return task;
}

export async function handleSendFlow(
  intent: ParsedIntent,
  cb: AgentCallbacks,
): Promise<AgentTask> {
  const w = cb.getWallet();

  const task: AgentTask = {
    id: uid(),
    intent: intent.query,
    category: 'send',
    maxBudget: intent.amount || 0,
    status: 'active',
    steps: [],
    startedAt: new Date().toISOString(),
  };

  if (!intent.amount || intent.amount <= 0 || !intent.recipientName) {
    cb.addMessage(msg('assistant', 'Use: "Send $10 to Alice". Recipient must be approved with a Stripe connected account.'));
    task.status = 'cancelled';
    return task;
  }

  const check = walletService.canSpendSnapshot(w, intent.amount, intent.recipientName);
  if (!check.allowed) {
    cb.addMessage(msg('assistant', `Cannot send: ${check.reason}.`));
    task.status = 'cancelled';
    return task;
  }

  const option: VendorOption = {
    id: uid(),
    name: intent.recipientName,
    item: 'Direct transfer',
    price: intent.amount,
  };

  task.selectedOption = option;

  if (intent.amount < w.settings.approvalThreshold) {
    cb.addMessage(msg('assistant', 'Under approval threshold. Executing transfer now...'));
    return completeSendFlow(task, option, cb);
  }

  cb.addMessage(msg('assistant', 'Approve this transfer?', 'approval', {
    merchant: option.name,
    item: option.item,
    amount: option.price,
    taskId: task.id,
  } as ApprovalData));

  task.status = 'awaiting-approval';
  return task;
}

export async function completePurchase(
  task: AgentTask,
  option: VendorOption,
  cb: AgentCallbacks,
): Promise<AgentTask> {
  cb.addMessage(msg('assistant', `Preparing checkout at ${option.name}...`, 'thinking'));
  const { steps: checkoutSteps } = await tinyfish.prepareCheckout(option);
  task.steps.push(...checkoutSteps);

  cb.updateLastMessage('Checkout prepared. Running payment step...', {
    steps: checkoutSteps,
  } as AgentLogData);

  const latestWallet = cb.getWallet();
  const check = walletService.canSpendSnapshot(latestWallet, option.price, option.name);
  if (!check.allowed) {
    cb.addMessage(msg('assistant', `Payment blocked: ${check.reason}.`));
    task.status = 'cancelled';
    return task;
  }

  const { steps: confirmSteps, success } = await tinyfish.confirmPurchase(option);
  task.steps.push(...confirmSteps);

  if (!success) {
    cb.addMessage(msg('assistant', 'Purchase failed during browser confirmation. No transfer was sent.'));
    task.status = 'cancelled';
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

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    return task;
  } catch (error) {
    cb.addMessage(msg(
      'assistant',
      error instanceof Error
        ? `Real transfer failed: ${error.message}`
        : 'Real transfer failed. Balance unchanged.',
    ));

    task.status = 'cancelled';
    return task;
  }
}

export async function completeSendFlow(
  task: AgentTask,
  option: VendorOption,
  cb: AgentCallbacks,
): Promise<AgentTask> {
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

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    return task;
  } catch (error) {
    cb.addMessage(msg('assistant', error instanceof Error ? `Send failed: ${error.message}` : 'Send failed.'));
    task.status = 'cancelled';
    return task;
  }
}

export function handleFundFlow(intent: ParsedIntent, cb: AgentCallbacks): void {
  const amount = intent.amount;
  if (!amount || amount <= 0) {
    cb.addMessage(msg('assistant', 'How much should I add? Example: "Add $25".'));
    return;
  }

  cb.addMessage(msg(
    'assistant',
    `I can fund your wallet with Stripe (Apple Pay and Cash App Pay if enabled). Confirm top-up of **$${amount.toFixed(2)}**?`,
    'funding',
    { amount } as FundingData,
  ));
}

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
    `Try:\n` +
      `- "Find the best AI note-taking tool under $15/month"\n` +
      `- "Compare email outreach tools under $50/month"\n` +
      `- "Buy me coffee"\n` +
      `- "Send $10 to Alice"\n` +
      `- "Add $20"\n` +
      `- "What's my balance?"\n\n` +
      `Real-money rules: balance only changes from Stripe webhook credits and Stripe transfer-backed debits.`,
  ));
}
