import { NextResponse } from 'next/server';
import { isAuthError } from '@/lib/server/auth';
import { getWalletUserId } from '@/lib/server/ledger';
import { listToolEvents } from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const userId = await getWalletUserId();
    const events = await listToolEvents({
      userId,
      userToolId: id,
      limit: 25,
    });

    return NextResponse.json({
      ok: true,
      events,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to load tool events';
    const errorCode = classifyTaskError({ message });
    const status = message.toLowerCase().includes('not found') ? 404 : 500;

    logServerEvent('error', 'tools.events.failed', {
      status,
      errorCode,
      message,
    });

    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
