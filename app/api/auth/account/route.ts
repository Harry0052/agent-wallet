import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  isAuthError,
  requireAuthenticatedUser,
  revokeCurrentSessionFromCookies,
} from '@/lib/server/auth';
import { clearSessionCookie } from '@/lib/server/authCookies';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import { deleteUserAccountData } from '@/lib/server/accountLifecycle';
import { enforceRateLimit } from '@/security/rateLimiter';
import { RequestValidationError, validateJsonBody } from '@/security/requestValidator';

export const runtime = 'nodejs';

const DeleteSchema = z.object({
  confirmText: z.string().refine((value) => value.trim().toUpperCase() === 'DELETE', {
    message: 'Type DELETE to confirm account deletion.',
  }),
});

function toErrorMessage(error: unknown): string {
  if (error instanceof RequestValidationError) {
    return error.message;
  }
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join('; ');
  }
  if (isAuthError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return 'Failed to delete account';
}

function toStatus(error: unknown): number {
  if (error instanceof RequestValidationError) return error.status;
  if (error instanceof z.ZodError) return 400;
  if (isAuthError(error)) return error.status;
  return 500;
}

export async function DELETE(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'auth', scope: 'auth' });
  if (rateLimited) return rateLimited;

  const meta = extractRequestMeta(req);

  try {
    const user = await requireAuthenticatedUser();
    await validateJsonBody(req, DeleteSchema);

    await recordAccountAuditEvent({
      userId: user.appUserId,
      action: 'account_delete_requested',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        request_source: 'api_auth_account_delete',
      },
    });

    await deleteUserAccountData({
      appUserId: user.appUserId,
      walletUserId: user.walletUserId,
    });

    await revokeCurrentSessionFromCookies();

    await recordAccountAuditEvent({
      action: 'account_deleted',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        deletedAppUserId: user.appUserId,
        deletedWalletUserId: user.walletUserId,
      },
    });

    const response = NextResponse.json({
      ok: true,
      message: 'Account deleted successfully.',
    });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: toErrorMessage(error),
    }, { status: toStatus(error) });
  }
}
