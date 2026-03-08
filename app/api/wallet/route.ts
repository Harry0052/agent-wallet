import { NextResponse } from 'next/server';
import { getWallet, getWalletUserId } from '@/lib/server/ledger';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const wallet = await getWallet(getWalletUserId());
    return NextResponse.json(wallet);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load wallet' },
      { status: 500 },
    );
  }
}
