import { NextRequest, NextResponse } from 'next/server';
import type { WalletSettings } from '@/lib/types';
import { getWalletUserId, updateWalletSettings } from '@/lib/server/ledger';
import { isAuthError } from '@/lib/server/auth';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<WalletSettings>;
    const wallet = await updateWalletSettings(await getWalletUserId(), body);
    return NextResponse.json(wallet);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to update settings';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'wallet.settings.failed', { errorCode, message });
    return NextResponse.json(
      apiError(errorCode, message, true),
      { status: 500 },
    );
  }
}
