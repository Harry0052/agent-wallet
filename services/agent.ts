import {
  ChatMessage, AgentTask, VendorOption, TaskState, TaskProgressData,
  OptionsData, ApprovalData, ReceiptData, AgentLogData, FundingData, EvidenceData,
  SignupSummaryData,
} from '@/lib/types';
import { uid, delay } from '@/lib/utils';
import * as tinyfish from './tinyfish';
import * as walletService from './wallet';
import * as toolsService from './tools';
import { buildReasoningPlan, type ReasoningPlan } from './reasoning';
import type { Wallet, Recipient, UserToolRecord } from '@/lib/types';
import { evaluateSignupSafety, type SignupFlowBlocker } from '@/lib/signup/safety';
import { createActivationVerificationEngine } from '@/lib/activation/engine';
import { createApiCheckProvider } from '@/lib/activation/providers/apiCheck';
import { mapErrorToFailure } from '@/lib/failures/mapError';
import { FailureSource, WalletFailureCode } from '@/lib/failures/codes';

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
    | 'candidate_sourcing_task'
    | 'signup_and_prepare_checkout'
    | 'cancel_subscription'
    | 'review_spend';
  amount: number | null;
  currency: 'USD';
  normalized_goal?: string | null;
  category?: string | null;
  scope_locked?: boolean;
  candidate_vendors?: string[];
  recipient_name: string | null;
  delivery_method?: 'cash_app' | 'stripe_connected' | 'bank' | null;
  recipient_stripe_account_id?: string | null;
  cash_app_cashtag?: string | null;
  bank_reference?: string | null;
  funding_source?: string | null;
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
    | 'candidate_sourcing_task'
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
    sendMethod: Recipient['sendMethod'];
  };
  fundWallet?: {
    amount: number;
  };
  procurement?: {
    goal: string;
  };
  candidateSourcing?: {
    goal: string;
    platform: 'indeed';
    shortlistCount: number;
  };
  signup?: {
    merchant: string | null;
    requiredProfileFields: string[];
    mode?: 'login' | 'signup';
    toolKey?: string | null;
    toolDisplayName?: string | null;
    credentialState?: 'ready' | 'updated' | 'action_required';
    usedSavedLogin?: boolean;
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

function normalizeMatchToken(input: string | null | undefined): string {
  if (!input) return '';
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toolMatchesService(tool: UserToolRecord, merchant: string): boolean {
  const merchantToken = normalizeMatchToken(merchant);
  if (!merchantToken) return false;

  const candidates = [
    tool.tool.key,
    tool.tool.displayName,
    tool.label || '',
  ].map((value) => normalizeMatchToken(value));

  return candidates.some((candidate) => (
    candidate.length > 0
    && (candidate.includes(merchantToken) || merchantToken.includes(candidate))
  ));
}

async function verifyProvisionedServiceTool(params: {
  merchant: string;
  expectedToolId?: string;
  attempts?: number;
  waitMs?: number;
}): Promise<{ ok: boolean; tool?: UserToolRecord; reason?: string }> {
  const attempts = Math.max(1, params.attempts ?? 6);
  const waitMs = Math.max(250, params.waitMs ?? 1500);
  let lastError: string | undefined;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const tools = await toolsService.fetchUserTools();
      const scoped = params.expectedToolId
        ? tools.filter((tool) => tool.id === params.expectedToolId)
        : tools.filter((tool) => toolMatchesService(tool, params.merchant));

      const provisioned = scoped.find((tool) => (
        tool.status === 'connected'
        && tool.enabled
        && tool.hasSecret
      ));

      if (provisioned) {
        return { ok: true, tool: provisioned };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Failed to query tools';
    }

    if (i < attempts - 1) {
      await delay(waitMs);
    }
  }

  if (params.expectedToolId) {
    return {
      ok: false,
      reason: lastError || `Tool ${params.expectedToolId} was not connected with stored credentials`,
    };
  }

  return {
    ok: false,
    reason: lastError || `No ${params.merchant} tool with stored credentials was found`,
  };
}

function inferAntiBotRiskFromBlocker(code?: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const normalized = (code || '').toLowerCase();
  if (!normalized) return 'MEDIUM';
  if (normalized.includes('captcha') || normalized.includes('bot')) return 'CRITICAL';
  if (normalized.includes('blocked') || normalized.includes('challenge')) return 'HIGH';
  return 'MEDIUM';
}

function inferProvisioningConfidence(merchant: string): number {
  const normalized = merchant.toLowerCase();
  if (normalized.includes('aws') || normalized.includes('openai') || normalized.includes('cloudflare')) return 0.9;
  if (normalized.includes('netflix') || normalized.includes('hulu') || normalized.includes('disney')) return 0.68;
  if (normalized.includes('adobe')) return 0.62;
  return 0.7;
}

function applySignupFailure(task: AgentTask, blocker: SignupFlowBlocker): void {
  task.failure = {
    code: blocker.code,
    stage: blocker.stage,
    message: blocker.message,
    userMessage: blocker.userMessage,
    recoverable: blocker.recoverable,
    blockedReasons: blocker.blockedReasons,
    details: blocker.details,
  };
  task.signupExecution = {
    ...(task.signupExecution || {}),
    blocker: task.failure,
  };
}

function setSignupExecution(task: AgentTask, patch: Partial<NonNullable<AgentTask['signupExecution']>>): void {
  task.signupExecution = {
    ...(task.signupExecution || {}),
    ...patch,
  };
}

async function runSignupActivationVerification(params: {
  userId: string;
  merchant: string;
  taskId: string;
  paymentFlowId: string;
  authorizedAt: string;
  expectedToolId?: string;
}): Promise<{
  activationStatus: 'PENDING' | 'ACTIVE' | 'FAILED' | 'UNKNOWN';
  evidence: Array<Record<string, unknown>>;
  verifiedAt: string | null;
  nextAction: string;
  settlementRecommendation: string;
  tool: UserToolRecord | null;
}> {
  let provisionedTool: UserToolRecord | null = null;

  const apiProvider = createApiCheckProvider({
    providerId: 'tool-provisioning-check',
    async check() {
      const result = await verifyProvisionedServiceTool({
        merchant: params.merchant,
        expectedToolId: params.expectedToolId,
        attempts: 6,
        waitMs: 1300,
      });

      if (result.ok) {
        provisionedTool = result.tool || null;
        return {
          status: 'ACTIVE' as const,
          observedAt: new Date().toISOString(),
          referenceId: result.tool?.id || undefined,
          summary: `${params.merchant} tool is connected with stored credentials.`,
          confidence: 0.93,
          raw: {
            toolId: result.tool?.id || null,
            enabled: result.tool?.enabled || false,
            hasSecret: result.tool?.hasSecret || false,
          },
        };
      }

      return {
        status: 'FAILED' as const,
        observedAt: new Date().toISOString(),
        summary: result.reason || `${params.merchant} service credentials were not provisioned.`,
        confidence: 0.9,
        raw: {
          reason: result.reason || null,
          expectedToolId: params.expectedToolId || null,
        },
      };
    },
  });

  const engine = createActivationVerificationEngine({
    providers: [apiProvider],
    policy: {
      activationTimeoutMs: 15_000,
      safeModeOnTimeout: true,
    },
  });

  const verification = await engine.verify({
    paymentId: params.paymentFlowId,
    userId: params.userId,
    merchant: params.merchant,
    taskId: params.taskId,
    authorizedAt: params.authorizedAt,
  });

  const normalizedEvidence = verification.evidence.map((item) => ({
    provider: item.provider,
    method: item.method,
    status: item.status,
    observedAt: item.observedAt,
    summary: item.summary,
    referenceId: item.referenceId || null,
    confidence: item.confidence ?? null,
    raw: item.raw || null,
  }));

  return {
    activationStatus: verification.activationStatus,
    evidence: normalizedEvidence,
    verifiedAt: verification.verifiedAt,
    nextAction: verification.nextAction,
    settlementRecommendation: verification.settlementRecommendation,
    tool: provisionedTool,
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
    const candidates = [
      candidate.name.toLowerCase(),
      ...(candidate.aliases || []).map((alias) => alias.toLowerCase()),
    ];
    return candidates.some((norm) => (
      norm === normalizedLookup
      || norm.includes(normalizedLookup)
      || normalizedLookup.includes(norm)
    ));
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
      `- **Source candidates**: "Find 3 senior software engineers on Indeed and export to Google Sheets"\n` +
      `- **Sign up**: "Sign up for Netflix", "Create a Hulu account"\n` +
      `- **Fund wallet**: "Add $20 to my wallet"\n` +
      `- **Cancel subscriptions**: "Cancel my Grammarly"\n` +
      `- **Review spending**: "What's my balance?"\n\n` +
      `I'll handle the work autonomously and only pause for approvals, clarifications, or credentials.`,
  ));
}

