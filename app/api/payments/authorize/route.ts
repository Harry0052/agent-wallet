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
import { createStripeFirstGateway, createTwoPhasePaymentEngine } from '@/lib/payments/twoPhasePayment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  merchant: z.string().trim().min(1),
  amount: z.number().positive(),
  currency: z.string().trim().default('usd'),
  taskId: z.string().trim().optional(),
  idempotencyKey: z.string().trim().min(1),
  fundingMode: z.enum(['STRIPE_AUTH_CAPTURE', 'PREPAID_BALANCE']).optional(),
  allowPrepaidFallback: z.boolean().default(true),
  requiresActivationVerification: z.boolean().default(true),
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
  const userId = await getWalletUserId();

  try {
    const body = BodySchema.parse(await req.json());
    const wallet = await getWallet(userId);

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
      metadata: body.metadata || null,
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
      payment: result.payment,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
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
