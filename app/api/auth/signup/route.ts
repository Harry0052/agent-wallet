import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, createUserWithPassword, AuthError } from '@/lib/server/auth';
import { setSessionCookie } from '@/lib/server/authCookies';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import { getPostAuthRedirectPath } from '@/lib/server/onboarding';

export const runtime = 'nodejs';

const BodySchema = z.object({
  email: z.string().trim().email('A valid email is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());
    const meta = extractRequestMeta(req);
    const created = await createUserWithPassword({
      email: body.email,
      password: body.password,
    });

    const session = await createSession({
      appUserId: created.appUserId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    await recordAccountAuditEvent({
      userId: created.appUserId,
      action: 'signup',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { email: created.email },
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        email: created.email,
      },
      redirectTo: await getPostAuthRedirectPath(created.appUserId),
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
          : 'Failed to create account';

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
