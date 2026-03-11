import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, resetPasswordWithToken } from '@/lib/server/auth';
import { clearSessionCookie } from '@/lib/server/authCookies';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';

export const runtime = 'nodejs';

const BodySchema = z.object({
  token: z.string().trim().min(20, 'Reset token is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters.'),
}).refine((value) => value.password === value.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

export async function POST(req: NextRequest) {
  const meta = extractRequestMeta(req);

  try {
    const body = BodySchema.parse(await req.json());
    const result = await resetPasswordWithToken({
      token: body.token,
      newPassword: body.password,
    });

    await recordAccountAuditEvent({
      userId: result.appUserId,
      action: 'password_reset_completed',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const response = NextResponse.json({
      ok: true,
      message: 'Password updated successfully. You can now log in.',
    });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof AuthError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to reset password';

    const status = error instanceof z.ZodError
      ? 400
      : error instanceof AuthError
        ? error.status
        : 500;

    return NextResponse.json({
      ok: false,
      error: message,
    }, { status });
  }
}
