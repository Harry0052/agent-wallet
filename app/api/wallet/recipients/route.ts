import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Recipient } from '@/lib/types';
import { isAuthError } from '@/lib/server/auth';
import {
  addRecipient,
  getWallet,
  resolveRecipientByName,
  setRecipientStatus,
  upsertRecipientDelivery,
} from '@/lib/server/ledger';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import {
  RequestValidationError,
  validateJsonBody,
  validateSearchParams,
} from '@/security/requestValidator';

export const runtime = 'nodejs';

const RecipientQuerySchema = z.object({
  name: z.string().trim().optional(),
});

const CreateRecipientSchema = z.object({
  name: z.string().trim().min(1),
  sendMethod: z.enum(['cash_app', 'stripe_connected', 'bank']).optional(),
  stripeAccountId: z.string().trim().optional(),
  cashAppCashtag: z.string().trim().optional(),
  bankReference: z.string().trim().optional(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  status: z.enum(['approved', 'blocked', 'pending']).optional(),
  notes: z.string().trim().optional(),
});

const UpdateRecipientSchema = z.object({
  recipientId: z.string().trim().min(1),
  status: z.enum(['approved', 'blocked', 'pending']),
});

function maskBankReference(value: string | null | undefined): string | null {
  const normalized = value?.trim() || '';
  if (!normalized) return null;
  if (normalized.length <= 4) return '[REDACTED]';
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;
}

function sanitizeRecipientForClient(recipient: Recipient): Recipient {
  if (recipient.sendMethod !== 'bank') {
    return recipient;
  }

  return {
    ...recipient,
    bankReference: maskBankReference(recipient.bankReference || null),
  };
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'wallet' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const query = validateSearchParams(req.nextUrl.searchParams, RecipientQuerySchema);
    const name = query.name;
    if (name && name.trim()) {
      const recipient = await resolveRecipientByName(userId, name.trim());
      return NextResponse.json({
        recipient: recipient ? sanitizeRecipientForClient(recipient) : null,
      });
    }

    const wallet = await getWallet(userId);
    return NextResponse.json({
      recipients: wallet.recipients.map(sanitizeRecipientForClient),
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list recipients' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'wallet' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await validateJsonBody(req, CreateRecipientSchema);
    const name = body.name.trim();
    const sendMethod = body.sendMethod || 'stripe_connected';
    const stripeAccountId = (body.stripeAccountId || '').trim();
    const cashAppCashtag = (body.cashAppCashtag || '').trim();
    const bankReference = (body.bankReference || '').trim();

    let recipient: Recipient;
    if (sendMethod === 'stripe_connected') {
      if (!stripeAccountId) {
        return NextResponse.json({ error: 'stripeAccountId is required for stripe recipients' }, { status: 400 });
      }
      recipient = await addRecipient(
        auth.auth.walletUserId,
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
        userId: auth.auth.walletUserId,
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
        userId: auth.auth.walletUserId,
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

    return NextResponse.json({
      recipient: sanitizeRecipientForClient(recipient),
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add recipient' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'wallet' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await validateJsonBody(req, UpdateRecipientSchema);

    const recipient = await setRecipientStatus(auth.auth.walletUserId, body.recipientId, body.status);
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
    }

    return NextResponse.json({
      recipient: sanitizeRecipientForClient(recipient),
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update recipient' },
      { status: 500 },
    );
  }
}
