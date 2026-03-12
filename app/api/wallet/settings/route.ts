import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { WalletSettings } from '@/lib/types';
import { updateWalletSettings } from '@/lib/server/ledger';
import { isAuthError } from '@/lib/server/auth';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { RequestValidationError, validateJsonBody } from '@/security/requestValidator';

export const runtime = 'nodejs';

const SettingsPatchSchema = z.object({
  maxTransaction: z.number().finite().nonnegative().optional(),
  dailyLimit: z.number().finite().nonnegative().optional(),
  monthlyBudget: z.number().finite().nonnegative().optional(),
  approvalThreshold: z.number().finite().nonnegative().optional(),
  requireLocation: z.boolean().optional(),
  allowedMerchants: z.array(z.string().trim().min(1)).optional(),
  blockedMerchants: z.array(z.string().trim().min(1)).optional(),
});

export async function PATCH(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'general', scope: 'wallet' });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await validateJsonBody(req, SettingsPatchSchema) as Partial<WalletSettings>;
    const wallet = await updateWalletSettings(auth.auth.walletUserId, body);
    return NextResponse.json(wallet);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError('VALIDATION_ERROR', error.message, true), { status: error.status });
    }
    if (error instanceof RequestValidationError) {
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
