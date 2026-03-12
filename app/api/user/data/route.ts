import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  AuthError,
  isAuthError,
  requireAuthenticatedUser,
  revokeCurrentSessionFromCookies,
  verifyPasswordForUser,
} from '@/lib/server/auth';
import { clearSessionCookie } from '@/lib/server/authCookies';
import { deleteUserAccountData } from '@/lib/server/accountLifecycle';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import { enforceRateLimit } from '@/security/rateLimiter';
import { RequestValidationError, validateJsonBody } from '@/security/requestValidator';
import {
  enforceSecurityIpBlock,
  monitorApiAbuse,
  resolveClientIp,
} from '@/security/securityMonitor';

export const runtime = 'nodejs';

const DeleteUserDataSchema = z.object({
  password: z.string().min(1, 'Current password is required.'),
  confirmText: z.string().refine((value) => value.trim().toUpperCase() === 'DELETE', {
    message: 'Type DELETE to confirm data deletion.',
  }),
});

function toErrorMessage(error: unknown): string {
  if (error instanceof RequestValidationError) return error.message;
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join('; ');
  if (isAuthError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return 'Failed to delete user data';
}

function toStatus(error: unknown): number {
  if (error instanceof RequestValidationError) return error.status;
  if (error instanceof z.ZodError) return 400;
  if (isAuthError(error)) return error.status;
  return 500;
}

export async function DELETE(req: NextRequest) {
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: 'auth', scope: 'auth' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(req),
      path: req.nextUrl.pathname,
      reason: 'user_data_deletion_rate_limited',
    });
    return rateLimited;
  }

  const meta = extractRequestMeta(req);

  try {
    const user = await requireAuthenticatedUser();
    const body = await validateJsonBody(req, DeleteUserDataSchema);

    await verifyPasswordForUser({
      appUserId: user.appUserId,
      password: body.password,
    });

    await recordAccountAuditEvent({
      userId: user.appUserId,
      action: 'user_data_delete_requested',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        request_source: 'api_user_data_delete',
      },
    });

    await deleteUserAccountData({
      appUserId: user.appUserId,
      walletUserId: user.walletUserId,
    });

    await revokeCurrentSessionFromCookies();

    await recordAccountAuditEvent({
      action: 'user_data_deleted',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        deletedAppUserId: user.appUserId,
        deletedWalletUserId: user.walletUserId,
      },
    });

    const response = NextResponse.json({
      ok: true,
      message: 'User data deleted successfully.',
    });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    if (
      error instanceof AuthError
      && error.status === 401
      && error.message === 'Password verification failed.'
    ) {
      return NextResponse.json({ ok: false, error: 'Current password is incorrect.' }, { status: 401 });
    }

    return NextResponse.json({
      ok: false,
      error: toErrorMessage(error),
    }, { status: toStatus(error) });
  }
}

