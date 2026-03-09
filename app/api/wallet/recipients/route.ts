import { NextRequest, NextResponse } from 'next/server';
import type { Recipient } from '@/lib/types';
import {
  addRecipient,
  getWallet,
  getWalletUserId,
  resolveRecipientByName,
  setRecipientStatus,
  upsertRecipientDelivery,
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
      sendMethod?: Recipient['sendMethod'];
      stripeAccountId?: string;
      cashAppCashtag?: string;
      bankReference?: string;
      aliases?: string[];
      status?: Recipient['status'];
      notes?: string;
    };
    const name = (body.name || '').trim();
    const sendMethod = body.sendMethod || 'stripe_connected';
    const stripeAccountId = (body.stripeAccountId || '').trim();
    const cashAppCashtag = (body.cashAppCashtag || '').trim();
    const bankReference = (body.bankReference || '').trim();

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    let recipient: Recipient;
    if (sendMethod === 'stripe_connected') {
      if (!stripeAccountId) {
        return NextResponse.json({ error: 'stripeAccountId is required for stripe recipients' }, { status: 400 });
      }
      recipient = await addRecipient(
        getWalletUserId(),
        name,
        stripeAccountId,
        body.status || 'approved',
        body.notes,
      );
    } else if (sendMethod === 'cash_app') {
      if (!cashAppCashtag) {
        return NextResponse.json({ error: 'cashAppCashtag is required for cash_app recipients' }, { status: 400 });
      }
      recipient = await upsertRecipientDelivery({
        userId: getWalletUserId(),
        name,
        sendMethod,
        cashAppCashtag,
        aliases: body.aliases,
        notes: body.notes,
        status: body.status || 'approved',
      });
    } else if (sendMethod === 'bank') {
      if (!bankReference) {
        return NextResponse.json({ error: 'bankReference is required for bank recipients' }, { status: 400 });
      }
      recipient = await upsertRecipientDelivery({
        userId: getWalletUserId(),
        name,
        sendMethod,
        bankReference,
        aliases: body.aliases,
        notes: body.notes,
        status: body.status || 'approved',
      });
    } else {
      return NextResponse.json({ error: 'Unsupported sendMethod' }, { status: 400 });
    }

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
