import { randomUUID } from 'node:crypto';
import type { Recipient } from '@/lib/types';
import {
  checkGuardrails,
  getLatestPendingAgentTask,
  getUserAutofillProfile,
  getWallet,
  recordAgentTask,
  resolveRecipientByName,
  supersedePendingAgentTask,
  upsertRecipientDelivery,
  upsertUserAutofillProfile,
} from '@/lib/server/ledger';
import {
  listToolsCatalog,
  reconnectToolForUser,
  resolveRuntimeCredentialReference,
  resolveToolForAction,
} from '@/lib/server/toolsVault';
import { parseAgentIntent, type AgentIntent } from '@/lib/server/agentIntent';
import { runProcurementPurchasePreparation } from '@/lib/server/procurementApprovalRunner';
import { listActiveSubscriptions } from '@/lib/server/subscriptions';

export type AgentRoute =
  | 'clarification'
  | 'send_money_approval'
  | 'procurement_task'
  | 'signup_and_prepare_checkout'
  | 'fund_wallet'
  | 'review_spend'
  | 'cancel_subscription';

export interface AgentOrchestrationResult {
  route: AgentRoute;
  taskId: string;
  status: 'awaiting_clarification' | 'awaiting_approval' | 'ready' | 'blocked';
  intent: AgentIntent;
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
}

type CatalogTool = Awaited<ReturnType<typeof listToolsCatalog>>[number];

function normalizeToolKeyText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textHasToken(text: string, token: string): boolean {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) return false;
  const pattern = `(?:^|[^a-z0-9])${escapeRegex(trimmed)}(?:$|[^a-z0-9])`;
  return new RegExp(pattern, 'i').test(text.toLowerCase());
}

function detectToolRequestMode(message: string): 'login' | 'signup' | null {
  const lower = message.toLowerCase();
  const signup = /\b(sign\s*up|signup|register|create\s+account|subscribe\s+to|subscribe\s+for|enroll\s+in)\b/.test(lower);
  const login = /\b(log\s*into|log\s*in|login|sign\s*into|sign\s*in|reconnect|saved\s+login|use\s+my\s+saved)\b/.test(lower);
  if (signup) return 'signup';
  if (login) return 'login';
  return null;
}

function isReconnectRequest(message: string): boolean {
  return /\breconnect\b/i.test(message);
}

function findCatalogToolByName(
  tools: CatalogTool[],
  merchant: string | null | undefined,
): CatalogTool | null {
  if (!merchant) return null;
  const target = merchant.trim().toLowerCase();
  if (!target) return null;

  const normalizedTarget = normalizeToolKeyText(target);
  const exact = tools.find((tool) => (
    tool.key === normalizedTarget
    || tool.displayName.toLowerCase() === target
  ));
  if (exact) return exact;

  return tools.find((tool) => (
    target.includes(tool.displayName.toLowerCase())
    || tool.displayName.toLowerCase().includes(target)
    || target.includes(tool.key.replace(/_/g, ' '))
    || tool.key.includes(normalizedTarget)
  )) || null;
}

function detectRequestedCatalogTool(params: {
  message: string;
  merchant: string | null | undefined;
  tools: CatalogTool[];
}): CatalogTool | null {
  const byMerchant = findCatalogToolByName(params.tools, params.merchant);
  if (byMerchant) return byMerchant;

  const lower = params.message.toLowerCase();
  for (const tool of params.tools) {
    const keySpace = tool.key.replace(/_/g, ' ');
    if (
      textHasToken(lower, tool.displayName)
      || textHasToken(lower, tool.key)
      || textHasToken(lower, keySpace)
    ) {
      return tool;
    }
  }

  return null;
}

function isSimpleAffirmation(message: string): boolean {
  return /^(yes|y|ok|okay|sure|continue|proceed)$/i.test(message.trim());
}

function extractCredentialSubmission(message: string, allowRawMessage: boolean): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (isSimpleAffirmation(trimmed)) return null;

  const labeled = trimmed.match(
    /\b(?:password|passcode|credential|token|api\s*key|secret)\b\s*(?:is|=|:)?\s*(.+)$/i,
  );
  if (labeled?.[1]) {
    const credential = labeled[1].trim();
    return credential || null;
  }

  return allowRawMessage ? trimmed : null;
}

function extractLoginIdentifierFromMessage(message: string): string | null {
  const email = message.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (email?.[0]) return email[0].trim();

  const username = message.match(/\b(?:username|user|login)\s*(?:is|=|:)\s*([^\s,;]+)/i);
  if (username?.[1]) return username[1].trim();

  return null;
}

function sumSucceededDebitsSince(
  transactions: Array<{ amount: number; direction: string; status: string; createdAt: string }>,
  sinceMs: number,
): number {
  return transactions.reduce((total, tx) => {
    if (tx.direction !== 'debit' || tx.status !== 'succeeded') return total;
    const createdAtMs = Date.parse(tx.createdAt);
    if (Number.isNaN(createdAtMs) || createdAtMs < sinceMs) return total;
    return total + tx.amount;
  }, 0);
}

function startOfDayMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function startOfMonthMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function recipientListLabel(recipients: Recipient[]): string {
  return recipients.slice(0, 8).map((recipient) => recipient.name).join(', ');
}

function isEphemeralReasoningIntent(intent: AgentIntent['intent']): boolean {
  return intent === 'compare_and_buy' || intent === 'procurement_task';
}

function messageLooksLikeNewReasoningTask(message: string): boolean {
  const lower = message.toLowerCase();
  const reasoningCue = /\b(compare|versus|vs\.?|which is better|what is better|better for|choose between|best|find me|recommend)\b/.test(lower);
  const domainCue = /\b(app|tool|software|platform|service|vendor|solution|crm|note[\s-]?taking|outreach|email|subscription)\b/.test(lower);
  return reasoningCue && domainCue;
}

function messageLooksLikeSendMoneyClarification(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (!lower) return false;
  if (/\b(acct_[a-z0-9]+|cash\s*app|cashtag|stripe|ach|wire|bank\s+reference|routing\s+number|account\s+number|account\s+ending)\b/.test(lower)) return true;
  if (/\$[a-z][a-z0-9_]{1,}/i.test(message)) return true;
  if (/^(yes|y|ok|okay|sure|proceed|continue)$/i.test(lower)) return true;
  if (lower.split(/\s+/).length <= 8 && !messageLooksLikeNewReasoningTask(lower)) return true;
  return false;
}

