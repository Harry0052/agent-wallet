import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWallet, getWalletUserId, recordLedgerEntryUnique } from '@/lib/server/ledger';
import {
  getDefaultSavedPaymentMethodForUser,
  getSavedPaymentMethodForUser,
} from '@/lib/server/fundingPaymentMethods';
import { getStripeClient } from '@/lib/server/stripe';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { createPostgresTwoPhaseStore } from '@/lib/payments/ledger';
import { sanitizePaymentForClient } from '@/lib/payments/publicPayment';
import { createStripeFirstGateway, createTwoPhasePaymentEngine } from '@/lib/payments/twoPhasePayment';
import { enforceRateLimit } from '@/security/rateLimiter';
import { enforceTransactionGuardrails } from '@/security/transactionGuard';
import {
  enforceSecurityIpBlock,
  monitorApiAbuse,
  monitorGuardrailViolation,
  monitorTransactionBehavior,
  resolveClientIp,
} from '@/security/securityMonitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  merchant: z.string().trim().min(1),
  category: z.string().trim().optional(),
  amount: z.number().positive(),
  currency: z.string().trim().default('usd'),
  taskId: z.string().trim().optional(),
  idempotencyKey: z.string().trim().min(1),
  fundingMode: z.enum(['STRIPE_AUTH_CAPTURE', 'PREPAID_BALANCE']).optional(),
  allowPrepaidFallback: z.boolean().default(true),
  requiresActivationVerification: z.boolean().default(true),
  approved: z.boolean().optional(),
  preferredPaymentMethodId: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function buildEngine() {
  const store = createPostgresTwoPhaseStore();
  const gateway = createStripeFirstGateway({
    stripe: getStripeClient(),
    async resolvePaymentMethod(input) {
      const preferred = input.preferredPaymentMethodId?.trim() || null;
      const saved = preferred
        ? await getSavedPaymentMethodForUser({
          userId: input.userId,
          stripePaymentMethodId: preferred,
        })
        : await getDefaultSavedPaymentMethodForUser(input.userId);

      if (!saved) {
        throw new Error('No active saved payment method is available for Stripe authorization');
      }

      return {
        customerId: saved.stripeCustomerId,
        paymentMethodId: saved.stripePaymentMethodId,
      };
    },
    async captureReservedBalance(input) {
      await recordLedgerEntryUnique({
        userId: input.userId,
        type: 'subscription_debit',
        amount: input.amount,
        currency: input.currency,
        direction: 'debit',
        status: 'succeeded',
        source: 'connect-transfer',
        stripeObjectId: `two_phase_capture:${input.paymentId}`,
        description: `Two-phase capture: ${input.merchant}`,
        merchant: input.merchant,
        metadata: {
          payment_flow_id: input.paymentId,
          idempotency_key: input.idempotencyKey,
        },
      });
    },
    async releaseReservedBalance() {
      // Reservation release for prepaid fallback is represented in two-phase
      // payment events; no wallet debit was performed before capture.
    },
  });

  return createTwoPhasePaymentEngine({
    store,
    gateway,
    logger: {
      info: (event, data) => logServerEvent('info', event, data),
      warn: (event, data) => logServerEvent('warn', event, data),
      error: (event, data) => logServerEvent('error', event, data),
    },
  });
}

export async function POST(req: NextRequest) {
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'payments' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(req),
      path: req.nextUrl.pathname,
      reason: 'payments_authorize_rate_limited',
    });
    return rateLimited;
  }

  const userId = await getWalletUserId();

  try {
    const body = BodySchema.parse(await req.json());
    const wallet = await getWallet(userId);
    const ip = resolveClientIp(req);
    monitorTransactionBehavior({
      userId,
      ip,
      amount: body.amount,
      merchant: body.merchant,
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

    const transactionGuard = enforceTransactionGuardrails({
      userId,
      context: 'payments.authorize',
      amount: body.amount,
      wallet,
      merchant: body.merchant,
      category: body.category,
      approved: body.approved,
      enforceConfirmation: true,
    });

    if (!transactionGuard.allowed) {
      monitorGuardrailViolation({
        userId,
        ip,
        context: 'payments.authorize',
        reason: transactionGuard.reason || 'authorization_blocked',
        amount: body.amount,
        merchant: body.merchant,
      });
      return NextResponse.json(
        apiError('POLICY_FAILURE', transactionGuard.reason || 'Payment authorization blocked by guardrails', true),
        { status: 409 },
      );
    }

    const engine = buildEngine();
    const result = await engine.authorize({
      userId,
      taskId: body.taskId || null,
      merchant: body.merchant,
      amount: body.amount,
      currency: body.currency,
      idempotencyKey: body.idempotencyKey,
      fundingMode: body.fundingMode,
      allowPrepaidFallback: body.allowPrepaidFallback,
      prepaidAvailableBalance: wallet.balance,
      requiresActivationVerification: body.requiresActivationVerification,
      preferredPaymentMethodId: body.preferredPaymentMethodId,
      metadata: {
        ...(body.metadata || {}),
        ...(body.category ? { transaction_category: body.category } : {}),
        user_approved: body.approved === true,
      },
    });

    logServerEvent('info', 'payments.authorize.completed', {
      userId,
      paymentId: result.payment.id,
      merchant: result.payment.merchant,
      amount: result.payment.amount,
      fundingMode: result.payment.fundingMode,
      status: result.payment.status,
      idempotentReplay: result.idempotentReplay,
    });

    return NextResponse.json({
      ok: true,
      payment: sanitizePaymentForClient(result.payment),
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      monitorApiAbuse({
        userId,
        ip: resolveClientIp(req),
        path: req.nextUrl.pathname,
        reason: 'malformed_payment_authorize_request',
      });
    }

    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to authorize payment';
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'payments.authorize.failed', {
      userId,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}
