import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateWithPassword, createSession, AuthError } from '@/lib/server/auth';
import { setSessionCookie } from '@/lib/server/authCookies';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import { getPostAuthRedirectPath } from '@/lib/server/onboarding';

export const runtime = 'nodejs';

const BodySchema = z.object({
  email: z.string().trim().email('A valid email is required.'),
  password: z.string().min(1, 'Password is required.'),
});

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());
    const meta = extractRequestMeta(req);
    const user = await authenticateWithPassword({
      email: body.email,
      password: body.password,
    });

    const session = await createSession({
      appUserId: user.appUserId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    await recordAccountAuditEvent({
      userId: user.appUserId,
      action: 'login',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { email: user.email },
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        email: user.email,
      },
      redirectTo: await getPostAuthRedirectPath(user.appUserId),
    });

    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof AuthError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to login';

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
