import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWalletUserId } from '@/lib/server/ledger';
import { isAuthError } from '@/lib/server/auth';
import { getToolConfigForUser, upsertToolConfigForUser } from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  config: z.record(z.string(), z.unknown()),
});

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const userId = await getWalletUserId();
    const config = await getToolConfigForUser({
      userId,
      userToolId: id,
    });

    return NextResponse.json({
      ok: true,
      config,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }

    const message = error instanceof Error ? error.message : 'Failed to load tool config';
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'tools.config.get.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = PatchSchema.parse(await req.json());
    const userId = await getWalletUserId();

    const config = await upsertToolConfigForUser({
      userId,
      userToolId: id,
      config: body.config,
    });

    return NextResponse.json({
      ok: true,
      config,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }

    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to update tool config';
    const status = error instanceof z.ZodError
      ? 400
      : message.toLowerCase().includes('not found')
        ? 404
        : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'tools.config.patch.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
