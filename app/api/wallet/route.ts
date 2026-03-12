import { NextRequest, NextResponse } from 'next/server';
import type { Recipient } from '@/lib/types';
import { getWallet } from '@/lib/server/ledger';
import { isAuthError } from '@/lib/server/auth';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';

export const runtime = 'nodejs';

function maskBankReference(value: string | null | undefined): string | null {
  const normalized = value?.trim() || '';
  if (!normalized) return null;
  if (normalized.length <= 4) return '[REDACTED]';
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;
}

function sanitizeRecipientForClient(recipient: Recipient): Recipient {
  if (recipient.sendMethod !== 'bank') return recipient;
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
    const wallet = await getWallet(userId);
    return NextResponse.json({
      ...wallet,
      recipients: wallet.recipients.map(sanitizeRecipientForClient),
    });
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
