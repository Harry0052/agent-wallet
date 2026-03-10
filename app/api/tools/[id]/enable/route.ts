import { NextRequest, NextResponse } from 'next/server';
import { getWalletUserId } from '@/lib/server/ledger';
import { setToolEnabled } from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const userId = getWalletUserId();
    const tool = await setToolEnabled({
      userId,
      userToolId: id,
      enabled: true,
    });

    return NextResponse.json({ ok: true, tool });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enable tool';
    const errorCode = classifyTaskError({ message });
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    logServerEvent('error', 'tools.enable.failed', { status, errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
