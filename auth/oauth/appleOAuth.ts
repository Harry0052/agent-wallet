import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getOptionalSecret, getRequiredSecret, getSecretFromAny } from '@/security/secretsManager';
import { getPublicAppOrigin } from '@/lib/publicOrigin';

const APPLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_APPLE_ISSUER = 'https://appleid.apple.com';
const DEFAULT_APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';

export interface AppleOAuthStatePayload {
  stateId: string;
  nonce: string;
  redirectTo: string;
  expiresAt: number;
  referralCode?: string;
}

export interface VerifiedAppleIdentity {
  email: string;
  providerId: string;
}

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() || getPublicAppOrigin();
}

function appleClientId(): string {
  return getRequiredSecret('APPLE_OAUTH_CLIENT_ID', { minLength: 3 });
}

function appleRedirectUri(): string {
  const derived = `${appOrigin()}/api/auth/apple/callback`;
  const override = getOptionalSecret('APPLE_OAUTH_REDIRECT_URI');

  if (!override) return derived;

  // Safety: never allow a localhost redirect in production
  if (process.env.NODE_ENV === 'production') {
    try {
      const parsed = new URL(override);
      if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) {
        console.warn(
          '[AppleOAuth] APPLE_OAUTH_REDIRECT_URI contains localhost in production — ignoring override and using derived URI.',
        );
        return derived;
      }
      if (!parsed.pathname.endsWith('/api/auth/apple/callback')) {
        console.warn(
          `[AppleOAuth] APPLE_OAUTH_REDIRECT_URI path "${parsed.pathname}" does not end with /api/auth/apple/callback — ignoring override and using derived URI.`,
        );
        return derived;
      }
    } catch {
      console.warn('[AppleOAuth] APPLE_OAUTH_REDIRECT_URI is not a valid URL — ignoring override and using derived URI.');
      return derived;
    }
  }

  return override;
}

function appleStateSigningSecret(): string {
  return getSecretFromAny(['APPLE_OAUTH_STATE_SECRET', 'AUTH_SESSION_SECRET'], {
    minLength: 32,
  });
}

function appleExpectedIssuer(): string {
  return process.env.APPLE_OAUTH_ISSUER?.trim() || DEFAULT_APPLE_ISSUER;
}

function appleJwksUrl(): string {
  return process.env.APPLE_OAUTH_JWKS_URL?.trim() || DEFAULT_APPLE_JWKS_URL;
}

function safeRedirectPath(input: string | null | undefined): string {
  const value = (input || '').trim();
  if (!value) return '/operator';
  if (!value.startsWith('/')) return '/operator';
  if (value.startsWith('//')) return '/operator';
  return value;
}

function base64UrlJson(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function parseBase64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function signAppleStatePayload(payloadEncoded: string): string {
  return createHmac('sha256', appleStateSigningSecret())
    .update(payloadEncoded)
    .digest('base64url');
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createAppleAuthorizationRequest(input: {
  redirectTo?: string | null;
  referralCode?: string | null;
}): {
  authorizationUrl: string;
  stateToken: string;
} {
  const referralCode = input.referralCode?.trim().slice(0, 20) || undefined;

  const statePayload: AppleOAuthStatePayload = {
    stateId: randomBytes(24).toString('base64url'),
    nonce: randomBytes(24).toString('base64url'),
    redirectTo: safeRedirectPath(input.redirectTo),
    expiresAt: Date.now() + APPLE_OAUTH_STATE_TTL_MS,
    ...(referralCode ? { referralCode } : {}),
  };

  const payloadEncoded = base64UrlJson(statePayload);
  const signature = signAppleStatePayload(payloadEncoded);
  const stateToken = `${payloadEncoded}.${signature}`;

  const url = new URL(APPLE_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code id_token');
  url.searchParams.set('response_mode', 'form_post');
  url.searchParams.set('client_id', appleClientId());
  url.searchParams.set('redirect_uri', appleRedirectUri());
  url.searchParams.set('scope', 'name email');
  url.searchParams.set('state', stateToken);
  url.searchParams.set('nonce', statePayload.nonce);

  return {
    authorizationUrl: url.toString(),
    stateToken,
  };
}

export function verifyAppleStateToken(rawStateToken: string | undefined | null): AppleOAuthStatePayload | null {
  if (!rawStateToken) return null;

  const split = rawStateToken.split('.');
  if (split.length !== 2) return null;

  const [payloadEncoded, signature] = split;
  if (!payloadEncoded || !signature) return null;

  const expectedSignature = signAppleStatePayload(payloadEncoded);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: AppleOAuthStatePayload;
  try {
    payload = parseBase64UrlJson<AppleOAuthStatePayload>(payloadEncoded);
  } catch {
    return null;
  }

  if (!payload.stateId || !payload.nonce) return null;
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;

  return {
    ...payload,
    redirectTo: safeRedirectPath(payload.redirectTo),
  };
}

export async function verifyAppleIdentityToken(input: {
  identityToken: string;
  expectedNonce: string;
}): Promise<VerifiedAppleIdentity> {
  const identityToken = input.identityToken.trim();
  if (!identityToken) {
    throw new Error('Missing Apple identity token.');
  }

  const jwks = createRemoteJWKSet(new URL(appleJwksUrl()));
  const verified = await jwtVerify(identityToken, jwks, {
    issuer: appleExpectedIssuer(),
    audience: appleClientId(),
  });

  const payload = verified.payload;
  const providerId = normalizeOptionalText(payload.sub);
  const email = normalizeOptionalText(payload.email)?.toLowerCase() || null;

  if (!providerId || !email) {
    throw new Error('Apple identity token is missing required identity fields.');
  }

  const emailVerified = payload.email_verified;
  const isEmailVerified = emailVerified === true || emailVerified === 'true';
  if (!isEmailVerified) {
    throw new Error('Apple account email must be verified.');
  }

  const nonce = normalizeOptionalText(payload.nonce);
  if (!nonce || nonce !== input.expectedNonce) {
    throw new Error('Apple OAuth nonce mismatch.');
  }

  return {
    email,
    providerId,
  };
}

export function parseAppleUserDisplayName(rawUserField: string | null | undefined): string | null {
  if (!rawUserField) return null;

  try {
    const parsed = JSON.parse(rawUserField) as {
      name?: {
        firstName?: unknown;
        lastName?: unknown;
      };
    };

    const first = normalizeOptionalText(parsed?.name?.firstName);
    const last = normalizeOptionalText(parsed?.name?.lastName);
    if (!first && !last) return null;

    return [first, last].filter(Boolean).join(' ').slice(0, 200);
  } catch {
    return null;
  }
}
