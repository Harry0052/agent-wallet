import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  checkGuardrails,
  getWallet,
  recordLedgerEntry,
  recordLedgerEntryUnique,
} from '@/lib/server/ledger';
import { isAuthError } from '@/lib/server/auth';
import { getStripeClient } from '@/lib/server/stripe';
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

const BodySchema = z.object({
  amount: z.union([z.number(), z.string()]),
  recipientId: z.string().trim().min(1).optional(),
  recipientName: z.string().trim().min(1).optional(),
  merchant: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  approved: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});

function maskBankReference(value: string | null | undefined): string | null {
  const normalized = value?.trim() || '';
  if (!normalized) return null;
  if (normalized.length <= 4) return '[REDACTED]';
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;
}

export async function POST(req: NextRequest) {
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'wallet' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(req),
      path: req.nextUrl.pathname,
      reason: 'wallet_send_rate_limited',
    });
    return rateLimited;
  }

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  const userId = auth.auth.walletUserId;
  let attemptedAmount = 0;
  let attemptedCurrency = 'usd';

  try {
    const body = await validateJsonBody(req, BodySchema);
    const ip = resolveClientIp(req);

    const amount = Number(body.amount);
    attemptedAmount = Number.isFinite(amount) ? amount : 0;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(apiError('VALIDATION_ERROR', 'Valid amount is required', true), { status: 400 });
    }

    const wallet = await getWallet(userId);
    attemptedCurrency = wallet.currency.toLowerCase();
    monitorTransactionBehavior({
      userId,
      ip,
      amount,
      merchant: body.merchant || body.recipientName || null,
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

    const check = await checkGuardrails({
      userId,
      amount,
      merchant: body.merchant,
      category: body.category,
      recipientId: body.recipientId,
      recipientName: body.recipientName,
      approved: body.approved,
      enforceConfirmation: true,
    });

    if (!check.allowed || !check.recipient) {
      monitorGuardrailViolation({
        userId,
        ip,
        context: 'wallet.send',
        reason: check.reason || 'transfer_blocked',
        amount,
        merchant: body.merchant || body.recipientName || null,
      });
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
      const maskedBankReference = maskBankReference(recipient.bankReference || null);
      const message = recipient.bankReference
        ? `Bank recipient ${recipient.name} is saved (${maskedBankReference}), but automated bank send execution is not implemented yet.`
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
        ...(body.category ? { category: body.category } : {}),
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
    if (error instanceof RequestValidationError) {
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
