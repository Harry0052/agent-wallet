import type { AgentExecutionResult } from '@/lib/agent/types';
import type { AgentOrchestrationResult } from '@/lib/server/agentOrchestrator';
import {
  checkGuardrails,
  getWallet,
  recordAgentTask,
  recordLedgerEntry,
  recordLedgerEntryUnique,
} from '@/lib/server/ledger';
import { getEnabledCheckoutMethods, getStripeClient } from '@/lib/server/stripe';

function resolveAppOrigin(): string {
  const explicit = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && /^https?:\/\//i.test(explicit)) {
    return explicit.replace(/\/+$/, '');
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
  }

  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

async function executeFundWallet(params: {
  userId: string;
  orchestration: AgentOrchestrationResult;
}): Promise<AgentExecutionResult> {
  const amount = params.orchestration.fundWallet?.amount;
  if (!amount || amount <= 0) {
    return {
      status: 'failed',
      message: 'Funding amount missing or invalid.',
    };
  }

  const cents = Math.round(amount * 100);
  if (cents < 50) {
    return {
      status: 'failed',
      message: 'Minimum top-up is $0.50.',
    };
  }

  const origin = resolveAppOrigin();
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: getEnabledCheckoutMethods(),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: { name: 'Agent Wallet top-up' },
        },
      },
    ],
    payment_intent_data: {
      metadata: {
        wallet_action: 'topup',
        wallet_user_id: params.userId,
      },
    },
    success_url: `${origin}/?funding_status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?funding_cancelled=1`,
    metadata: {
      wallet_action: 'topup',
      wallet_user_id: params.userId,
    },
  });

  await recordAgentTask({
    userId: params.userId,
    taskId: params.orchestration.taskId,
    taskType: 'fund_wallet',
    intent: params.orchestration.message,
    status: 'completed',
    result: {
      checkoutUrl: session.url,
      sessionId: session.id,
      amount,
    },
  });

  return {
    status: 'pending_checkout',
    message: `Funding checkout created for $${amount.toFixed(2)}.`,
    checkoutUrl: session.url,
    sessionId: session.id,
    amount,
  };
}

