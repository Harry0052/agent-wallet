import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { getOptionalSecret, getRequiredSecret, getSecretFromAny } from '@/security/secretsManager';

export const GOOGLE_OAUTH_STATE_COOKIE = 'aw_google_oauth_state';
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleOAuthStatePayload {
  state: string;
  nonce: string;
  redirectTo: string;
  expiresAt: number;
}

export interface VerifiedGoogleIdentity {
  email: string;
  name: string | null;
  providerId: string;
  profilePicture: string | null;
}

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() || 'https://startcalico.com';
}

function googleOauthRedirectUri(): string {
  return getOptionalSecret('GOOGLE_OAUTH_REDIRECT_URI')
    || `${appOrigin()}/api/auth/google/callback`;
}

function googleOAuthConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  return {
    clientId: getRequiredSecret('GOOGLE_OAUTH_CLIENT_ID', { minLength: 10 }),
    clientSecret: getRequiredSecret('GOOGLE_OAUTH_CLIENT_SECRET', { minLength: 10 }),
    redirectUri: googleOauthRedirectUri(),
  };
}

function googleStateSigningSecret(): string {
  return getSecretFromAny(['GOOGLE_OAUTH_STATE_SECRET', 'AUTH_SESSION_SECRET'], {
    minLength: 32,
  });
}

function oauthClient(): OAuth2Client {
  const config = googleOAuthConfig();
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

function base64UrlJson(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function parseBase64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function signGoogleStatePayload(payloadEncoded: string): string {
  return createHmac('sha256', googleStateSigningSecret())
    .update(payloadEncoded)
    .digest('base64url');
}

function safeRedirectPath(input: string | null | undefined): string {
  const value = (input || '').trim();
  if (!value) return '/operator';
  if (!value.startsWith('/')) return '/operator';
  if (value.startsWith('//')) return '/operator';
  return value;
}

export function createGoogleAuthorizationRequest(input: {
  redirectTo?: string | null;
}): {
  authorizationUrl: string;
  stateCookieValue: string;
  expiresAt: number;
} {
  const client = oauthClient();
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const redirectTo = safeRedirectPath(input.redirectTo);
  const expiresAt = Date.now() + GOOGLE_OAUTH_STATE_TTL_MS;

  const payload: GoogleOAuthStatePayload = {
    state,
    nonce,
    redirectTo,
    expiresAt,
  };

  const payloadEncoded = base64UrlJson(payload);
  const signature = signGoogleStatePayload(payloadEncoded);
  const stateCookieValue = `${payloadEncoded}.${signature}`;

  const authorizationUrl = client.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: false,
    prompt: 'select_account',
    state,
    nonce,
    redirect_uri: googleOAuthConfig().redirectUri,
  });

  return {
    authorizationUrl,
    stateCookieValue,
    expiresAt,
  };
}

export function verifyGoogleStateCookie(rawCookieValue: string | undefined | null): GoogleOAuthStatePayload | null {
  if (!rawCookieValue) return null;

  const split = rawCookieValue.split('.');
  if (split.length !== 2) return null;

  const [payloadEncoded, signature] = split;
  if (!payloadEncoded || !signature) return null;

  const expectedSignature = signGoogleStatePayload(payloadEncoded);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: GoogleOAuthStatePayload;
  try {
    payload = parseBase64UrlJson<GoogleOAuthStatePayload>(payloadEncoded);
  } catch {
    return null;
  }

  if (!payload.state || !payload.nonce) return null;
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;

  return {
    ...payload,
    redirectTo: safeRedirectPath(payload.redirectTo),
  };
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function verifyGoogleCallbackCode(input: {
  code: string;
  expectedNonce: string;
}): Promise<VerifiedGoogleIdentity> {
  const code = input.code.trim();
  if (!code) {
    throw new Error('Missing Google authorization code.');
  }

  const config = googleOAuthConfig();
  const client = oauthClient();
  const tokenResponse = await client.getToken({
    code,
    redirect_uri: config.redirectUri,
  });

  const idToken = tokenResponse.tokens.id_token;
  if (!idToken) {
    throw new Error('Google OAuth response did not contain an ID token.');
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: config.clientId,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Google token verification failed.');
  }

  if (payload.nonce !== input.expectedNonce) {
    throw new Error('Google OAuth nonce mismatch.');
  }

  const email = normalizeOptionalText(payload.email)?.toLowerCase() || null;
  const providerId = normalizeOptionalText(payload.sub);
  if (!email || !providerId) {
    throw new Error('Google OAuth payload is missing required identity fields.');
  }

  if (payload.email_verified !== true) {
    throw new Error('Google account email must be verified.');
  }

  return {
    email,
    providerId,
    name: normalizeOptionalText(payload.name),
    profilePicture: normalizeOptionalText(payload.picture),
  };
}
