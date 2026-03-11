import { NextResponse } from 'next/server';
import { isAuthError } from '@/lib/server/auth';
import { getWallet, getWalletUserId } from '@/lib/server/ledger';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const userId = await getWalletUserId();
    const wallet = await getWallet(userId);
    return NextResponse.json({
      ok: true,
      wallet,
      initialized: true,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }

    const message = error instanceof Error ? error.message : 'Failed to initialize wallet';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'wallet.init.failed', { errorCode, message });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
