import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { issuePasswordResetToken } from '@/lib/server/auth';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import { logServerEvent } from '@/lib/server/observability';
import { enforceRateLimit } from '@/security/rateLimiter';
import { RequestValidationError, validateJsonBody } from '@/security/requestValidator';

export const runtime = 'nodejs';

const BodySchema = z.object({
  email: z.string().trim().email('A valid email is required.'),
});

function buildResetUrl(token: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() || 'https://startcalico.com';
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: 'auth', scope: 'auth' });
  if (rateLimited) return rateLimited;

  const meta = extractRequestMeta(req);

  try {
    const body = await validateJsonBody(req, BodySchema);
    const issued = await issuePasswordResetToken(body.email);

    if (issued.appUserId) {
      await recordAccountAuditEvent({
        userId: issued.appUserId,
        action: 'password_reset_requested',
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    // Dev-only token echo: only enabled when BOTH conditions are true.
    // MUST NOT be set in production Vercel env vars.
    const allowTokenEcho = process.env.NODE_ENV !== 'production'
      && process.env.AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN === 'true';

    if (allowTokenEcho && process.env.VERCEL_ENV === 'production') {
      // Safety net: refuse to echo tokens if somehow deployed to production
      logServerEvent('error', 'auth.forgot_password.dev_token_echo_blocked', {
        reason: 'AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN is set in production — ignoring',
      });
    }

    const safeTokenEcho = allowTokenEcho && process.env.VERCEL_ENV !== 'production';

    const responseBody: Record<string, unknown> = {
      ok: true,
      message: 'If an account exists for that email, reset instructions have been sent.',
    };

    if (safeTokenEcho) {
      const token = issued.token || randomBytes(48).toString('base64url');
      responseBody.resetToken = token;
      responseBody.resetUrl = buildResetUrl(token);
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof RequestValidationError
        ? error.message
      : 'If an account exists for that email, reset instructions have been sent.';

    const status = error instanceof z.ZodError || error instanceof RequestValidationError ? 400 : 200;

    // Log unexpected errors (not validation) for observability
    if (status === 200 && !(error instanceof z.ZodError) && !(error instanceof RequestValidationError)) {
      logServerEvent('error', 'auth.forgot_password.internal_error', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }

    return NextResponse.json({
      ok: status === 200,
      message,
      ...(status === 400 ? { error: message } : {}),
    }, { status });
  }
}
