import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateWithPassword, createSession, AuthError } from '@/lib/server/auth';
import { setSessionCookie } from '@/lib/server/authCookies';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import { getPostAuthRedirectPath } from '@/lib/server/onboarding';
import { enforceRateLimit } from '@/security/rateLimiter';
import { RequestValidationError, validateJsonBody } from '@/security/requestValidator';
import {
  clearLoginFailureSignals,
  enforceSecurityIpBlock,
  monitorApiAbuse,
  monitorFailedLoginAttempt,
  resolveClientIp,
} from '@/security/securityMonitor';

export const runtime = 'nodejs';

const BodySchema = z.object({
  email: z.string().trim().email('A valid email is required.'),
  password: z.string().min(1, 'Password is required.'),
});

export async function POST(req: NextRequest) {
  const ipBlockResponse = enforceSecurityIpBlock(req);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(req, { profile: 'auth', scope: 'auth' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(req),
      path: req.nextUrl.pathname,
      reason: 'auth_rate_limit_exceeded',
    });
    return rateLimited;
  }

  let attemptedEmail: string | null = null;

  try {
    const body = await validateJsonBody(req, BodySchema);
    attemptedEmail = body.email;
    const meta = extractRequestMeta(req);
    const user = await authenticateWithPassword({
      email: body.email,
      password: body.password,
    });

    clearLoginFailureSignals({
      ip: meta.ip || resolveClientIp(req),
      email: body.email,
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
      : error instanceof RequestValidationError
        ? error.message
      : error instanceof AuthError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to login';

    const status = error instanceof z.ZodError
      ? 400
      : error instanceof RequestValidationError
        ? error.status
      : error instanceof AuthError
        ? error.status
        : 500;

    if (error instanceof AuthError && status === 401) {
      monitorFailedLoginAttempt({
        ip: resolveClientIp(req),
        email: attemptedEmail,
      });
    }

    return NextResponse.json({
      ok: false,
      error: message,
    }, { status });
  }
}
