import { NextRequest, NextResponse } from 'next/server';
import type { WalletSettings } from '@/lib/types';
import { getWalletUserId, updateWalletSettings } from '@/lib/server/ledger';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<WalletSettings>;
    const wallet = await updateWalletSettings(getWalletUserId(), body);
    return NextResponse.json(wallet);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 },
    );
  }
}
