import { NextResponse } from 'next/server';
import { isAuthError } from '@/lib/server/auth';
import { getWalletUserId } from '@/lib/server/ledger';
import { listUserTools } from '@/lib/server/toolsVault';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = await getWalletUserId();
    const tools = await listUserTools(userId);

    return NextResponse.json({
      ok: true,
      tools,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to load user tools';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'tools.list.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
