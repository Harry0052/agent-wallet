import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError } from '@/lib/server/auth';
import {
  checkSubscriptionGuardrails,
  getWallet,
  recordLedgerEntryUnique,
} from '@/lib/server/ledger';
import { runRecoveryReconciliationCycle } from '@/lib/reconciliation/reconcileFailedPurchases';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { RequestValidationError, validateJsonBody } from '@/security/requestValidator';
import {
  enforceSecurityIpBlock,
  monitorApiAbuse,
  monitorGuardrailViolation,
  monitorTransactionBehavior,
  resolveClientIp,
} from '@/security/securityMonitor';

export const runtime = 'nodejs';

const SubscriptionDebitBodySchema = z.object({
  amount: z.union([z.number(), z.string()]),
  merchant: z.string().trim().optional(),
  category: z.string().trim().optional(),
  description: z.string().trim().optional(),
  approved: z.boolean().optional(),
  idempotencyKey: z.string().trim().optional(),
});

const SubscriptionRefundBodySchema = z.object({
  amount: z.union([z.number(), z.string()]),
  merchant: z.string().trim().optional(),
  reason: z.string().trim().optional(),
  idempotencyKey: z.string().trim().optional(),
});

/**
 * POST /api/wallet/subscription-debit
 *
 * Records a ledger-only debit for subscription payments.
 * Unlike /api/wallet/send, this does NOT require a Stripe Connect recipient —
 * the subscription service itself handles the actual charge.
 */
export async function POST(req: NextRequest) {
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'wallet' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(req),
      path: req.nextUrl.pathname,
      reason: 'subscription_debit_rate_limited',
    });
    return rateLimited;
  }

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  const userId = auth.auth.walletUserId;

  try {
    const body = await validateJsonBody(req, SubscriptionDebitBodySchema);
    const ip = resolveClientIp(req);

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
    monitorTransactionBehavior({
      userId,
      ip,
      amount,
      merchant: body.merchant || null,
      category: body.category || null,
      wallet: {
        balance: wallet.balance,
        settings: {
          maxTransaction: wallet.settings.maxTransaction,
          dailyLimit: wallet.settings.dailyLimit,
        },
        transactions: wallet.transactions.map((tx) => ({
          amount: tx.amount,
          status: tx.status,
          direction: tx.direction,
          createdAt: tx.createdAt,
        })),
      },
    });

    const check = await checkSubscriptionGuardrails({
      userId,
      amount,
      merchant: body.merchant,
      category: body.category,
      approved: body.approved,
      enforceConfirmation: true,
    });

    if (!check.allowed) {
      monitorGuardrailViolation({
        userId,
        ip,
        context: 'wallet.subscription_debit',
        reason: check.reason || 'subscription_debit_blocked',
        amount,
        merchant: body.merchant || null,
      });
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
        subscription_category: body.category || '',
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
    if (error instanceof RequestValidationError) {
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
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'wallet' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(req),
      path: req.nextUrl.pathname,
      reason: 'subscription_refund_rate_limited',
    });
    return rateLimited;
  }

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  const userId = auth.auth.walletUserId;

  try {
    const body = await validateJsonBody(req, SubscriptionRefundBodySchema);

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
    if (error instanceof RequestValidationError) {
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