// ---------------------------------------------------------------------------
// Signup flow — prepare (TinyFish navigates, fills forms, finds plan/price)
// ---------------------------------------------------------------------------

export async function handleSignupFlow(params: {
  merchant: string;
  signupUrl?: string;
  toolKey?: string;
  toolDisplayName?: string;
  cb: AgentCallbacks;
}): Promise<AgentTask> {
  const { merchant, signupUrl, toolKey, toolDisplayName, cb } = params;
  const w = cb.getWallet();
  const task = createTask(`Sign up for ${merchant}`, 'signup', w.settings.maxTransaction);
  task.signupMerchant = merchant;

  const progressLabels: Array<{ state: TaskState; label: string }> = [
    { state: 'received', label: 'Request received' },
    { state: 'parsing', label: `Intent: signup for ${merchant}` },
  ];

  const preflightSafety = evaluateSignupSafety({
    merchant,
    currency: w.currency,
    antiBotRisk: 'MEDIUM',
    knownRefundReliability: 'UNKNOWN',
    accountStatus: 'UNKNOWN',
    accountCreationRequired: true,
    serviceProvisioningConfidence: inferProvisioningConfidence(merchant),
    activationVerificationMethods: ['POST_PURCHASE_ACCOUNT_STATE_CHECK'],
    reserveOnlySupported: true,
  });

  setSignupExecution(task, {
    compatibility: preflightSafety.compatibility as unknown as Record<string, unknown>,
    riskGate: preflightSafety.risk as unknown as Record<string, unknown>,
  });

  if (!preflightSafety.allowed && preflightSafety.blocker) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    progressLabels.push({ state: 'failed', label: `Blocked by ${preflightSafety.blocker.code}` });
    applySignupFailure(task, preflightSafety.blocker);
    cb.addMessage(progressMsg(
      `Execution blocked before signup: ${preflightSafety.blocker.userMessage}`,
      task,
      progressLabels,
    ));
    cb.addMessage(msg(
      'assistant',
      'Structured failure recorded.',
      'agent-log',
      {
        steps: [],
        payload: {
          failure: task.failure,
          compatibility: task.signupExecution?.compatibility,
          riskGate: task.signupExecution?.riskGate,
        },
      } as AgentLogData,
    ));
    return task;
  }

  task.taskState = 'executing';
  progressLabels.push({ state: 'executing', label: `TinyFish navigating ${merchant} signup...` });
  cb.addMessage(progressMsg(
    `Launching TinyFish to prepare ${merchant} signup...`,
    task,
    progressLabels,
  ));

  const prepResult = await tinyfish.prepareSignup({
    service: merchant,
    signupUrl,
  });

  task.steps.push(...prepResult.steps);

  cb.addMessage(msg('assistant', `TinyFish signup preparation complete.`, 'agent-log', {
    steps: prepResult.steps,
  } as AgentLogData));

  if (!prepResult.success || prepResult.blocker) {
    task.taskState = 'failed';
    task.status = 'cancelled';
    const mapped = mapErrorToFailure({
      message: prepResult.blocker?.message || prepResult.failure?.message || 'Signup preparation failed.',
      source: FailureSource.MERCHANT,
      merchant,
      stage: 'signup',
      paymentStatus: 'unknown',
      activationStatus: 'UNKNOWN',
      metadata: {
        tinyfish_blocker_code: prepResult.blocker?.code || prepResult.failure?.code || null,
      },
    });
    applySignupFailure(task, {
      code: mapped.code,
      stage: 'compatibility',
      message: prepResult.blocker?.message || prepResult.failure?.message || mapped.message,
      userMessage: mapped.userMessage,
      blockedReasons: [prepResult.blocker?.message || prepResult.failure?.message || mapped.detectionReason],
      recoverable: mapped.recoverable,
      details: {
        tinyfishBlockerCode: prepResult.blocker?.code || prepResult.failure?.code || null,
        confidence: mapped.confidence,
        detectionReason: mapped.detectionReason,
      },
    });
    cb.addMessage(msg(
      'assistant',
      `Action required: ${task.failure?.userMessage || 'Signup preparation failed.'}`,
    ));
    cb.addMessage(msg(
      'assistant',
      'Structured failure recorded.',
      'agent-log',
      { steps: prepResult.steps, payload: { failure: task.failure } } as AgentLogData,
    ));
    return task;
  }

  const plan = prepResult.plan || 'Standard';
  const price = prepResult.price ?? 0;
  const billingCycle = prepResult.billingCycle || 'monthly';

  task.signupPlan = plan;
  task.signupPrice = price;
  task.signupBillingCycle = billingCycle;

  if (price > 0) {
    const check = walletService.canSpendSnapshot(w, price, merchant, { ignoreBalance: true });
    if (!check.allowed) {
      task.taskState = 'failed';
      task.status = 'cancelled';
      applySignupFailure(task, {
        code: WalletFailureCode.POLICY_BLOCKED,
        stage: 'pre_charge_risk',
        message: check.reason || 'Wallet policy check failed.',
        userMessage: check.reason || 'Wallet policy check failed.',
        blockedReasons: [check.reason || 'Wallet policy check failed'],
        recoverable: true,
        details: {
          amount: price,
          merchant,
        },
      });
      cb.addMessage(msg(
        'assistant',
        `Blocked by guardrails: ${check.reason}.`,
      ));
      return task;
    }
  }

  if (price > 0 && price >= w.settings.approvalThreshold) {
    task.taskState = 'awaiting_approval';
    task.status = 'awaiting-approval';
    task.selectedOption = {
      id: uid(),
      name: toolDisplayName || merchant,
      item: `${plan} plan`,
      price,
    };

    cb.addMessage(msg(
      'assistant',
      `Approve ${merchant} ${plan} for $${price.toFixed(2)}/${billingCycle} using Agent Wallet funds?`,
      'approval',
      {
        merchant,
        item: `${plan} — ${billingCycle}`,
        amount: price,
        taskId: task.id,
      } as ApprovalData,
    ));
    return task;
  }

  // Auto-approve (under threshold or free)
  return completeSignupFlow(task, {
    merchant,
    toolKey,
    toolDisplayName,
    cb,
  });
}

