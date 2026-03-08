import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAgentRuntime } from '@/lib/agent/runtime';
import { getWalletUserId } from '@/lib/server/ledger';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const BodySchema = z.object({
  message: z.string().trim().min(1, 'message is required'),
});

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());
    const userId = getWalletUserId();
    const orchestration = await runAgentRuntime({
      userId,
      prompt: body.message,
    });

    return NextResponse.json({
      ok: true,
      orchestration,
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to orchestrate agent task';
    const status = error instanceof z.ZodError
      ? 400
      : message.includes('Claude')
        ? 502
        : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'agent.orchestrate.failed', {
      status,
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
