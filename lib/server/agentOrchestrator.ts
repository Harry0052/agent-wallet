import { randomUUID } from 'node:crypto';
import type { Recipient } from '@/lib/types';
import {
  addRecipient,
  checkGuardrails,
  getLatestPendingAgentTask,
  getUserAutofillProfile,
  getWallet,
  recordAgentTask,
  resolveRecipientByName,
  upsertUserAutofillProfile,
} from '@/lib/server/ledger';
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

function mergeIntentWithPending(
  intent: AgentIntent,
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
  const previousStripeAccount = typeof pendingInput.recipient_stripe_account_id === 'string'
    ? pendingInput.recipient_stripe_account_id
    : null;
  const previousRequiredProfileFields = Array.isArray(pendingInput.required_profile_fields)
    ? pendingInput.required_profile_fields.filter((field): field is AgentIntent['required_profile_fields'][number] => {
      return typeof field === 'string';
    })
    : [];
  const previousIntent = typeof pendingInput.intent === 'string'
    ? pendingInput.intent
    : null;

  const shouldPreservePendingIntent = pendingStatus === 'awaiting_clarification' && intent.confidence < 0.7;
  const resolvedIntent = intent.intent === 'send_money'
    ? 'send_money'
    : (shouldPreservePendingIntent && previousIntent
      ? previousIntent
      : intent.intent);

  return {
    ...intent,
    intent: (pendingTaskType === 'signup_and_prepare_checkout' && resolvedIntent === 'procurement_task')
      ? 'signup_and_prepare_checkout'
      : (resolvedIntent as AgentIntent['intent']),
    amount: intent.amount ?? previousAmount,
    recipient_name: intent.recipient_name ?? previousRecipient,
    merchant: intent.merchant ?? previousMerchant,
    budget_limit: intent.budget_limit ?? previousBudget,
    recipient_stripe_account_id: intent.recipient_stripe_account_id ?? previousStripeAccount,
    required_profile_fields: intent.required_profile_fields.length > 0
      ? intent.required_profile_fields
      : previousRequiredProfileFields,
  };
}