// ---------------------------------------------------------------------------
// Signup flow — finalize (wallet debit → TinyFish completes signup → register)
// ---------------------------------------------------------------------------

export async function completeSignupFlow(
  task: AgentTask,
  params: {
    merchant: string;
    toolKey?: string | null;
    toolDisplayName?: string | null;
    cb: AgentCallbacks;
  },
): Promise<AgentTask> {
  const { merchant, cb } = params;
  const plan = task.signupPlan || 'Standard';
  const price = task.signupPrice ?? 0;
  const billingCycle = task.signupBillingCycle || 'monthly';
  const previousBalance = cb.getWallet().balance;
  const priorFailureCode = task.failure?.code;

  task.taskState = 'executing';
  task.failure = null;
  cb.addMessage(msg('assistant', `Processing payment and finalizing ${merchant} signup...`, 'thinking'));

  const failWithBlocker = (blocker: SignupFlowBlocker): AgentTask => {
    applySignupFailure(task, blocker);
    task.taskState = 'failed';
    task.status = 'cancelled';
    cb.addMessage(msg(
      'assistant',
      `Action required: ${blocker.userMessage}`,
    ));
    cb.addMessage(msg(
      'assistant',
      'Structured failure recorded.',
      'agent-log',
      {
        steps: [],
        payload: {
          failure: task.failure,
          execution: task.signupExecution || null,
        },
      } as AgentLogData,
    ));
    return task;
  };

  const safety = evaluateSignupSafety({
    merchant,
    currency: cb.getWallet().currency,
    antiBotRisk: inferAntiBotRiskFromBlocker(priorFailureCode),
    knownRefundReliability: 'UNKNOWN',
    accountStatus: 'UNKNOWN',
    accountCreationRequired: true,
    serviceProvisioningConfidence: inferProvisioningConfidence(merchant),
    activationVerificationMethods: ['POST_PURCHASE_ACCOUNT_STATE_CHECK'],
    reserveOnlySupported: true,
  });

  setSignupExecution(task, {
    compatibility: safety.compatibility as unknown as Record<string, unknown>,
    riskGate: safety.risk as unknown as Record<string, unknown>,
  });

  if (!safety.allowed && safety.blocker) {
    return failWithBlocker(safety.blocker);
  }

  let paymentFlow: walletService.TwoPhasePaymentFlow | null = null;

  if (price > 0) {
    const latestWallet = cb.getWallet();
    const check = walletService.canSpendSnapshot(latestWallet, price, merchant, { ignoreBalance: true });
    if (!check.allowed) {
      return failWithBlocker({
        code: WalletFailureCode.POLICY_BLOCKED,
        stage: 'pre_charge_risk',
        message: check.reason || 'Payment blocked by wallet guardrails.',
        userMessage: check.reason || 'Payment blocked by wallet guardrails.',
        blockedReasons: [check.reason || 'Payment blocked by wallet guardrails'],
        recoverable: true,
        details: {
          amount: price,
          merchant,
        },
      });
    }

    try {
      const authorization = await walletService.authorizeSubscriptionPayment({
        merchant,
        amount: price,
        currency: latestWallet.currency,
        taskId: task.id,
        idempotencyKey: `${task.id}:authorize`,
        allowPrepaidFallback: true,
        requiresActivationVerification: true,
        metadata: {
          signup_plan: plan,
          signup_billing_cycle: billingCycle,
          compatibility_tier: safety.compatibility.compatibilityTier,
          compatibility_decision_id: safety.compatibility.decisionId,
          risk_decision_id: safety.risk.decisionId,
          risk_score: safety.risk.score.overallScore,
          risk_decision: safety.risk.decision,
          blocker_code: null,
        },
      });

      paymentFlow = authorization.payment;
      setSignupExecution(task, {
        payment: {
          paymentFlowId: paymentFlow.id,
          fundingMode: paymentFlow.fundingMode,
          authorizationStatus: paymentFlow.status,
          authorizedAt: paymentFlow.authorizedAt,
          capturedAt: paymentFlow.capturedAt,
          refundedAt: paymentFlow.refundedAt,
        },
      });
    } catch (error) {
      const mapped = mapErrorToFailure({
        message: error instanceof Error ? error.message : 'Payment authorization failed.',
        source: FailureSource.PAYMENT_PROCESSOR,
        merchant,
        stage: 'payment',
        paymentStatus: 'failed',
        activationStatus: 'UNKNOWN',
      });
      return failWithBlocker({
        code: mapped.code,
        stage: 'pre_charge_risk',
        message: mapped.message,
        userMessage: mapped.userMessage,
        blockedReasons: [mapped.detectionReason],
        recoverable: mapped.recoverable,
        details: {
          confidence: mapped.confidence,
          detectionReason: mapped.detectionReason,
        },
      });
    }
  }

  // Finalize signup via TinyFish (credentials stored server-side in Vault).
  let finalResult: Awaited<ReturnType<typeof tinyfish.finalizeSignup>>;
  try {
    finalResult = await tinyfish.finalizeSignup({
      service: merchant,
      taskId: task.id,
    });
  } catch (error) {
    if (paymentFlow) {
      await walletService.voidSubscriptionPayment({
        paymentId: paymentFlow.id,
        idempotencyKey: `${task.id}:void:finalize_error`,
        reason: 'signup_finalization_call_failed',
      }).catch(() => undefined);
    }
    const mapped = mapErrorToFailure({
      message: error instanceof Error ? error.message : 'Signup finalization failed.',
      source: FailureSource.MERCHANT,
      merchant,
      stage: 'signup',
      paymentStatus: paymentFlow ? paymentFlow.status : 'unknown',
      activationStatus: 'UNKNOWN',
    });
    return failWithBlocker({
      code: mapped.code,
      stage: 'compatibility',
      message: mapped.message,
      userMessage: mapped.userMessage,
      blockedReasons: [mapped.detectionReason],
      recoverable: mapped.recoverable,
      details: {
        confidence: mapped.confidence,
        detectionReason: mapped.detectionReason,
      },
    });
  }

  task.steps.push(...finalResult.steps);

  if (!finalResult.success) {
    if (paymentFlow) {
      await walletService.voidSubscriptionPayment({
        paymentId: paymentFlow.id,
        idempotencyKey: `${task.id}:void:finalize_failed`,
        reason: finalResult.blocker?.message || finalResult.failure?.message || 'signup_finalization_failed',
      }).catch(() => undefined);
    }

    const mapped = mapErrorToFailure({
      message: finalResult.blocker?.message || finalResult.failure?.message || 'Signup finalization failed.',
      source: FailureSource.MERCHANT,
      merchant,
      stage: 'signup',
      paymentStatus: paymentFlow ? paymentFlow.status : 'unknown',
      activationStatus: 'UNKNOWN',
      metadata: {
        tinyfish_blocker_code: finalResult.blocker?.code || finalResult.failure?.code || null,
      },
    });
    return failWithBlocker({
      code: mapped.code,
      stage: 'compatibility',
      message: mapped.message,
      userMessage: mapped.userMessage,
      blockedReasons: [mapped.detectionReason],
      recoverable: mapped.recoverable,
      details: {
        tinyfishBlockerCode: finalResult.blocker?.code || finalResult.failure?.code || null,
        confidence: mapped.confidence,
        detectionReason: mapped.detectionReason,
      },
    });
  }

  cb.addMessage(msg('assistant', 'Signup finalized. Running activation verification...', 'agent-log', {
    steps: finalResult.steps,
  } as AgentLogData));

  const activation = await runSignupActivationVerification({
    userId: `wallet:${paymentFlow?.id || task.id}`,
    merchant,
    taskId: task.id,
    paymentFlowId: paymentFlow?.id || `signup_${task.id}`,
    authorizedAt: paymentFlow?.authorizedAt || new Date().toISOString(),
    expectedToolId: finalResult.toolId || undefined,
  });

  setSignupExecution(task, {
    activation: {
      status: activation.activationStatus,
      verifiedAt: activation.verifiedAt,
      settlementRecommendation: activation.settlementRecommendation,
      nextAction: activation.nextAction,
      evidenceCount: activation.evidence.length,
      evidence: activation.evidence,
      toolId: activation.tool?.id || finalResult.toolId || null,
    },
  });

  const firstActivationSummary = (() => {
    const first = activation.evidence[0];
    if (!first) return undefined;
    return typeof first.summary === 'string' ? first.summary : undefined;
  })();
  const activationReasonList = activation.evidence
    .map((item) => (typeof item.summary === 'string' ? item.summary : null))
    .filter((item): item is string => Boolean(item));

  if (paymentFlow && price > 0) {
    try {
      const capture = await walletService.captureSubscriptionPayment({
        paymentId: paymentFlow.id,
        idempotencyKey: `${task.id}:capture`,
        activationVerified: activation.activationStatus === 'ACTIVE',
        activationEvidence: {
          activationStatus: activation.activationStatus,
          evidence: activation.evidence,
          blocker_code: activation.activationStatus === 'ACTIVE' ? null : WalletFailureCode.ACTIVATION_UNVERIFIED,
          risk_score: (task.signupExecution?.riskGate as { score?: { overallScore?: number } })?.score?.overallScore ?? null,
        },
        activationFailureReason: activation.activationStatus === 'ACTIVE'
          ? undefined
          : firstActivationSummary || 'Activation could not be verified',
      });
      paymentFlow = capture.payment;
      setSignupExecution(task, {
        payment: {
          paymentFlowId: paymentFlow.id,
          fundingMode: paymentFlow.fundingMode,
          authorizationStatus: paymentFlow.status,
          captureStatus: paymentFlow.status,
          authorizedAt: paymentFlow.authorizedAt,
          capturedAt: paymentFlow.capturedAt,
          refundedAt: paymentFlow.refundedAt,
          retryScheduled: capture.retryScheduled,
          nextRetryAt: capture.nextRetryAt,
        },
      });
    } catch (error) {
      const mapped = mapErrorToFailure({
        message: error instanceof Error ? error.message : 'Payment capture failed',
        source: FailureSource.PAYMENT_PROCESSOR,
        merchant,
        stage: 'payment',
        paymentStatus: paymentFlow.status,
        activationStatus: activation.activationStatus,
      });
      return failWithBlocker({
        code: mapped.code,
        stage: 'pre_charge_risk',
        message: mapped.message,
        userMessage: mapped.userMessage,
        blockedReasons: [mapped.detectionReason],
        recoverable: mapped.recoverable,
        details: {
          confidence: mapped.confidence,
          detectionReason: mapped.detectionReason,
        },
      });
    }
  }

  if (activation.activationStatus !== 'ACTIVE') {
    let finalBlockerCode = WalletFailureCode.ACTIVATION_UNVERIFIED;
    if (paymentFlow?.status === 'captured') {
      finalBlockerCode = WalletFailureCode.PAYMENT_CAPTURED_ACTIVATION_FAILED;
      try {
        const refund = await walletService.initiateRefundWorkflow({
          paymentFlowId: paymentFlow.id,
          idempotencyKey: `${task.id}:refund:auto`,
          activationFailureReason: firstActivationSummary || 'Activation verification failed post-capture',
          activationEvidence: {
            activationStatus: activation.activationStatus,
            evidence: activation.evidence,
            blocker_code: WalletFailureCode.PAYMENT_CAPTURED_ACTIVATION_FAILED,
          },
          allowWithoutActivationFailure: true,
        });
        setSignupExecution(task, {
          refund: {
            initiated: true,
            refundCaseId: refund.refundCase.id,
            status: refund.refundCase.status,
            userExplanation: refund.userExplanation,
          },
        });
        cb.addMessage(msg('assistant', refund.userExplanation || 'Refund workflow initiated automatically.'));
      } catch (refundError) {
        setSignupExecution(task, {
          refund: {
            initiated: false,
            status: 'failed',
            userExplanation: refundError instanceof Error ? refundError.message : 'Refund initiation failed',
          },
        });
        cb.addMessage(msg('assistant', 'Automatic refund initiation failed. Support review is required.'));
      }
    }

    return failWithBlocker({
      code: finalBlockerCode,
      stage: 'pre_charge_risk',
      message: firstActivationSummary || 'Activation verification failed.',
      userMessage: firstActivationSummary || 'Activation verification failed.',
      blockedReasons: activationReasonList.length > 0 ? activationReasonList : ['activation_evidence'],
      recoverable: true,
      details: {
        activationStatus: activation.activationStatus,
        settlementRecommendation: activation.settlementRecommendation,
        paymentStatus: paymentFlow?.status || 'none',
      },
    });
  }

  if (price > 0 && paymentFlow && paymentFlow.status !== 'captured') {
    return failWithBlocker({
      code: WalletFailureCode.PAYMENT_AUTHORIZATION_FAILED,
      stage: 'pre_charge_risk',
      message: `Payment flow ended in status ${paymentFlow.status} before capture.`,
      userMessage: `Payment capture is not complete (status: ${paymentFlow.status}).`,
      blockedReasons: [`Payment status ${paymentFlow.status}`],
      recoverable: true,
      details: {
        paymentFlowId: paymentFlow.id,
        paymentStatus: paymentFlow.status,
      },
    });
  }

  // Emit signup summary (no raw credentials — only masked info from server)
  const summaryData: SignupSummaryData = {
    merchant,
    plan,
    price,
    billingCycle,
    loginIdentifierMasked: finalResult.loginIdentifierMasked || '••••',
    toolId: activation.tool?.id || finalResult.toolId || null,
    subscriptionAdded: Boolean(finalResult.subscriptionAdded || activation.tool),
    status: 'complete',
  };

  cb.addMessage(msg('assistant', `${merchant} signup complete.`, 'signup-summary', summaryData));

  if (price > 0 && paymentFlow?.fundingMode === 'PREPAID_BALANCE') {
    await cb.refreshWallet();
    const newBalance = cb.getWallet().balance;
    cb.addMessage(msg('assistant', 'Wallet updated.', 'receipt', {
      merchant,
      item: `${plan} — ${billingCycle}`,
      amount: price,
      previousBalance,
      newBalance,
      transactionId: paymentFlow?.id || task.id,
    } as ReceiptData));
  } else if (price > 0) {
    cb.addMessage(msg('assistant', `Payment captured successfully for ${merchant}.`));
  }

  task.failure = null;
  setSignupExecution(task, { blocker: null });
  task.taskState = 'completed';
  task.status = 'completed';
  task.completedAt = new Date().toISOString();
  return task;
}