async function executeSendMoney(params: {
  userId: string;
  orchestration: AgentOrchestrationResult;
}): Promise<AgentExecutionResult> {
  const sendMoney = params.orchestration.sendMoney;
  if (!sendMoney) {
    return {
      status: 'needs_input',
      message: 'Send-money payload is missing recipient or amount.',
    };
  }

  const { amount, recipientId, recipientName } = sendMoney;
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      status: 'failed',
      message: 'Send amount is invalid.',
    };
  }

  const guardrail = await checkGuardrails({
    userId: params.userId,
    amount,
    recipientId,
    recipientName,
    merchant: recipientName,
  });

  if (!guardrail.allowed || !guardrail.recipient) {
    await recordAgentTask({
      userId: params.userId,
      taskId: params.orchestration.taskId,
      taskType: 'send_money',
      intent: params.orchestration.message,
      status: 'blocked',
      result: {
        reason: guardrail.reason || 'blocked by guardrails',
      },
      error: guardrail.reason || 'blocked by guardrails',
    });

    return {
      status: 'failed',
      message: guardrail.reason || 'Transfer blocked by guardrails.',
      reason: guardrail.reason || 'Transfer blocked by guardrails.',
    };
  }

  const wallet = await getWallet(params.userId);
  const currency = wallet.currency.toLowerCase();
  const recipient = guardrail.recipient;

  if (recipient.sendMethod === 'cash_app') {
    const message = recipient.cashAppCashtag
      ? `Cash App recipient ${recipient.name} is saved (${recipient.cashAppCashtag}), but automated Cash App execution is not implemented yet.`
      : `Cash App recipient ${recipient.name} is selected, but the cashtag is missing.`;

    await recordAgentTask({
      userId: params.userId,
      taskId: params.orchestration.taskId,
      taskType: 'send_money',
      intent: params.orchestration.message,
      status: 'blocked',
      result: {
        reason: message,
        sendMethod: recipient.sendMethod,
      },
      error: message,
    });

    return {
      status: 'failed',
      message,
      reason: message,
      recipientId: recipient.id,
      recipientName: recipient.name,
      sendMethod: recipient.sendMethod,
    };
  }

  if (recipient.sendMethod === 'bank') {
    const message = recipient.bankReference
      ? `Bank recipient ${recipient.name} is saved (${recipient.bankReference}), but automated bank send execution is not implemented yet.`
      : `Bank recipient ${recipient.name} is selected, but the bank reference is missing.`;

    await recordAgentTask({
      userId: params.userId,
      taskId: params.orchestration.taskId,
      taskType: 'send_money',
      intent: params.orchestration.message,
      status: 'blocked',
      result: {
        reason: message,
        sendMethod: recipient.sendMethod,
      },
      error: message,
    });

    return {
      status: 'failed',
      message,
      reason: message,
      recipientId: recipient.id,
      recipientName: recipient.name,
      sendMethod: recipient.sendMethod,
    };
  }

  const stripeDestination = recipient.stripeAccountId;
  if (!stripeDestination) {
    const message = `Stripe recipient ${recipient.name} is missing a Stripe account id.`;
    await recordAgentTask({
      userId: params.userId,
      taskId: params.orchestration.taskId,
      taskType: 'send_money',
      intent: params.orchestration.message,
      status: 'blocked',
      result: {
        reason: message,
        sendMethod: recipient.sendMethod,
      },
      error: message,
    });

    return {
      status: 'failed',
      message,
      reason: message,
      recipientId: recipient.id,
      recipientName: recipient.name,
      sendMethod: recipient.sendMethod,
    };
  }

  try {
    const stripe = getStripeClient();
    const transfer = await stripe.transfers.create(
      {
        amount: Math.round(amount * 100),
        currency,
        destination: stripeDestination,
        description: `Wallet send to ${recipient.name}`,
        metadata: {
          wallet_action: 'send',
          wallet_user_id: params.userId,
          wallet_recipient_id: recipient.id,
          agent_task_id: params.orchestration.taskId,
        },
      },
      {
        idempotencyKey: `agent-send-${params.orchestration.taskId}`,
      },
    );

    const transaction = await recordLedgerEntryUnique({
      userId: params.userId,
      type: 'send',
      amount,
      currency,
      direction: 'debit',
      stripeObjectId: transfer.id,
      description: `Sent to ${recipient.name}`,
      merchant: recipient.name,
      recipientId: recipient.id,
      status: 'succeeded',
      source: 'connect-transfer',
      metadata: {
        recipient_name: recipient.name,
      },
    });

    await recordAgentTask({
      userId: params.userId,
      taskId: params.orchestration.taskId,
      taskType: 'send_money',
      intent: params.orchestration.message,
      status: 'completed',
      result: {
        transferId: transfer.id,
        transactionId: transaction.id,
        amount,
        recipientId: recipient.id,
        recipientName: recipient.name,
      },
    });

    return {
      status: 'success',
      message: `Sent $${amount.toFixed(2)} to ${recipient.name}.`,
      transferId: transfer.id,
      transactionId: transaction.id,
      amount,
      currency,
      recipientId: recipient.id,
      recipientName: recipient.name,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stripe transfer failed';

    await recordLedgerEntry({
      userId: params.userId,
      type: 'send',
      amount,
      currency,
      direction: 'debit',
      description: `Send failed: ${message}`,
      status: 'failed',
      source: 'connect-transfer',
      metadata: {
        error_code: 'STRIPE_FAILURE',
      },
    });

    await recordAgentTask({
      userId: params.userId,
      taskId: params.orchestration.taskId,
      taskType: 'send_money',
      intent: params.orchestration.message,
      status: 'failed',
      error: message,
      result: {
        recipientId: recipient.id,
        recipientName: recipient.name,
        amount,
      },
    });

    return {
      status: 'failed',
      message,
      amount,
      recipientId: recipient.id,
      recipientName: recipient.name,
    };
  }
}

export async function executeStripeWalletTask(params: {
  userId: string;
  orchestration: AgentOrchestrationResult;
}): Promise<AgentExecutionResult> {
  if (params.orchestration.route === 'fund_wallet') {
    return executeFundWallet(params);
  }

  if (params.orchestration.route === 'send_money_approval') {
    return executeSendMoney(params);
  }

  return {
    status: 'noop',
    message: `No Stripe action for route ${params.orchestration.route}.`,
  };
}
