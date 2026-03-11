import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError } from '@/lib/server/auth';
import { getWalletUserId } from '@/lib/server/ledger';
import { removeTool } from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const BodySchema = z.object({
  deleteSecrets: z.boolean().optional(),
});

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const userId = await getWalletUserId();

    await removeTool({
      userId,
      userToolId: id,
      deleteSecrets: body.deleteSecrets,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to remove tool';
    const status = error instanceof z.ZodError
      ? 400
      : message.toLowerCase().includes('not found')
        ? 404
        : 500;
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });

    logServerEvent('error', 'tools.remove.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
