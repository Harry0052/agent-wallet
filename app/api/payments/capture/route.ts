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
import { runRecoveryReconciliationCycle } from '@/lib/reconciliation/reconcileFailedPurchases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  paymentId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1),
  activationVerified: z.boolean(),
  activationEvidence: z.record(z.string(), z.unknown()).optional(),
  activationFailureReason: z.string().trim().optional(),
  preferredPaymentMethodId: z.string().trim().optional(),
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
      // Reservation release for prepaid fallback is represented in two-phase events only.
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
    const result = await engine.capture({
      userId,
      paymentId: body.paymentId,
      idempotencyKey: body.idempotencyKey,
      activationVerified: body.activationVerified,
      activationEvidence: body.activationEvidence || null,
      activationFailureReason: body.activationFailureReason,
      prepaidAvailableBalance: wallet.balance,
    });

    await runRecoveryReconciliationCycle({
      userId,
      autoRecover: true,
      limit: 200,
    }).catch(() => undefined);

    logServerEvent('info', 'payments.capture.completed', {
      userId,
      paymentId: result.payment.id,
      status: result.payment.status,
      idempotentReplay: result.idempotentReplay,
      retryScheduled: Boolean(result.retryScheduled),
      nextRetryAt: result.nextRetryAt || null,
    });

    return NextResponse.json({
      ok: true,
      payment: result.payment,
      idempotentReplay: result.idempotentReplay,
      retryScheduled: result.retryScheduled || false,
      nextRetryAt: result.nextRetryAt || null,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to capture payment';
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'payments.capture.failed', {
      userId,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}
