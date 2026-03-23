import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/server/auth';
import { setSessionCookie } from '@/lib/server/authCookies';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { getPostAuthRedirectPath } from '@/lib/server/onboarding';
import { logServerEvent } from '@/lib/server/observability';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import {
  createGoogleAuthorizationRequest,
  GOOGLE_OAUTH_STATE_COOKIE,
  verifyGoogleCallbackCode,
  verifyGoogleStateCookie,
} from '@/auth/oauth/googleOAuth';
import { signInWithGoogleOAuth } from '@/auth/oauth/googleOAuthService';
import { enforceRateLimit } from '@/security/rateLimiter';
import {
  enforceSecurityIpBlock,
  monitorApiAbuse,
  resolveClientIp,
} from '@/security/securityMonitor';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Non-fatal audit logging — must never crash the OAuth flow */
async function safeAuditEvent(input: {
  userId?: string | null;
  action: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await recordAccountAuditEvent(input);
  } catch (error) {
    logServerEvent('warn', 'oauth.audit_event_failed', {
      action: input.action,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

function clearOauthStateCookie(response: NextResponse): void {
  response.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: '',
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/api/auth/google',
    maxAge: 0,
  });
}

function setOauthStateCookie(response: NextResponse, value: string, expiresAtMs: number): void {
  response.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value,
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/api/auth/google',
    expires: new Date(expiresAtMs),
  });
}

function canonicalOrigin(request: NextRequest): string {
  // Use NEXT_PUBLIC_APP_ORIGIN if set, otherwise derive from request
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (configured) return configured;
  return request.nextUrl.origin;
}

function loginRedirectUrl(request: NextRequest, reason: string): URL {
  const url = new URL('/login', canonicalOrigin(request));
  url.searchParams.set('oauth_error', reason);
  return url;
}

function resolveCallbackRedirectPath(input: {
  stateRedirectTo: string;
  defaultRedirectTo: string;
}): string {
  const normalized = input.stateRedirectTo.trim();
  if (!normalized || normalized === '/operator') {
    return input.defaultRedirectTo;
  }

  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return input.defaultRedirectTo;
  }

  return normalized;
}

export async function handleGoogleOAuthLogin(request: NextRequest): Promise<NextResponse> {
  const ipBlockResponse = enforceSecurityIpBlock(request);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(request, { profile: 'auth', scope: 'auth-google-login' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(request),
      path: request.nextUrl.pathname,
      reason: 'google_oauth_login_rate_limited',
    });
    return rateLimited;
  }

  try {
    const redirectTo = request.nextUrl.searchParams.get('next');
    const oauth = createGoogleAuthorizationRequest({ redirectTo });

    const response = NextResponse.redirect(oauth.authorizationUrl);
    setOauthStateCookie(response, oauth.stateCookieValue, oauth.expiresAt);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'oauth_login_unavailable';
    logServerEvent('warn', 'oauth_login_failure', {
      provider: 'google',
      reason,
    });

    const response = NextResponse.redirect(loginRedirectUrl(request, 'google_auth_unavailable'));
    clearOauthStateCookie(response);
    return response;
  }
}

export async function handleGoogleOAuthCallback(request: NextRequest): Promise<NextResponse> {
  const ipBlockResponse = enforceSecurityIpBlock(request);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(request, { profile: 'auth', scope: 'auth-google-callback' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(request),
      path: request.nextUrl.pathname,
      reason: 'google_oauth_callback_rate_limited',
    });
    return rateLimited;
  }

  const queryError = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code')?.trim() || '';
  const state = request.nextUrl.searchParams.get('state')?.trim() || '';
  const stateCookie = verifyGoogleStateCookie(request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value);
  const meta = extractRequestMeta(request);

  if (queryError) {
    logServerEvent('warn', 'oauth_login_failure', {
      provider: 'google',
      reason: queryError,
    });

    await safeAuditEvent({
      action: 'oauth_login_failure',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        provider: 'google',
        reason: queryError,
      },
    });

    const response = NextResponse.redirect(loginRedirectUrl(request, 'google_denied'));
    clearOauthStateCookie(response);
    return response;
  }

  if (!stateCookie || !code || !state || stateCookie.state !== state) {
    logServerEvent('warn', 'oauth_login_failure', {
      provider: 'google',
      reason: 'invalid_oauth_state_or_code',
    });

    await safeAuditEvent({
      action: 'oauth_login_failure',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        provider: 'google',
        reason: 'invalid_oauth_state_or_code',
      },
    });

    const response = NextResponse.redirect(loginRedirectUrl(request, 'google_state_invalid'));
    clearOauthStateCookie(response);
    return response;
  }

  try {
    const identity = await verifyGoogleCallbackCode({
      code,
      expectedNonce: stateCookie.nonce,
    });

    const user = await signInWithGoogleOAuth(identity);

    const session = await createSession({
      appUserId: user.appUserId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const defaultRedirectTo = await getPostAuthRedirectPath(user.appUserId);
    const redirectTo = resolveCallbackRedirectPath({
      stateRedirectTo: stateCookie.redirectTo,
      defaultRedirectTo,
    });

    if (user.isNewUser) {
      logServerEvent('info', 'new_oauth_user_created', {
        provider: 'google',
        appUserId: user.appUserId,
      });

      await safeAuditEvent({
        userId: user.appUserId,
        action: 'new_oauth_user_created',
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: {
          provider: 'google',
        },
      });
    }

    logServerEvent('info', 'oauth_login_success', {
      provider: 'google',
      appUserId: user.appUserId,
      isNewUser: user.isNewUser,
    });

    await safeAuditEvent({
      userId: user.appUserId,
      action: 'oauth_login_success',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        provider: 'google',
        isNewUser: user.isNewUser,
      },
    });

    // Use canonical origin so cookie domain always matches redirect target.
    // Without this, when the callback URL host differs from the canonical app
    // domain (e.g. Vercel preview URL vs production domain), the session cookie
    // gets set on the wrong host and is lost after redirect.
    const origin = canonicalOrigin(request);
    const finalRedirectUrl = new URL(redirectTo, origin);

    logServerEvent('info', 'oauth_callback_redirect', {
      provider: 'google',
      redirectTo,
      origin,
      finalUrl: finalRedirectUrl.toString(),
      requestHost: request.nextUrl.host,
    });

    const response = NextResponse.redirect(finalRedirectUrl);
    setSessionCookie(response, session.token, session.expiresAt);
    clearOauthStateCookie(response);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'oauth_callback_failure';

    logServerEvent('warn', 'oauth_login_failure', {
      provider: 'google',
      reason,
    });

    await safeAuditEvent({
      action: 'oauth_login_failure',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        provider: 'google',
        reason,
      },
    });

    const response = NextResponse.redirect(loginRedirectUrl(request, 'google_auth_failed'));
    clearOauthStateCookie(response);
    return response;
  }
}
