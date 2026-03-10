import { NextResponse } from 'next/server';
import { getWalletUserId } from '@/lib/server/ledger';
import { listUserTools } from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = getWalletUserId();
    const tools = await listUserTools(userId);

    return NextResponse.json({
      ok: true,
      tools,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load user tools';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'tools.list.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
