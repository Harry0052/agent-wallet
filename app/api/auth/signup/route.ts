import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, createUserWithPassword, AuthError } from '@/lib/server/auth';
import { setSessionCookie } from '@/lib/server/authCookies';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import { getPostAuthRedirectPath } from '@/lib/server/onboarding';
import { enforceRateLimit } from '@/security/rateLimiter';
import { RequestValidationError, validateJsonBody } from '@/security/requestValidator';
import {
  enforceSecurityIpBlock,
  monitorApiAbuse,
  resolveClientIp,
} from '@/security/securityMonitor';

export const runtime = 'nodejs';

const BodySchema = z.object({
  email: z.string().trim().email('A valid email is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export async function POST(req: NextRequest) {
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: 'auth', scope: 'auth' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(req),
      path: req.nextUrl.pathname,
      reason: 'signup_rate_limit_exceeded',
    });
    return rateLimited;
  }

  try {
    const body = await validateJsonBody(req, BodySchema);
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
      : error instanceof RequestValidationError
        ? error.message
      : error instanceof AuthError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create account';

    const status = error instanceof z.ZodError
      ? 400
      : error instanceof RequestValidationError
        ? error.status
      : error instanceof AuthError
        ? error.status
        : 500;

    return NextResponse.json({
      ok: false,
      error: message,
    }, { status });
  }
}