function extractStripeAccountIdFromMessage(message: string): string | null {
  const matched = message.match(/\bacct_[A-Za-z0-9]+\b/);
  return matched?.[0] || null;
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
  const context = pending
    ? `Pending task: type=${pending.taskType} status=${pending.status} input=${JSON.stringify(pending.input || {})}`
    : undefined;

  const parsedIntent = await parseAgentIntent(params.message, { context });
  const intent = mergeIntentWithPending(parsedIntent, pending?.input, pending?.taskType, pending?.status);
  const taskId = pending?.id || randomUUID();
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
        message: 'How much should I send?',
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
          question: 'Who should receive the payment?',
          missingFields: ['recipient_name'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: 'Who should receive the payment?',
        missingFields: ['recipient_name'],
      };
    }

    const recipient = await resolveRecipientByName(params.userId, intent.recipient_name);
    if (!recipient && intent.recipient_stripe_account_id) {
      await addRecipient(
        params.userId,
        intent.recipient_name,
        intent.recipient_stripe_account_id,
        'approved',
        'Created during clarification flow',
      );
    }

    const resolvedRecipient = recipient || await resolveRecipientByName(params.userId, intent.recipient_name);
    if (!resolvedRecipient) {
      const approvedRecipients = wallet.recipients.filter((item) => item.status === 'approved');
      const recipientHint = approvedRecipients.length > 0
        ? `I can send $${intent.amount.toFixed(2)}. I don't see "${intent.recipient_name}" in approved recipients (${recipientListLabel(approvedRecipients)}). Share their Stripe account id (starts with acct_) to save and continue.`
        : `I don't see a saved recipient named "${intent.recipient_name}". Share their Stripe account id (starts with acct_) and I will save them and continue.`;

      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'send_money',
        intent: params.message,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question: recipientHint,
          missingFields: ['recipient_account'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: recipientHint,
        missingFields: ['recipient_account'],
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
        message: blockedMessage,
      };
    }

    await persistAgentTask({
      userId: params.userId,
      taskId,
      taskType: 'send_money',
      intent: params.message,
      status: 'awaiting_approval',
      input: intent,
      result: {
        amount: intent.amount,
        recipientId: resolvedRecipient.id,
        recipientName: resolvedRecipient.name,
      },
    });

    return {
      route: 'send_money_approval',
      taskId,
      status: 'awaiting_approval',
      intent,
      message: `I found ${resolvedRecipient.name} in your recipients list. Send $${intent.amount.toFixed(2)}?`,
      sendMoney: {
        amount: intent.amount,
        recipientName: resolvedRecipient.name,
        recipientId: resolvedRecipient.id,
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
        message: 'How much should I add to your wallet?',
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
      message: `I can top up your wallet with $${intent.amount.toFixed(2)}.`,
      fundWallet: { amount: intent.amount },
    };
  }

  if (intent.intent === 'procurement_task' || intent.intent === 'compare_and_buy') {
    await persistAgentTask({
      userId: params.userId,
      taskId,
      taskType: intent.intent,
      intent: params.message,
      status: 'ready',
      input: intent,
      result: {
        goal: params.message,
      },
    });

    return {
      route: 'procurement_task',
      taskId,
      status: 'ready',
      intent,
      message: intent.intent === 'compare_and_buy'
        ? 'Starting vendor comparison and purchase planning from your request.'
        : 'Starting procurement planning from your request.',
      procurement: {
        goal: params.message,
      },
    };
  }

  if (intent.intent === 'signup_and_prepare_checkout') {
    if (!intent.merchant) {
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'signup_and_prepare_checkout',
        intent: params.message,
        status: 'awaiting_clarification',
        input: intent,
        result: {
          question: 'Which vendor should I prepare checkout for?',
          missingFields: ['merchant'],
        },
      });

      return {
        route: 'clarification',
        taskId,
        status: 'awaiting_clarification',
        intent,
        message: 'Which vendor should I prepare checkout for?',
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
    const missing = getMissingProfileFields(requiredProfileFields, profile);
    const pendingInput = (pending?.input || {}) as Record<string, unknown>;
    const resumeAction = typeof pendingInput.resume_action === 'string' ? pendingInput.resume_action : null;
    const procurementTaskId = typeof pendingInput.procurement_task_id === 'string'
      ? pendingInput.procurement_task_id
      : null;
    const needsSecurityCredential = pendingInput.missing_security_credential === true;
    const messageLooksLikeCredential = params.message.trim().length > 0
      && !/^(yes|y|ok|okay|sure|continue)$/i.test(params.message.trim());
    const resumeCredentialSecret = (needsSecurityCredential && messageLooksLikeCredential)
      ? params.message.trim()
      : undefined;

    if (missing.length > 0) {
      const nextField = missing[0];
      const question = `Before I continue checkout prep for ${intent.merchant}, what is your ${friendlyProfileFieldName(nextField)}?`;
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'signup_and_prepare_checkout',
        intent: params.message,
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
        message: question,
        missingFields: missing,
      };
    }

    if (needsSecurityCredential && !resumeCredentialSecret) {
      const question = `To continue ${intent.merchant} sign-in, share the required credential or app-specific code.`;
      await persistAgentTask({
        userId: params.userId,
        taskId,
        taskType: 'signup_and_prepare_checkout',
        intent: params.message,
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
        message: question,
        missingFields: ['security_credential'],
      };
    }

    await persistAgentTask({
      userId: params.userId,
      taskId,
      taskType: 'signup_and_prepare_checkout',
      intent: params.message,
      status: 'ready',
      input: {
        ...intent,
        required_profile_fields: requiredProfileFields,
      },
      result: {
        goal: params.message,
        merchant: intent.merchant,
        requiredProfileFields,
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
        message: `Resuming ${intent.merchant} sign-up and checkout preparation now.`,
        signup: {
          merchant: intent.merchant,
          requiredProfileFields,
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
      message: `Autofill profile is ready. Starting sign-up and checkout preparation for ${intent.merchant}.`,
      signup: {
        merchant: intent.merchant,
        requiredProfileFields,
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
        message: 'Which subscription should I cancel?',
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
        message: clarification,
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
      message: `Starting cancellation flow for ${target.vendorName}.`,
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
    message: 'Reviewing your wallet balance and spend activity.',
    reviewSpend: {
      balance: wallet.balance,
      currency: wallet.currency,
      dailySpent,
      monthlySpent,
    },
  };
}
