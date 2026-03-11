import { NextRequest, NextResponse } from 'next/server';
import { isAuthError } from '@/lib/server/auth';
import {
  checkSubscriptionGuardrails,
  getWallet,
  getWalletUserId,
  recordLedgerEntryUnique,
} from '@/lib/server/ledger';
import { runRecoveryReconciliationCycle } from '@/lib/reconciliation/reconcileFailedPurchases';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

/**
 * POST /api/wallet/subscription-debit
 *
 * Records a ledger-only debit for subscription payments.
 * Unlike /api/wallet/send, this does NOT require a Stripe Connect recipient —
 * the subscription service itself handles the actual charge.
 */
export async function POST(req: NextRequest) {
  const userId = await getWalletUserId();

  try {
    const body = (await req.json()) as {
      amount?: number;
      merchant?: string;
      description?: string;
      approved?: boolean;
      idempotencyKey?: string;
    };

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Valid amount is required', true),
        { status: 400 },
      );
    }

    // Safety default: block legacy ledger-only debits unless explicitly enabled.
    // Production recovery logic relies on two-phase authorize/capture paths.
    if (process.env.ALLOW_LEGACY_LEDGER_SUBSCRIPTION_DEBIT !== 'true') {
      return NextResponse.json(
        apiError(
          'POLICY_FAILURE',
          'Legacy ledger-only subscription debits are disabled. Use /api/payments/authorize and /api/payments/capture.',
          true,
        ),
        { status: 409 },
      );
    }

    const wallet = await getWallet(userId);
    const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : undefined;

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

    const check = await checkSubscriptionGuardrails({
      userId,
      amount,
      merchant: body.merchant,
    });

    if (!check.allowed) {
      return NextResponse.json(
        apiError('POLICY_FAILURE', check.reason || 'Subscription debit blocked by guardrails', true),
        { status: 409 },
      );
    }

    logServerEvent('info', 'wallet.subscription_debit.started', {
      userId,
      amount,
      merchant: body.merchant,
    });

    const transaction = await recordLedgerEntryUnique({
      userId,
      type: 'subscription_debit',
      amount,
      currency: wallet.currency.toLowerCase(),
      direction: 'debit',
      description: body.description || `Subscription: ${body.merchant || 'unknown'}`,
      merchant: body.merchant,
      status: 'succeeded',
      source: 'connect-transfer',
      stripeObjectId: idempotencyKey ? `subscription:${idempotencyKey}` : undefined,
      metadata: {
        subscription_merchant: body.merchant || '',
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      },
    });

    const updatedWallet = await getWallet(userId);

    await runRecoveryReconciliationCycle({
      userId,
      autoRecover: false,
      limit: 200,
    }).catch(() => undefined);

    logServerEvent('info', 'wallet.subscription_debit.completed', {
      userId,
      ledgerEntryId: transaction.id,
      amount,
      merchant: body.merchant,
    });

    return NextResponse.json({
      wallet: updatedWallet,
      transaction,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to record subscription debit';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'wallet.subscription_debit.failed', {
      userId,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

/**
 * DELETE /api/wallet/subscription-debit
 *
 * Refunds a subscription debit by recording a credit entry.
 * Used when signup finalization fails after the wallet was already debited.
 */
export async function DELETE(req: NextRequest) {
  const userId = await getWalletUserId();

  try {
    const body = (await req.json()) as {
      amount?: number;
      merchant?: string;
      reason?: string;
      idempotencyKey?: string;
    };

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'Valid amount is required', true),
        { status: 400 },
      );
    }

    const wallet = await getWallet(userId);
    const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : undefined;

    logServerEvent('info', 'wallet.subscription_refund.started', {
      userId,
      amount,
      merchant: body.merchant,
      reason: body.reason,
    });

    const transaction = await recordLedgerEntryUnique({
      userId,
      type: 'refund',
      amount,
      currency: wallet.currency.toLowerCase(),
      direction: 'credit',
      description: `Refund: ${body.merchant || 'subscription'} — ${body.reason || 'signup failed'}`,
      merchant: body.merchant,
      status: 'succeeded',
      stripeObjectId: idempotencyKey ? `subscription_refund:${idempotencyKey}` : undefined,
      metadata: {
        refund_reason: body.reason || 'signup_finalization_failed',
        subscription_merchant: body.merchant || '',
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      },
    });

    const updatedWallet = await getWallet(userId);

    await runRecoveryReconciliationCycle({
      userId,
      autoRecover: false,
      limit: 200,
    }).catch(() => undefined);

    logServerEvent('info', 'wallet.subscription_refund.completed', {
      userId,
      ledgerEntryId: transaction.id,
      amount,
    });

    return NextResponse.json({
      wallet: updatedWallet,
      transaction,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to process subscription refund';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'wallet.subscription_refund.failed', {
      userId,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
