import { NextRequest, NextResponse } from 'next/server';
import {
  checkGuardrails,
  getWallet,
  getWalletUserId,
  recordLedgerEntry,
} from '@/lib/server/ledger';
import { getStripeClient } from '@/lib/server/stripe';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = getWalletUserId();
  let attemptedAmount = 0;
  let attemptedCurrency = 'usd';

  try {
    const body = (await req.json()) as {
      amount?: number;
      recipientId?: string;
      recipientName?: string;
      merchant?: string;
      sourceUrl?: string;
      description?: string;
      approved?: boolean;
    };

    const amount = Number(body.amount);
    attemptedAmount = Number.isFinite(amount) ? amount : 0;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }

    const wallet = await getWallet(userId);
    attemptedCurrency = wallet.currency.toLowerCase();
    if (amount >= wallet.settings.approvalThreshold && body.approved !== true) {
      return NextResponse.json(
        { error: `Approval required for amounts at/above $${wallet.settings.approvalThreshold.toFixed(2)}` },
        { status: 400 },
      );
    }

    const check = await checkGuardrails({
      userId,
      amount,
      merchant: body.merchant,
      recipientId: body.recipientId,
      recipientName: body.recipientName,
    });

    if (!check.allowed || !check.recipient) {
      return NextResponse.json({ error: check.reason || 'Transfer blocked by guardrails' }, { status: 400 });
    }

    const stripe = getStripeClient();
    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: wallet.currency.toLowerCase(),
      destination: check.recipient.stripeAccountId,
      description: body.description || `Wallet send to ${check.recipient.name}`,
      metadata: {
        wallet_action: 'send',
        wallet_user_id: userId,
        wallet_recipient_id: check.recipient.id,
      },
    });

    const transaction = await recordLedgerEntry({
      userId,
      type: 'send',
      amount,
      currency: wallet.currency.toLowerCase(),
      direction: 'debit',
      stripeObjectId: transfer.id,
      description: body.description || `Sent to ${check.recipient.name}`,
      merchant: body.merchant,
      recipientId: check.recipient.id,
      status: 'succeeded',
      source: 'connect-transfer',
      sourceUrl: body.sourceUrl,
      metadata: {
        recipient_name: check.recipient.name,
      },
    });

    const updatedWallet = await getWallet(userId);
    return NextResponse.json({ wallet: updatedWallet, transaction, payoutStatus: 'succeeded' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send money';

    if (attemptedAmount > 0) {
      await recordLedgerEntry({
        userId,
        type: 'send',
        amount: attemptedAmount,
        currency: attemptedCurrency,
        direction: 'debit',
        description: `Send failed: ${message}`,
        status: 'failed',
        source: 'connect-transfer',
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
