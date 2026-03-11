import { NextResponse } from 'next/server';
import { getWallet, getWalletUserId } from '@/lib/server/ledger';
import { isAuthError } from '@/lib/server/auth';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = await getWalletUserId();
    const wallet = await getWallet(userId);
    return NextResponse.json(wallet);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', error.message, true),
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to load wallet';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'wallet.get.failed', { errorCode, message });
    return NextResponse.json(
      apiError(errorCode, message, true),
      { status: 500 },
    );
  }
}
