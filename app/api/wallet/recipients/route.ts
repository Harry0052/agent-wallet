import { NextRequest, NextResponse } from 'next/server';
import type { Recipient } from '@/lib/types';
import {
  addRecipient,
  getWallet,
  getWalletUserId,
  resolveRecipientByName,
  setRecipientStatus,
} from '@/lib/server/ledger';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const userId = getWalletUserId();
    const name = req.nextUrl.searchParams.get('name');
    if (name && name.trim()) {
      const recipient = await resolveRecipientByName(userId, name.trim());
      return NextResponse.json({ recipient });
    }

    const wallet = await getWallet(userId);
    return NextResponse.json({ recipients: wallet.recipients });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list recipients' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string;
      stripeAccountId?: string;
      status?: Recipient['status'];
      notes?: string;
    };
    const name = (body.name || '').trim();
    const stripeAccountId = (body.stripeAccountId || '').trim();

    if (!name || !stripeAccountId) {
      return NextResponse.json({ error: 'name and stripeAccountId are required' }, { status: 400 });
    }

    const recipient = await addRecipient(
      getWalletUserId(),
      name,
      stripeAccountId,
      body.status || 'approved',
      body.notes,
    );
    return NextResponse.json({ recipient });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add recipient' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { recipientId?: string; status?: Recipient['status'] };
    if (!body.recipientId || !body.status) {
      return NextResponse.json({ error: 'recipientId and status are required' }, { status: 400 });
    }

    const recipient = await setRecipientStatus(getWalletUserId(), body.recipientId, body.status);
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
    }

    return NextResponse.json({ recipient });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update recipient' },
      { status: 500 },
    );
  }
}
