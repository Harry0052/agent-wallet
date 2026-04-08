import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/server/auth';
import { setSessionCookie } from '@/lib/server/authCookies';
import { recordAccountAuditEvent } from '@/lib/server/accountAudit';
import { getPostAuthRedirectPath } from '@/lib/server/onboarding';
import { logServerEvent } from '@/lib/server/observability';
import { extractRequestMeta } from '@/lib/server/requestMeta';
import {
  createAppleAuthorizationRequest,
  parseAppleUserDisplayName,
  verifyAppleIdentityToken,
  verifyAppleStateToken,
} from '@/auth/oauth/appleOAuth';
import { signInWithAppleOAuth } from '@/auth/oauth/appleOAuthService';
import { attributeReferral } from '@/lib/server/referrals';
import { enforceRateLimit } from '@/security/rateLimiter';
import {
  enforceSecurityIpBlock,
  monitorApiAbuse,
  resolveClientIp,
} from '@/security/securityMonitor';

function loginRedirectUrl(request: NextRequest, reason: string): URL {
  const url = new URL('/login', request.url);
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

async function readAppleCallbackForm(request: NextRequest): Promise<{
  state: string;
  idToken: string;
  userField: string | null;
  error: string | null;
  errorDescription: string | null;
}> {
  const form = await request.formData();

  const state = typeof form.get('state') === 'string' ? String(form.get('state')).trim() : '';
  const idToken = typeof form.get('id_token') === 'string' ? String(form.get('id_token')).trim() : '';
  const userField = typeof form.get('user') === 'string' ? String(form.get('user')) : null;
  const error = typeof form.get('error') === 'string' ? String(form.get('error')).trim() : null;
  const errorDescription = typeof form.get('error_description') === 'string'
    ? String(form.get('error_description')).trim()
    : null;

  return {
    state,
    idToken,
    userField,
    error,
    errorDescription,
  };
}

export async function handleAppleOAuthLogin(request: NextRequest): Promise<NextResponse> {
  const ipBlockResponse = enforceSecurityIpBlock(request);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(request, { profile: 'auth', scope: 'auth-apple-login' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(request),
      path: request.nextUrl.pathname,
      reason: 'apple_oauth_login_rate_limited',
    });
    return rateLimited;
  }

  try {
    const redirectTo = request.nextUrl.searchParams.get('next');
    const referralCode = request.nextUrl.searchParams.get('ref');
    const oauth = createAppleAuthorizationRequest({ redirectTo, referralCode });
    return NextResponse.redirect(oauth.authorizationUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'oauth_login_unavailable';
    logServerEvent('warn', 'apple_oauth_login_failure', {
      provider: 'apple',
      reason,
    });

    return NextResponse.redirect(loginRedirectUrl(request, 'apple_auth_unavailable'));
  }
}

export async function handleAppleOAuthCallback(request: NextRequest): Promise<NextResponse> {
  const ipBlockResponse = enforceSecurityIpBlock(request);
  if (ipBlockResponse) return ipBlockResponse;

  const rateLimited = enforceRateLimit(request, { profile: 'auth', scope: 'auth-apple-callback' });
  if (rateLimited) {
    monitorApiAbuse({
      ip: resolveClientIp(request),
      path: request.nextUrl.pathname,
      reason: 'apple_oauth_callback_rate_limited',
    });
    return rateLimited;
  }

  const meta = extractRequestMeta(request);

  try {
    const form = await readAppleCallbackForm(request);

    if (form.error) {
      const reason = form.errorDescription || form.error;

      logServerEvent('warn', 'apple_oauth_login_failure', {
        provider: 'apple',
        reason,
      });

      await recordAccountAuditEvent({
        action: 'apple_oauth_login_failure',
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: {
          provider: 'apple',
          reason,
        },
      });

      return NextResponse.redirect(loginRedirectUrl(request, 'apple_denied'));
    }

    const statePayload = verifyAppleStateToken(form.state);
    if (!statePayload || !form.idToken) {
      logServerEvent('warn', 'apple_oauth_login_failure', {
        provider: 'apple',
        reason: 'invalid_apple_oauth_state_or_token',
      });

      await recordAccountAuditEvent({
        action: 'apple_oauth_login_failure',
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: {
          provider: 'apple',
          reason: 'invalid_apple_oauth_state_or_token',
        },
      });

      return NextResponse.redirect(loginRedirectUrl(request, 'apple_state_invalid'));
    }

    const identity = await verifyAppleIdentityToken({
      identityToken: form.idToken,
      expectedNonce: statePayload.nonce,
    });

    const user = await signInWithAppleOAuth({
      identity,
      displayName: parseAppleUserDisplayName(form.userField),
    });

    // Attribute referral if a code was passed through the Apple OAuth state
    if (statePayload.referralCode && user.appUserId) {
      try {
        await attributeReferral({
          referralCode: statePayload.referralCode,
          referredUserId: user.appUserId,
        });
      } catch {
        // Referral attribution failure must not block login
      }
    }

    const session = await createSession({
      appUserId: user.appUserId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const defaultRedirectTo = await getPostAuthRedirectPath(user.appUserId);
    const redirectTo = resolveCallbackRedirectPath({
      stateRedirectTo: statePayload.redirectTo,
      defaultRedirectTo,
    });

    if (user.isNewUser) {
      logServerEvent('info', 'apple_new_user_created', {
        provider: 'apple',
        appUserId: user.appUserId,
      });

      await recordAccountAuditEvent({
        userId: user.appUserId,
        action: 'apple_new_user_created',
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: {
          provider: 'apple',
        },
      });
    }

    logServerEvent('info', 'apple_oauth_login_success', {
      provider: 'apple',
      appUserId: user.appUserId,
      isNewUser: user.isNewUser,
    });

    await recordAccountAuditEvent({
      userId: user.appUserId,
      action: 'apple_oauth_login_success',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        provider: 'apple',
        isNewUser: user.isNewUser,
      },
    });

    const response = NextResponse.redirect(new URL(redirectTo, request.url));
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'apple_oauth_callback_failure';

    logServerEvent('warn', 'apple_oauth_login_failure', {
      provider: 'apple',
      reason,
    });

    await recordAccountAuditEvent({
      action: 'apple_oauth_login_failure',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        provider: 'apple',
        reason,
      },
    });

    return NextResponse.redirect(loginRedirectUrl(request, 'apple_auth_failed'));
  }
}
