import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { getStripeClient } from '@/lib/server/stripe';
import {
  createPostgresRefundStore,
  createRefundEngine,
  type MerchantRefundAdapter,
  type ProcessorFallbackAdapter,
} from '@/lib/refunds/refundEngine.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const QuerySchema = z.object({
  paymentFlowId: z.string().trim().optional(),
  refundCaseId: z.string().trim().optional(),
});

const SchedulerBodySchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
});

const merchantHttpRefundAdapter: MerchantRefundAdapter = {
  id: 'merchant-http-refund',
  supports(payment) {
    return typeof payment.metadata?.merchant_refund_url === 'string';
  },
  async requestRefund(input) {
    const url = typeof input.payment.metadata?.merchant_refund_url === 'string'
      ? input.payment.metadata.merchant_refund_url
      : null;
    if (!url) {
      return {
        status: 'unavailable',
        message: 'No merchant refund URL configured for this payment.',
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-wallet-idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        paymentFlowId: input.payment.paymentFlowId,
        amount: input.payment.amount,
        currency: input.payment.currency,
        reason: input.reason,
      }),
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        return {
          status: 'unavailable',
          message: `Merchant refund endpoint unavailable (${response.status}).`,
        };
      }
      throw new Error(`Merchant refund endpoint failed (${response.status})`);
    }

    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      referenceId?: string;
      message?: string;
      retryAfterMs?: number;
    };
    const status = String(payload.status || '').toLowerCase();
    if (status === 'completed') {
      return {
        status: 'completed',
        referenceId: payload.referenceId || `merchant_ref_${input.refundCase.id}`,
        message: payload.message || 'Merchant confirmed refund completion.',
      };
    }
    return {
      status: 'in_progress',
      referenceId: payload.referenceId,
      message: payload.message || 'Merchant refund request accepted.',
      retryAfterMs: typeof payload.retryAfterMs === 'number' ? payload.retryAfterMs : undefined,
    };
  },
};

const stripeProcessorFallback: ProcessorFallbackAdapter = {
  id: 'stripe-processor-fallback',
  async submitDisputePacket(input) {
    if (!input.payment.stripePaymentIntentId) {
      return {
        submitted: false,
        message: 'No processor payment intent available for fallback submission.',
      };
    }

    const refund = await getStripeClient().refunds.create(
      {
        payment_intent: input.payment.stripePaymentIntentId,
        reason: 'requested_by_customer',
        metadata: {
          refund_case_id: input.refundCase.id,
          payment_flow_id: input.payment.paymentFlowId,
          evidence_packet_id: input.evidencePack.packetId,
          evidence_hash: input.evidencePack.hash,
        },
      },
      {
        idempotencyKey: input.idempotencyKey,
      },
    );

    return {
      submitted: true,
      referenceId: refund.id,
      disputeId: refund.id,
      message: 'Processor-side refund/dispute packet submitted to Stripe.',
      raw: {
        refundId: refund.id,
      },
    };
  },
};

function buildEngine() {
  return createRefundEngine({
    store: createPostgresRefundStore(),
    merchantAdapters: [merchantHttpRefundAdapter],
    processorFallback: stripeProcessorFallback,
    logger: {
      info: (event, payload) => logServerEvent('info', event, payload),
      warn: (event, payload) => logServerEvent('warn', event, payload),
      error: (event, payload) => logServerEvent('error', event, payload),
    },
  });
}

export async function GET(req: NextRequest) {
  const userId = getWalletUserId();
  try {
    const query = QuerySchema.parse({
      paymentFlowId: req.nextUrl.searchParams.get('paymentFlowId') || undefined,
      refundCaseId: req.nextUrl.searchParams.get('refundCaseId') || undefined,
    });

    if (!query.paymentFlowId && !query.refundCaseId) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', 'paymentFlowId or refundCaseId is required', true),
        { status: 400 },
      );
    }

    const engine = buildEngine();
    const status = await engine.getRefundStatus({
      userId,
      paymentFlowId: query.paymentFlowId,
      refundCaseId: query.refundCaseId,
    });

    if (!status) {
      return NextResponse.json(
        apiError('NOT_FOUND', 'Refund case not found', true),
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      refundCase: status.refundCase,
      auditLogs: status.auditLogs,
      userExplanation: status.userExplanation,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to fetch refund status';
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'refunds.status.failed', {
      userId,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}

export async function POST(req: NextRequest) {
  const userId = getWalletUserId();
  try {
    const body = SchedulerBodySchema.parse(await req.json().catch(() => ({})));
    const engine = buildEngine();
    const result = await engine.runScheduler({
      userId,
      limit: body.limit,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      ranAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to run refund scheduler';
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'refunds.scheduler.failed', {
      userId,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}
