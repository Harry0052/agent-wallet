import { NextResponse } from 'next/server';
import { getWallet, getWalletUserId } from '@/lib/server/ledger';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = getWalletUserId();
    const wallet = await getWallet(userId);
    return NextResponse.json(wallet);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load wallet';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'wallet.get.failed', { errorCode, message });
    return NextResponse.json(
      apiError(errorCode, message, true),
      { status: 500 },
    );
  }
}