function messageLooksLikeProcurementClarification(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (!lower) return false;
  if (/^(yes|y|no|n|ok|okay|continue|go ahead)$/i.test(lower)) return true;
  if (/\bunder\b|\bbudget\b|\$\s*\d+|\bmonthly\b|\byearly\b|\bper\s+month\b/.test(lower)) return true;
  if (/\b(vs\.?|versus|between)\b/.test(lower)) return true;
  return false;
}

function messageLooksLikeStandaloneTask(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (!lower) return false;
  if (messageLooksLikeNewReasoningTask(lower)) return true;
  if (/\b(log\s*into|log\s*in|login|sign\s*into|sign\s*in|reconnect|saved\s+login|use\s+my\s+saved)\b/.test(lower)) return true;
  return /^(what('?s)?|which|find|buy|cancel|compare|show|list|review|fund|top\s*up|recommend|help)\b/.test(lower)
    || /\b(cancel|unsubscribe|buy|purchase|compare|find me|top up|balance|history)\b/.test(lower);
}

function classifyPendingTaskMessage(params: {
  pending: {
    taskType: string;
    status: string;
  };
  message: string;
}): 'continuation_of_pending_task' | 'new_task' {
  const lower = params.message.trim().toLowerCase();
  if (!lower) return 'continuation_of_pending_task';

  const sendClarification = messageLooksLikeSendMoneyClarification(params.message);
  const procurementClarification = messageLooksLikeProcurementClarification(params.message);
  const standaloneTask = messageLooksLikeStandaloneTask(params.message);
  const yesNo = /^(yes|y|no|n|ok|okay|sure|proceed|continue)$/i.test(lower);

  switch (params.pending.taskType) {
    case 'send_money':
      if (sendClarification) return 'continuation_of_pending_task';
      if (standaloneTask) return 'new_task';
      return params.pending.status === 'awaiting_approval' && yesNo
        ? 'continuation_of_pending_task'
        : 'new_task';
    case 'procurement_task':
    case 'compare_and_buy':
      if (sendClarification) return 'new_task';
      if (procurementClarification) return 'continuation_of_pending_task';
      return standaloneTask ? 'new_task' : 'new_task';
    case 'fund_wallet':
      if (/\$?\d+/.test(lower) || yesNo) return 'continuation_of_pending_task';
      return standaloneTask ? 'new_task' : 'new_task';
    default:
      if (standaloneTask) return 'new_task';
      return 'continuation_of_pending_task';
  }
}

function formatTaskTypeLabel(taskType: string): string {
  return taskType.replace(/_/g, ' ');
}

function mergeIntentWithPending(
  intent: AgentIntent,
  message: string,
  pendingInput?: Record<string, unknown>,
  pendingTaskType?: string,
  pendingStatus?: string,
): AgentIntent {
  if (!pendingInput) return intent;

  const previousAmount = typeof pendingInput.amount === 'number' ? pendingInput.amount : null;
  const previousRecipient = typeof pendingInput.recipient_name === 'string'
    ? pendingInput.recipient_name
    : null;
  const previousMerchant = typeof pendingInput.merchant === 'string'
    ? pendingInput.merchant
    : null;
  const previousBudget = typeof pendingInput.budget_limit === 'number'
    ? pendingInput.budget_limit
    : null;
  const previousNormalizedGoal = typeof pendingInput.normalized_goal === 'string'
    ? pendingInput.normalized_goal
    : null;
  const previousCategory = typeof pendingInput.category === 'string'
    ? pendingInput.category
    : null;
  const previousScopeLocked = pendingInput.scope_locked === true;
  const previousCandidateVendors = Array.isArray(pendingInput.candidate_vendors)
    ? pendingInput.candidate_vendors
      .map((vendor) => (typeof vendor === 'string' ? vendor.trim() : ''))
      .filter((vendor): vendor is string => Boolean(vendor))
    : [];
  const previousStripeAccount = typeof pendingInput.recipient_stripe_account_id === 'string'
    ? pendingInput.recipient_stripe_account_id
    : null;
  const previousDeliveryMethod = pendingInput.delivery_method === 'cash_app'
    || pendingInput.delivery_method === 'stripe_connected'
    || pendingInput.delivery_method === 'bank'
    ? pendingInput.delivery_method
    : null;
  const previousCashAppCashtag = typeof pendingInput.cash_app_cashtag === 'string'
    ? pendingInput.cash_app_cashtag
    : null;
  const previousBankReference = typeof pendingInput.bank_reference === 'string'
    ? pendingInput.bank_reference
    : null;
  const previousFundingSource = typeof pendingInput.funding_source === 'string'
    ? pendingInput.funding_source
    : null;
  const previousRequiredProfileFields = Array.isArray(pendingInput.required_profile_fields)
    ? pendingInput.required_profile_fields.filter((field): field is AgentIntent['required_profile_fields'][number] => {
      return typeof field === 'string';
    })
    : [];
  const previousIntent = typeof pendingInput.intent === 'string'
    ? pendingInput.intent
    : null;
  const pendingIntent = previousIntent && (
    previousIntent === 'send_money'
    || previousIntent === 'compare_and_buy'
    || previousIntent === 'signup_and_prepare_checkout'
    || previousIntent === 'procurement_task'
    || previousIntent === 'fund_wallet'
    || previousIntent === 'review_spend'
    || previousIntent === 'cancel_subscription'
  )
    ? previousIntent
    : null;
  const parsedIntentIsReasoning = isEphemeralReasoningIntent(intent.intent);
  const treatAsNewReasoningTask = parsedIntentIsReasoning && messageLooksLikeNewReasoningTask(message);

  const shouldForcePendingSendIntent = pendingTaskType === 'send_money'
    && pendingStatus === 'awaiting_clarification'
    && messageLooksLikeSendMoneyClarification(message)
    && !treatAsNewReasoningTask;
  const shouldPreservePendingIntent = pendingStatus === 'awaiting_clarification'
    && intent.confidence < 0.7
    && Boolean(pendingIntent)
    && !treatAsNewReasoningTask
    && !parsedIntentIsReasoning;
  const resolvedIntent = shouldForcePendingSendIntent
    ? 'send_money'
    : intent.intent === 'send_money'
    ? 'send_money'
    : (shouldPreservePendingIntent && pendingIntent
      ? pendingIntent
      : intent.intent);
  const sameIntentFamily = pendingIntent === resolvedIntent;
  const mergeTransferFields = resolvedIntent === 'send_money';
  const mergeFundFields = resolvedIntent === 'fund_wallet';
  const mergeMerchantFields = resolvedIntent === 'signup_and_prepare_checkout'
    || resolvedIntent === 'cancel_subscription';
  const mergeBudgetFields = resolvedIntent === 'procurement_task' || resolvedIntent === 'compare_and_buy';

  return {
    ...intent,
    intent: (pendingTaskType === 'signup_and_prepare_checkout' && resolvedIntent === 'procurement_task')
      ? 'signup_and_prepare_checkout'
      : (resolvedIntent as AgentIntent['intent']),
    amount: (mergeTransferFields || mergeFundFields)
      ? (intent.amount ?? (sameIntentFamily ? previousAmount : null))
      : intent.amount,
    recipient_name: mergeTransferFields
      ? (intent.recipient_name ?? (sameIntentFamily ? previousRecipient : null))
      : intent.recipient_name,
    merchant: mergeMerchantFields
      ? (intent.merchant ?? (sameIntentFamily ? previousMerchant : null))
      : intent.merchant,
    budget_limit: mergeBudgetFields
      ? (intent.budget_limit ?? (sameIntentFamily ? previousBudget : null))
      : intent.budget_limit,
    normalized_goal: mergeBudgetFields
      ? (intent.normalized_goal ?? (sameIntentFamily ? previousNormalizedGoal : null))
      : intent.normalized_goal,
    category: mergeBudgetFields
      ? (intent.category ?? (sameIntentFamily ? previousCategory : null))
      : intent.category,
    scope_locked: mergeBudgetFields
      ? (intent.scope_locked || (sameIntentFamily ? previousScopeLocked : false))
      : intent.scope_locked,
    candidate_vendors: mergeBudgetFields
      ? (intent.candidate_vendors.length > 0
        ? intent.candidate_vendors
        : (sameIntentFamily ? previousCandidateVendors : []))
      : intent.candidate_vendors,
    recipient_stripe_account_id: mergeTransferFields
      ? (intent.recipient_stripe_account_id ?? (sameIntentFamily ? previousStripeAccount : null))
      : intent.recipient_stripe_account_id,
    delivery_method: mergeTransferFields
      ? (intent.delivery_method ?? (sameIntentFamily ? previousDeliveryMethod : null))
      : intent.delivery_method,
    cash_app_cashtag: mergeTransferFields
      ? (intent.cash_app_cashtag ?? (sameIntentFamily ? previousCashAppCashtag : null))
      : intent.cash_app_cashtag,
    bank_reference: mergeTransferFields
      ? (intent.bank_reference ?? (sameIntentFamily ? previousBankReference : null))
      : intent.bank_reference,
    funding_source: mergeTransferFields
      ? (intent.funding_source ?? (sameIntentFamily ? previousFundingSource : null))
      : intent.funding_source,
    required_profile_fields: intent.required_profile_fields.length > 0
      ? intent.required_profile_fields
      : (sameIntentFamily ? previousRequiredProfileFields : intent.required_profile_fields),
  };
}

function extractStripeAccountIdFromMessage(message: string): string | null {
  const matched = message.match(/\bacct_[A-Za-z0-9]+\b/);
  return matched?.[0] || null;
}

function normalizeCashtag(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\$[A-Za-z][A-Za-z0-9_]{1,}$/.test(trimmed) ? trimmed : null;
}

function normalizeBankReference(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length >= 2 ? trimmed : null;
}

function deliveryMethodQuestion(recipientName: string): string {
  return `I don't have ${recipientName} saved yet. How should I send it — Cash App, Stripe recipient, or bank?`;
}

type AutofillField =
  | 'full_name'
  | 'email'
  | 'phone'
  | 'company_name'
  | 'billing_name'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'state_region'
  | 'postal_code'
  | 'country';

const DEFAULT_SIGNUP_FIELDS: AutofillField[] = ['full_name', 'email'];

function normalizeRequiredProfileFields(fields: string[]): AutofillField[] {
  const supported: AutofillField[] = [
    'full_name',
    'email',
    'phone',
    'company_name',
    'billing_name',
    'address_line1',
    'address_line2',
    'city',
    'state_region',
    'postal_code',
    'country',
  ];

  const unique = new Set<AutofillField>();
  fields.forEach((field) => {
    if (supported.includes(field as AutofillField)) {
      unique.add(field as AutofillField);
    }
  });

  if (unique.size === 0) {
    DEFAULT_SIGNUP_FIELDS.forEach((field) => unique.add(field));
  }

  return [...unique];
}

function friendlyProfileFieldName(field: AutofillField): string {
  return field.replace(/_/g, ' ');
}

async function persistAgentTask(params: {
  userId: string;
  taskId: string;
  taskType: string;
  intent: string;
  status: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
}): Promise<string> {
  return recordAgentTask({
    userId: params.userId,
    taskId: params.taskId,
    taskType: params.taskType,
    intent: params.intent,
    status: params.status,
    input: params.input,
    result: params.result,
    error: params.error,
  });
}

function getMissingProfileFields(
  requiredFields: AutofillField[],
  profile: Awaited<ReturnType<typeof getUserAutofillProfile>>,
): AutofillField[] {
  if (!profile) return requiredFields;

  return requiredFields.filter((field) => {
    switch (field) {
      case 'full_name': return !profile.fullName;
      case 'email': return !profile.email;
      case 'phone': return !profile.phone;
      case 'company_name': return !profile.companyName;
      case 'billing_name': return !profile.billingName;
      case 'address_line1': return !profile.addressLine1;
      case 'address_line2': return !profile.addressLine2;
      case 'city': return !profile.city;
      case 'state_region': return !profile.stateRegion;
      case 'postal_code': return !profile.postalCode;
      case 'country': return !profile.country;
      default: return true;
    }
  });
}

export async function orchestrateAgentMessage(params: {
  userId: string;
  message: string;
}): Promise<AgentOrchestrationResult> {
  const wallet = await getWallet(params.userId);
  const pending = await getLatestPendingAgentTask({ userId: params.userId });
  let activePending = pending;
  let supersededNotice: string | null = null;

  if (pending) {
    const classification = classifyPendingTaskMessage({
      pending: {
        taskType: pending.taskType,
        status: pending.status,
      },
      message: params.message,
    });

    if (classification === 'new_task') {
      await supersedePendingAgentTask({
        userId: params.userId,
        taskId: pending.id,
        reason: `Superseded by new user request: ${params.message.slice(0, 180)}`,
      });
      supersededNotice = `I paused your previous ${formatTaskTypeLabel(pending.taskType)} task.`;
      activePending = null;
    }
  }

  const context = activePending
    ? `Pending task: type=${activePending.taskType} status=${activePending.status} input=${JSON.stringify(activePending.input || {})}`
    : undefined;

  const parsedIntent = await parseAgentIntent(params.message, { context });
  const intent = mergeIntentWithPending(parsedIntent, params.message, activePending?.input, activePending?.taskType, activePending?.status);
  const toolRequestMode = detectToolRequestMode(params.message);
  const catalogTools = await listToolsCatalog().catch(() => []);
  const requestedCatalogTool = detectRequestedCatalogTool({
    message: params.message,
    merchant: intent.merchant,
    tools: catalogTools,
  });
  if (!intent.merchant && requestedCatalogTool) {
    intent.merchant = requestedCatalogTool.displayName;
  }
  if (
    requestedCatalogTool
    && (toolRequestMode === 'login' || toolRequestMode === 'signup')
    && intent.intent !== 'send_money'
    && intent.intent !== 'fund_wallet'
    && intent.intent !== 'cancel_subscription'
  ) {
    intent.intent = 'signup_and_prepare_checkout';
  }
  const taskId = activePending?.id || randomUUID();
  const composeMessage = (message: string): string => supersededNotice ? `${supersededNotice} ${message}` : message;
  const messageStripeAccountId = extractStripeAccountIdFromMessage(params.message);
  if (!intent.recipient_stripe_account_id && messageStripeAccountId) {
    intent.recipient_stripe_account_id = messageStripeAccountId;
  }

  if (intent.intent === 'send_money') {
    if (intent.amount === null || intent.amount <= 0) {
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'send_money',
        intent: params.message,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question: 'How much should I send?',
          missingFields: ['amount'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: composeMessage('How much should I send?'),
        missingFields: ['amount'],
      };
    }

    if (!intent.recipient_name) {
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'send_money',
        intent: params.message,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question: 'Who should receive the money?',
          missingFields: ['recipient_name'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: composeMessage('Who should receive the money?'),
        missingFields: ['recipient_name'],
      };
    }

    let resolvedRecipient = await resolveRecipientByName(params.userId, intent.recipient_name);
    if (resolvedRecipient) {
      intent.delivery_method = intent.delivery_method ?? resolvedRecipient.sendMethod;
      intent.recipient_stripe_account_id = intent.recipient_stripe_account_id ?? resolvedRecipient.stripeAccountId ?? null;
      intent.cash_app_cashtag = intent.cash_app_cashtag ?? resolvedRecipient.cashAppCashtag ?? null;
      intent.bank_reference = intent.bank_reference ?? resolvedRecipient.bankReference ?? null;
    }

    const normalizedCashtag = normalizeCashtag(intent.cash_app_cashtag);
    if (normalizedCashtag) {
      intent.cash_app_cashtag = normalizedCashtag;
      intent.delivery_method = 'cash_app';
    }

    const normalizedBankReference = normalizeBankReference(intent.bank_reference);
    if (normalizedBankReference) {
      intent.bank_reference = normalizedBankReference;
      intent.delivery_method = intent.delivery_method || 'bank';
    }

    if (intent.recipient_stripe_account_id) {
      intent.delivery_method = intent.delivery_method || 'stripe_connected';
    }

    const resolvedMethod = intent.delivery_method ?? resolvedRecipient?.sendMethod ?? null;
    if (resolvedMethod) {
      intent.delivery_method = resolvedMethod;
    }

    const resolvedStripeAccountId = intent.recipient_stripe_account_id ?? resolvedRecipient?.stripeAccountId ?? null;
    const resolvedCashAppCashtag = normalizeCashtag(intent.cash_app_cashtag ?? resolvedRecipient?.cashAppCashtag ?? null);
    const resolvedBankReference = normalizeBankReference(intent.bank_reference ?? resolvedRecipient?.bankReference ?? null);

    if (!resolvedRecipient && !resolvedMethod) {
      const question = deliveryMethodQuestion(intent.recipient_name);

      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'send_money',
        intent: params.message,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question,
          missingFields: ['recipient_delivery_method'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: composeMessage(question),
        missingFields: ['recipient_delivery_method'],
      };
    }

    if (resolvedMethod === 'cash_app' && !resolvedCashAppCashtag) {
      const question = resolvedRecipient
        ? `I have ${resolvedRecipient.name}, but I still need their Cash App cashtag to send $${intent.amount.toFixed(2)}.`
        : `I can send $${intent.amount.toFixed(2)} to ${intent.recipient_name} on Cash App, but I need their Cash App cashtag.`;

      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'send_money',
        intent: params.message,
        status: 'awaiting_clarification',
        input: {
          ...intent,
          delivery_method: 'cash_app',
        },
        result: {
          question,
          missingFields: ['cash_app_cashtag'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent: {
          ...intent,
          delivery_method: 'cash_app',
        },
        message: composeMessage(question),
        missingFields: ['cash_app_cashtag'],
      };
    }

    if (resolvedMethod === 'stripe_connected' && !resolvedStripeAccountId) {
      const question = resolvedRecipient
        ? `I can send $${intent.amount.toFixed(2)} to ${resolvedRecipient.name}, but I need the Stripe-connected recipient account (starts with acct_).`
        : `I can send $${intent.amount.toFixed(2)} to ${intent.recipient_name}, but I need the Stripe-connected recipient account (starts with acct_).`;

      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'send_money',
        intent: params.message,
        status: 'awaiting_clarification',
        input: {
          ...intent,
          delivery_method: 'stripe_connected',
        },
        result: {
          question,
          missingFields: ['recipient_stripe_account_id'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent: {
          ...intent,
          delivery_method: 'stripe_connected',
        },
        message: composeMessage(question),
        missingFields: ['recipient_stripe_account_id'],
      };
    }

    if (resolvedMethod === 'bank' && !resolvedBankReference) {
      const question = resolvedRecipient
        ? `I can send $${intent.amount.toFixed(2)} to ${resolvedRecipient.name}, but I need the bank reference.`
        : `I can send $${intent.amount.toFixed(2)} to ${intent.recipient_name}, but I need the bank reference.`;

      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'send_money',
        intent: params.message,
        status: 'awaiting_clarification',
        input: {
          ...intent,
          delivery_method: 'bank',
        },
        result: {
          question,
          missingFields: ['bank_reference'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent: {
          ...intent,
          delivery_method: 'bank',
        },
        message: composeMessage(question),
        missingFields: ['bank_reference'],
      };
    }

    if (!resolvedRecipient && resolvedMethod) {
      resolvedRecipient = await upsertRecipientDelivery({
        userId: params.userId,
        name: intent.recipient_name,
        sendMethod: resolvedMethod,
        stripeAccountId: resolvedStripeAccountId,
        cashAppCashtag: resolvedCashAppCashtag,
        bankReference: resolvedBankReference,
        status: 'approved',
        notes: 'Created during send-money clarification flow',
        aliases: [intent.recipient_name],
      });
    } else if (resolvedRecipient && resolvedMethod) {
      const shouldUpdateRecipient = resolvedRecipient.sendMethod !== resolvedMethod
        || (resolvedMethod === 'cash_app' && resolvedCashAppCashtag !== (resolvedRecipient.cashAppCashtag || null))
        || (resolvedMethod === 'stripe_connected' && resolvedStripeAccountId !== (resolvedRecipient.stripeAccountId || null))
        || (resolvedMethod === 'bank' && resolvedBankReference !== (resolvedRecipient.bankReference || null))
        || resolvedRecipient.name.trim().toLowerCase() !== intent.recipient_name.trim().toLowerCase();

      if (shouldUpdateRecipient) {
        resolvedRecipient = await upsertRecipientDelivery({
          userId: params.userId,
          name: resolvedRecipient.name,
          sendMethod: resolvedMethod,
          stripeAccountId: resolvedStripeAccountId,
          cashAppCashtag: resolvedCashAppCashtag,
          bankReference: resolvedBankReference,
          status: resolvedRecipient.status,
          notes: resolvedRecipient.notes,
          aliases: [
            resolvedRecipient.name,
            intent.recipient_name,
            ...(resolvedRecipient.aliases || []),
          ],
        });
      }
    }

    if (!resolvedRecipient) {
      const approvedRecipients = wallet.recipients.filter((item) => item.status === 'approved');
      const recipientHint = approvedRecipients.length > 0
        ? `I can send $${intent.amount.toFixed(2)}. I don't see "${intent.recipient_name}" in approved recipients (${recipientListLabel(approvedRecipients)}). ${deliveryMethodQuestion(intent.recipient_name)}`
        : deliveryMethodQuestion(intent.recipient_name);

      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'send_money',
        intent: params.message,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question: recipientHint,
          missingFields: ['recipient_delivery_method'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: composeMessage(recipientHint),
        missingFields: ['recipient_delivery_method'],
      };
    }

    const guardrail = await checkGuardrails({
      userId: params.userId,
      amount: intent.amount,
      recipientId: resolvedRecipient.id,
      recipientName: resolvedRecipient.name,
      merchant: resolvedRecipient.name,
    });

    if (!guardrail.allowed) {
      const blockedMessage = `Cannot send $${intent.amount.toFixed(2)} to ${resolvedRecipient.name}: ${guardrail.reason || 'blocked by policy checks'}.`;
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'send_money',
        intent: params.message,
        status: 'blocked',
        input: intent,
        result: {
          reason: guardrail.reason || 'blocked by policy checks',
        },
        error: guardrail.reason || 'blocked by policy checks',
      });

      return {
        route: 'clarification',
        taskId,
        status: 'blocked',
        intent,
        message: composeMessage(blockedMessage),
      };
    }

    const approvalRequired = intent.amount >= wallet.settings.approvalThreshold;

    await persistAgentTask({
      userId: params.userId,
      taskId,
      taskType: 'send_money',
      intent: params.message,
      status: approvalRequired ? 'awaiting_approval' : 'ready',
      input: intent,
      result: {
        amount: intent.amount,
        recipientId: resolvedRecipient.id,
        recipientName: resolvedRecipient.name,
        sendMethod: resolvedRecipient.sendMethod,
        approvalRequired,
      },
    });

    return {
      route: 'send_money_approval',
      taskId,
      status: approvalRequired ? 'awaiting_approval' : 'ready',
      intent,
      message: composeMessage(approvalRequired
        ? `I found ${resolvedRecipient.name} in your recipients list. Send $${intent.amount.toFixed(2)}?`
        : `I found ${resolvedRecipient.name} in your recipients list. Sending $${intent.amount.toFixed(2)} now.`),
      sendMoney: {
        amount: intent.amount,
        recipientName: resolvedRecipient.name,
        recipientId: resolvedRecipient.id,
        sendMethod: resolvedRecipient.sendMethod,
      },
    };
  }

  if (intent.intent === 'fund_wallet') {
    if (intent.amount === null || intent.amount <= 0) {
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'fund_wallet',
        intent: params.message,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question: 'How much should I add to your wallet?',
          missingFields: ['amount'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: composeMessage('How much should I add to your wallet?'),
        missingFields: ['amount'],
      };
    }

    await persistAgentTask({
      userId: params.userId,
      taskId,
      taskType: 'fund_wallet',
      intent: params.message,
      status: 'ready',
      input: intent,
      result: { amount: intent.amount },
    });

    return {
      route: 'fund_wallet',
      taskId,
      status: 'ready',
      intent,
      message: composeMessage(`I can top up your wallet with $${intent.amount.toFixed(2)}.`),
      fundWallet: { amount: intent.amount },
    };
  }

  if (intent.intent === 'procurement_task' || intent.intent === 'compare_and_buy') {
    const procurementGoal = intent.normalized_goal || params.message;
    await persistAgentTask({
      userId: params.userId,
      taskId,
      taskType: intent.intent,
      intent: params.message,
      status: 'ready',
      input: intent,
      result: {
        goal: procurementGoal,
      },
    });

    return {
      route: 'procurement_task',
      taskId,
      status: 'ready',
      intent,
      message: composeMessage(intent.intent === 'compare_and_buy'
        ? 'Starting vendor comparison and purchase planning from your request.'
        : 'Starting procurement planning from your request.'),
      procurement: {
        goal: procurementGoal,
      },
    };
  }

  if (intent.intent === 'signup_and_prepare_checkout') {
    const pendingInput = (activePending?.input || {}) as Record<string, unknown>;
    const resumeAction = typeof pendingInput.resume_action === 'string' ? pendingInput.resume_action : null;
    const reconnectUserToolId = typeof pendingInput.reconnect_user_tool_id === 'string'
      ? pendingInput.reconnect_user_tool_id
      : null;
    const resumeToolKey = typeof pendingInput.tool_key === 'string'
      ? pendingInput.tool_key
      : null;
    const resumeToolDisplayName = typeof pendingInput.tool_display_name === 'string'
      ? pendingInput.tool_display_name
      : null;
    const requestedMode: 'login' | 'signup' | null = resumeAction === 'purchase_prep'
      ? null
      : toolRequestMode === 'signup'
        ? 'signup'
        : (toolRequestMode === 'login' || resumeAction === 'tool_reconnect')
          ? 'login'
          : null;
    const requestedTool = requestedCatalogTool
      || findCatalogToolByName(catalogTools, intent.merchant)
      || (resumeToolKey
        ? catalogTools.find((tool) => tool.key === normalizeToolKeyText(resumeToolKey)) || null
        : null);
    const toolLookupKey = requestedTool?.key
      || (resumeToolKey ? normalizeToolKeyText(resumeToolKey) : null)
      || (intent.merchant ? normalizeToolKeyText(intent.merchant) : null);
    const toolDisplayName = requestedTool?.displayName || resumeToolDisplayName || intent.merchant;
    const inferredCredentialSubmission = extractCredentialSubmission(params.message, true);
    const securitySensitiveMessage = Boolean(inferredCredentialSubmission);
    const persistedIntentText = securitySensitiveMessage ? '[credential submitted]' : params.message;
    if (securitySensitiveMessage) {
      intent.description = 'credential submitted';
    }
    if (!intent.merchant && toolDisplayName) {
      intent.merchant = toolDisplayName;
    }

    if (!intent.merchant) {
      const question = requestedMode === 'login'
        ? 'Which tool should I log into?'
        : 'Which vendor should I prepare checkout for?';
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'signup_and_prepare_checkout',
        intent: persistedIntentText,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question,
          missingFields: ['merchant'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: composeMessage(question),
        missingFields: ['merchant'],
      };
    }

    if (intent.profile_updates && Object.keys(intent.profile_updates).length > 0) {
      await upsertUserAutofillProfile(params.userId, {
        fullName: intent.profile_updates.full_name,
        email: intent.profile_updates.email,
        phone: intent.profile_updates.phone,
        companyName: intent.profile_updates.company_name,
        billingName: intent.profile_updates.billing_name,
        addressLine1: intent.profile_updates.address_line1,
        addressLine2: intent.profile_updates.address_line2,
        city: intent.profile_updates.city,
        stateRegion: intent.profile_updates.state_region,
        postalCode: intent.profile_updates.postal_code,
        country: intent.profile_updates.country,
      });
    }

    const requiredProfileFields = normalizeRequiredProfileFields(intent.required_profile_fields);
    const profile = await getUserAutofillProfile(params.userId);
    const missing = requestedMode === 'login'
      ? []
      : getMissingProfileFields(requiredProfileFields, profile);
    const procurementTaskId = typeof pendingInput.procurement_task_id === 'string'
      ? pendingInput.procurement_task_id
      : null;
    const needsSecurityCredential = pendingInput.missing_security_credential === true;
    const messageLooksLikeCredential = params.message.trim().length > 0
      && !isSimpleAffirmation(params.message.trim());
    const resumeCredentialSecret = (needsSecurityCredential && messageLooksLikeCredential)
      ? (inferredCredentialSubmission || params.message.trim())
      : undefined;

    if (requestedMode === 'login' && toolLookupKey) {
      const reconnectRequest = resumeAction === 'tool_reconnect' || isReconnectRequest(params.message);
      const providedSecret = extractCredentialSubmission(params.message, resumeAction === 'tool_reconnect');
      const providedIdentifier = extractLoginIdentifierFromMessage(params.message) || profile?.email || undefined;
      const resolvedTool = await resolveToolForAction({
        userId: params.userId,
        toolKey: toolLookupKey,
      });

      if (resumeAction === 'tool_reconnect') {
        if (!reconnectUserToolId || !providedSecret) {
          const question = `Share the updated ${toolDisplayName || intent.merchant} login credential to reconnect.`;
          await persistAgentTask({
            userId: params.userId,
            taskId,
            taskType: 'signup_and_prepare_checkout',
            intent: persistedIntentText,
            status: 'awaiting_clarification',
            input: {
              ...intent,
              resume_action: 'tool_reconnect',
              reconnect_user_tool_id: reconnectUserToolId,
              tool_key: toolLookupKey,
              tool_display_name: toolDisplayName || intent.merchant,
            },
            result: {
              question,
              missingFields: ['security_credential'],
              success: false,
              error_type: 'login_required',
              error_message: 'Updated login is required before reconnect.',
            },
          });

          return {
            route: 'clarification',
            taskId,
            status: 'awaiting_clarification',
            intent,
            message: composeMessage(question),
            missingFields: ['security_credential'],
          };
        }

        const reconnected = await reconnectToolForUser({
          userId: params.userId,
          userToolId: reconnectUserToolId,
          secret: providedSecret,
          loginIdentifier: providedIdentifier,
          metadata: {
            source: 'runtime_reconnect',
            taskId,
            merchant: intent.merchant,
          },
        });

        await persistAgentTask({
          userId: params.userId,
          taskId,
          taskType: 'signup_and_prepare_checkout',
          intent: persistedIntentText,
          status: 'ready',
          input: {
            ...intent,
            mode: 'login',
            tool_key: reconnected.tool.key,
          },
          result: {
            task_type: 'login',
            tool: reconnected.tool.key,
            status: 'success',
            used_saved_login: false,
            notes: 'Credentials updated and reconnected.',
          },
        });

        return {
          route: 'signup_and_prepare_checkout',
          taskId,
          status: 'ready',
          intent,
          message: composeMessage(`Reconnected ${reconnected.tool.displayName}. Running with saved login.`),
          signup: {
            merchant: intent.merchant,
            requiredProfileFields: [],
            mode: 'login',
            toolKey: reconnected.tool.key,
            toolDisplayName: reconnected.tool.displayName,
            credentialState: 'updated',
            usedSavedLogin: false,
          },
        };
      }

      if (!resolvedTool) {
        const question = `No saved ${toolDisplayName || intent.merchant} login found. Connect it in Tools first.`;
        await persistAgentTask({
          userId: params.userId,
          taskId,
          taskType: 'signup_and_prepare_checkout',
          intent: persistedIntentText,
          status: 'awaiting_clarification',
          input: {
            ...intent,
            mode: 'login',
            tool_key: toolLookupKey,
            tool_display_name: toolDisplayName || intent.merchant,
          },
          result: {
            question,
            missingFields: ['tool_connection'],
            success: false,
            error_type: 'login_required',
            error_message: 'No saved login is connected for this tool.',
          },
        });

        return {
          route: 'clarification',
          taskId,
          status: 'awaiting_clarification',
          intent,
          message: composeMessage(question),
          missingFields: ['tool_connection'],
        };
      }

      if (reconnectRequest) {
        if (!providedSecret) {
          const question = `Share the updated ${resolvedTool.tool.displayName} login credential to reconnect.`;
          await persistAgentTask({
            userId: params.userId,
            taskId,
            taskType: 'signup_and_prepare_checkout',
            intent: persistedIntentText,
            status: 'awaiting_clarification',
            input: {
              ...intent,
              mode: 'login',
              resume_action: 'tool_reconnect',
              reconnect_user_tool_id: resolvedTool.id,
              tool_key: resolvedTool.tool.key,
              tool_display_name: resolvedTool.tool.displayName,
            },
            result: {
              question,
              missingFields: ['security_credential'],
              success: false,
              error_type: 'login_required',
              error_message: 'Updated login is required before reconnect.',
            },
          });

          return {
            route: 'clarification',
            taskId,
            status: 'awaiting_clarification',
            intent,
            message: composeMessage(question),
            missingFields: ['security_credential'],
          };
        }

        const reconnected = await reconnectToolForUser({
          userId: params.userId,
          userToolId: resolvedTool.id,
          secret: providedSecret,
          loginIdentifier: providedIdentifier,
          metadata: {
            source: 'runtime_reconnect',
            taskId,
            merchant: intent.merchant,
          },
        });

        await persistAgentTask({
          userId: params.userId,
          taskId,
          taskType: 'signup_and_prepare_checkout',
          intent: persistedIntentText,
          status: 'ready',
          input: {
            ...intent,
            mode: 'login',
            tool_key: reconnected.tool.key,
          },
          result: {
            task_type: 'login',
            tool: reconnected.tool.key,
            status: 'success',
            used_saved_login: false,
            notes: 'Credentials updated and reconnected.',
          },
        });

        return {
          route: 'signup_and_prepare_checkout',
          taskId,
          status: 'ready',
          intent,
          message: composeMessage(`Reconnected ${reconnected.tool.displayName}. Running with saved login.`),
          signup: {
            merchant: intent.merchant,
            requiredProfileFields: [],
            mode: 'login',
            toolKey: reconnected.tool.key,
            toolDisplayName: reconnected.tool.displayName,
            credentialState: 'updated',
            usedSavedLogin: false,
          },
        };
      }

      const credentialRef = await resolveRuntimeCredentialReference({
        userId: params.userId,
        toolKey: resolvedTool.tool.key,
      });

      if (!credentialRef.resolved) {
        const reason = credentialRef.reason;
        const question = reason === 'not_enabled'
          ? `${resolvedTool.tool.displayName} is disabled. Enable it in Tools before running this task.`
          : reason === 'not_connected'
            ? `No saved ${resolvedTool.tool.displayName} login found. Connect it in Tools first.`
            : `Saved login for ${resolvedTool.tool.displayName} needs reconnect before I can continue.`;
        const missingFields = reason === 'not_enabled'
          ? ['tool_enable']
          : reason === 'not_connected'
            ? ['tool_connection']
            : ['security_credential'];

        await persistAgentTask({
          userId: params.userId,
          taskId,
          taskType: 'signup_and_prepare_checkout',
          intent: persistedIntentText,
          status: 'awaiting_clarification',
          input: {
            ...intent,
            mode: 'login',
            tool_key: resolvedTool.tool.key,
            tool_display_name: resolvedTool.tool.displayName,
            ...((reason === 'not_enabled' || reason === 'not_connected') ? {} : {
              resume_action: 'tool_reconnect',
              reconnect_user_tool_id: resolvedTool.id,
            }),
          },
          result: {
            question,
            missingFields,
            success: false,
            error_type: reason === 'not_enabled' || reason === 'not_connected' ? 'login_required' : 'invalid_credentials',
            error_message: reason === 'not_enabled'
              ? 'Tool is disabled.'
              : reason === 'not_connected'
                ? 'No saved login is connected for this tool.'
                : 'Saved login is missing or invalid. Reconnect is required.',
          },
        });

        return {
          route: 'clarification',
          taskId,
          status: 'awaiting_clarification',
          intent,
          message: composeMessage(question),
          missingFields,
        };
      }

      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'signup_and_prepare_checkout',
        intent: persistedIntentText,
        status: 'ready',
        input: {
          ...intent,
          mode: 'login',
          tool_key: resolvedTool.tool.key,
        },
        result: {
          task_type: 'login',
          tool: resolvedTool.tool.key,
          status: 'success',
          used_saved_login: true,
          notes: null,
        },
      });

      return {
        route: 'signup_and_prepare_checkout',
        taskId,
        status: 'ready',
        intent,
        message: composeMessage(`Using saved ${resolvedTool.tool.displayName} login.`),
        signup: {
          merchant: intent.merchant,
          requiredProfileFields: [],
          mode: 'login',
          toolKey: resolvedTool.tool.key,
          toolDisplayName: resolvedTool.tool.displayName,
          credentialState: 'ready',
          usedSavedLogin: true,
        },
      };
    }

    if (missing.length > 0) {
      const nextField = missing[0];
      const question = `Before I continue checkout prep for ${intent.merchant}, what is your ${friendlyProfileFieldName(nextField)}?`;
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'signup_and_prepare_checkout',
        intent: persistedIntentText,
        status: 'awaiting_clarification',
        input: {
          ...intent,
          required_profile_fields: requiredProfileFields,
        },
        result: {
          question,
          missingFields: missing,
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent: {
          ...intent,
          required_profile_fields: requiredProfileFields,
        },
        message: composeMessage(question),
        missingFields: missing,
      };
    }

    if (needsSecurityCredential && !resumeCredentialSecret) {
      const question = `To continue ${intent.merchant} sign-in, share the required credential or app-specific code.`;
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'signup_and_prepare_checkout',
        intent: persistedIntentText,
        status: 'awaiting_clarification',
        input: {
          ...intent,
          required_profile_fields: requiredProfileFields,
          procurement_task_id: procurementTaskId,
          resume_action: resumeAction,
          missing_security_credential: true,
        },
        result: {
          question,
          missingFields: ['security_credential'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent: {
          ...intent,
          required_profile_fields: requiredProfileFields,
        },
        message: composeMessage(question),
        missingFields: ['security_credential'],
      };
    }

    await persistAgentTask({
      userId: params.userId,
      taskId,
      taskType: 'signup_and_prepare_checkout',
      intent: persistedIntentText,
      status: 'ready',
      input: {
        ...intent,
        required_profile_fields: requiredProfileFields,
      },
      result: {
        goal: params.message,
        merchant: intent.merchant,
        requiredProfileFields,
        task_type: 'signup',
        tool: toolLookupKey,
        status: 'success',
        created_tool: false,
        login_identifier: profile?.email || null,
        notes: null,
      },
    });

    if (resumeAction === 'purchase_prep' && procurementTaskId) {
      void runProcurementPurchasePreparation({
        userId: params.userId,
        taskId: procurementTaskId,
        resumeCredentialSecret,
      });

      return {
        route: 'signup_and_prepare_checkout',
        taskId,
        status: 'ready',
        intent: {
          ...intent,
          required_profile_fields: requiredProfileFields,
        },
        message: composeMessage(`Resuming ${intent.merchant} sign-up and checkout preparation now.`),
        signup: {
          merchant: intent.merchant,
          requiredProfileFields,
          mode: 'signup',
          toolKey: toolLookupKey,
          toolDisplayName: toolDisplayName || intent.merchant,
        },
      };
    }

    return {
      route: 'signup_and_prepare_checkout',
      taskId,
      status: 'ready',
      intent: {
        ...intent,
        required_profile_fields: requiredProfileFields,
      },
      message: composeMessage(`Autofill profile is ready. Starting sign-up and checkout preparation for ${intent.merchant}.`),
      signup: {
        merchant: intent.merchant,
        requiredProfileFields,
        mode: 'signup',
        toolKey: toolLookupKey,
        toolDisplayName: toolDisplayName || intent.merchant,
      },
    };
  }

  if (intent.intent === 'cancel_subscription') {
    const activeSubscriptions = await listActiveSubscriptions(params.userId);
    if (!intent.merchant) {
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'cancel_subscription',
        intent: params.message,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question: 'Which subscription should I cancel?',
          missingFields: ['merchant'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: composeMessage('Which subscription should I cancel?'),
        missingFields: ['merchant'],
      };
    }

    const merchantLookup = intent.merchant.toLowerCase();
    const target = activeSubscriptions.find((subscription) => {
      const vendor = subscription.vendorName.toLowerCase();
      return vendor === merchantLookup || vendor.includes(merchantLookup) || merchantLookup.includes(vendor);
    });

    if (!target) {
      const listing = activeSubscriptions.length > 0
        ? activeSubscriptions.slice(0, 8).map((subscription) => subscription.vendorName).join(', ')
        : 'none';

      const clarification = activeSubscriptions.length > 0
        ? `I couldn't match "${intent.merchant}" to an active subscription. Available subscriptions: ${listing}.`
        : 'I do not see any active approved subscriptions to cancel right now.';

      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'cancel_subscription',
        intent: params.message,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question: clarification,
          missingFields: ['merchant'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: composeMessage(clarification),
        missingFields: ['merchant'],
      };
    }

    await persistAgentTask({
      userId: params.userId,
      taskId,
      taskType: 'cancel_subscription',
      intent: params.message,
      status: 'ready',
      input: intent,
      result: {
        vendorName: target.vendorName,
        targetTaskId: target.taskId,
      },
    });

    return {
      route: 'cancel_subscription',
      taskId,
      status: 'ready',
      intent,
      message: composeMessage(`Starting cancellation flow for ${target.vendorName}.`),
      cancelSubscription: {
        vendorName: target.vendorName,
        taskId: target.taskId,
      },
    };
  }

  const dailySpent = Math.round(sumSucceededDebitsSince(wallet.transactions, startOfDayMs()) * 100) / 100;
  const monthlySpent = Math.round(sumSucceededDebitsSince(wallet.transactions, startOfMonthMs()) * 100) / 100;

  await persistAgentTask({
    userId: params.userId,
    taskId,
    taskType: 'review_spend',
    intent: params.message,
    status: 'ready',
    input: intent,
    result: {
      balance: wallet.balance,
      currency: wallet.currency,
      dailySpent,
      monthlySpent,
    },
  });

  return {
    route: 'review_spend',
    taskId,
    status: 'ready',
    intent,
    message: composeMessage('Reviewing your wallet balance and spend activity.'),
    reviewSpend: {
      balance: wallet.balance,
      currency: wallet.currency,
      dailySpent,
      monthlySpent,
    },
  };
}
