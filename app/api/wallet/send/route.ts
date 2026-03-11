import { NextRequest, NextResponse } from 'next/server';
import {
  checkGuardrails,
  getWallet,
  getWalletUserId,
  recordLedgerEntry,
  recordLedgerEntryUnique,
} from '@/lib/server/ledger';
import { isAuthError } from '@/lib/server/auth';
import { getStripeClient } from '@/lib/server/stripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = await getWalletUserId();
  let attemptedAmount = 0;
  let attemptedCurrency = 'usd';

  try {
    const body = (await req.json()) as {
      amount?: number;
      recipientId?: string;
      recipientName?: string;
      merchant?: string;
      sourceUrl?: string;
      description?: string;
      approved?: boolean;
      idempotencyKey?: string;
    };

    const amount = Number(body.amount);
    attemptedAmount = Number.isFinite(amount) ? amount : 0;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(apiError('VALIDATION_ERROR', 'Valid amount is required', true), { status: 400 });
    }

    const wallet = await getWallet(userId);
    attemptedCurrency = wallet.currency.toLowerCase();
    if (amount >= wallet.settings.approvalThreshold && body.approved !== true) {
      return NextResponse.json(
        apiError(
          'POLICY_FAILURE',
          `Approval required for amounts at/above $${wallet.settings.approvalThreshold.toFixed(2)}`,
          true,
        ),
        { status: 409 },
      );
    }

    const check = await checkGuardrails({
      userId,
      amount,
      merchant: body.merchant,
      recipientId: body.recipientId,
      recipientName: body.recipientName,
    });

    if (!check.allowed || !check.recipient) {
      return NextResponse.json(
        apiError('POLICY_FAILURE', check.reason || 'Transfer blocked by guardrails', true),
        { status: 409 },
      );
    }

    const recipient = check.recipient;
    if (recipient.sendMethod === 'cash_app') {
      const message = recipient.cashAppCashtag
        ? `Cash App recipient ${recipient.name} is saved (${recipient.cashAppCashtag}), but automated Cash App execution is not implemented yet.`
        : `Cash App recipient ${recipient.name} is missing a cashtag.`;
      return NextResponse.json(apiError('INVALID_STATE', message, true), { status: 501 });
    }

    if (recipient.sendMethod === 'bank') {
      const message = recipient.bankReference
        ? `Bank recipient ${recipient.name} is saved (${recipient.bankReference}), but automated bank send execution is not implemented yet.`
        : `Bank recipient ${recipient.name} is missing a bank reference.`;
      return NextResponse.json(apiError('INVALID_STATE', message, true), { status: 501 });
    }

    const stripeDestination = recipient.stripeAccountId;
    if (!stripeDestination) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', `Stripe recipient ${recipient.name} is missing a Stripe account id`, true),
        { status: 409 },
      );
    }

    const idempotencyKeyHeader = req.headers.get('x-idempotency-key');
    const idempotencyKey = (idempotencyKeyHeader || body.idempotencyKey || '').trim() || undefined;

    logServerEvent('info', 'wallet.send.started', {
      userId,
      amount,
      currency: wallet.currency.toLowerCase(),
      recipientId: recipient.id,
      hasIdempotencyKey: Boolean(idempotencyKey),
    });

    const stripe = getStripeClient();
    const transfer = await stripe.transfers.create(
      {
        amount: Math.round(amount * 100),
        currency: wallet.currency.toLowerCase(),
        destination: stripeDestination,
        description: body.description || `Wallet send to ${recipient.name}`,
        metadata: {
          wallet_action: 'send',
          wallet_user_id: userId,
          wallet_recipient_id: recipient.id,
        },
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    const transaction = await recordLedgerEntryUnique({
      userId,
      type: 'send',
      amount,
      currency: wallet.currency.toLowerCase(),
      direction: 'debit',
      stripeObjectId: transfer.id,
      description: body.description || `Sent to ${recipient.name}`,
      merchant: body.merchant,
      recipientId: recipient.id,
      status: 'succeeded',
      source: 'connect-transfer',
      sourceUrl: body.sourceUrl,
      metadata: {
        recipient_name: recipient.name,
      },
    });

    const updatedWallet = await getWallet(userId);
    logServerEvent('info', 'wallet.send.completed', {
      userId,
      transferId: transfer.id,
      ledgerEntryId: transaction.id,
      amount,
    });
    return NextResponse.json({ wallet: updatedWallet, transaction, payoutStatus: 'succeeded' });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to send money';
    const classified = classifyTaskError({ message });
    const errorCode = classified === 'UNKNOWN_FAILURE' ? 'STRIPE_FAILURE' : classified;
    const status = errorCode === 'STRIPE_FAILURE' ? 502 : 500;

    if (attemptedAmount > 0) {
      try {
        await recordLedgerEntry({
          userId,
          type: 'send',
          amount: attemptedAmount,
          currency: attemptedCurrency,
          direction: 'debit',
          description: `Send failed: ${message}`,
          status: 'failed',
          source: 'connect-transfer',
          metadata: {
            error_code: errorCode,
          },
        });
      } catch (persistError) {
        logServerEvent('error', 'wallet.send.persist_failure', {
          userId,
          attemptedAmount,
          error: persistError instanceof Error ? persistError.message : String(persistError),
        });
      }
    }

    logServerEvent('error', 'wallet.send.failed', {
      userId,
      attemptedAmount,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
