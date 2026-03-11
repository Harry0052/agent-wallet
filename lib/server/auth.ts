import 'server-only';

import { createHmac, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { query } from '@/lib/server/db';
import { assertPasswordStrength, hashPassword as hashPasswordRaw, verifyPassword } from '@/lib/auth/password';
import { ensureUserSettingsRow } from '@/lib/server/userSettings';

export const AUTH_SESSION_COOKIE = 'aw_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

interface AppUserRow {
  id: string;
  email: string;
  wallet_user_id: string;
  created_at: string;
}

interface PasswordRow {
  user_id: string;
  password_hash: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

interface SessionLookupRow {
  session_id: string;
  user_id: string;
  wallet_user_id: string;
  email: string;
  expires_at: string;
}

interface PasswordResetLookupRow {
  id: string;
  user_id: string;
}

export interface AuthenticatedUser {
  appUserId: string;
  walletUserId: string;
  email: string;
  sessionId: string;
  expiresAt: string;
}

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

function getAuthSessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error('Missing required server env var: AUTH_SESSION_SECRET (min length 32)');
  }
  return secret;
}

function getPasswordResetSecret(): string {
  const explicit = process.env.AUTH_PASSWORD_RESET_SECRET?.trim();
  if (explicit) {
    if (explicit.length < 32) {
      throw new Error('AUTH_PASSWORD_RESET_SECRET must be at least 32 characters when set');
    }
    return explicit;
  }
  return getAuthSessionSecret();
}

function getEmailVerificationSecret(): string {
  const explicit = process.env.AUTH_EMAIL_VERIFICATION_SECRET?.trim();
  if (explicit) {
    if (explicit.length < 32) {
      throw new Error('AUTH_EMAIL_VERIFICATION_SECRET must be at least 32 characters when set');
    }
    return explicit;
  }
  return getAuthSessionSecret();
}

function base64Url(input: Buffer): string {
  return input.toString('base64url');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function ensureUserOnboardingState(appUserId: string): Promise<void> {
  await query(
    `
      INSERT INTO app_user_onboarding_states (user_id, onboarding_step, skipped_tool_setup, preferences)
      VALUES ($1, 'welcome', FALSE, '{}'::jsonb)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [appUserId],
  );
}

async function ensureUserProfileDefaults(input: {
  walletUserId: string;
  email: string;
}): Promise<void> {
  await query(
    `
      INSERT INTO user_autofill_profiles (user_id, email, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        email = COALESCE(user_autofill_profiles.email, EXCLUDED.email),
        updated_at = NOW()
    `,
    [input.walletUserId, input.email],
  );
}

function hashSessionToken(token: string): string {
  return createHmac('sha256', getAuthSessionSecret()).update(token).digest('hex');
}

function hashPasswordResetToken(token: string): string {
  return createHmac('sha256', getPasswordResetSecret()).update(token).digest('hex');
}

function hashEmailVerificationToken(token: string): string {
  return createHmac('sha256', getEmailVerificationSecret()).update(token).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  try {
    return await hashPasswordRaw(password);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Password does not meet requirements.';
    throw new AuthError(message, 400);
  }
}

export async function findUserByEmail(email: string): Promise<AppUserRow | null> {
  const normalized = normalizeEmail(email);
  const result = await query<AppUserRow>(
    `
      SELECT id, email, wallet_user_id, created_at::text
      FROM app_users
      WHERE email = $1
      LIMIT 1
    `,
    [normalized],
  );
  return result.rows[0] || null;
}

async function ensureWalletPlaceholder(walletUserId: string): Promise<void> {
  const defaultSettings = {
    maxTransaction: 50,
    dailyLimit: 100,
    monthlyBudget: 500,
    approvalThreshold: 10,
    requireLocation: true,
    allowedMerchants: [],
    blockedMerchants: [],
  };

  await query(
    `
      INSERT INTO wallet_users (user_id, currency, settings)
      VALUES ($1, 'usd', $2::jsonb)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [walletUserId, JSON.stringify(defaultSettings)],
  );
}

async function resolveWalletUserIdForNewUser(): Promise<string> {
  const existingUsers = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM app_users');
  const userCount = Number(existingUsers.rows[0]?.count || '0');
  if (userCount === 0) {
    return process.env.WALLET_USER_ID || 'default-user';
  }
  return `wallet_${randomBytes(12).toString('hex')}`;
}

export async function createUserWithPassword(input: {
  email: string;
  password: string;
}): Promise<{ appUserId: string; walletUserId: string; email: string }> {
  const normalizedEmail = normalizeEmail(input.email);
  try {
    assertPasswordStrength(input.password);
  } catch (error) {
    throw new AuthError(error instanceof Error ? error.message : 'Password does not meet requirements.', 400);
  }

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new AuthError('A valid email is required.', 400);
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new AuthError('An account with this email already exists.', 409);
  }

  const appUserId = `usr_${randomBytes(12).toString('hex')}`;
  const walletUserId = await resolveWalletUserIdForNewUser();
  const passwordHash = await hashPassword(input.password);

  await ensureWalletPlaceholder(walletUserId);

  await query(
    `
      INSERT INTO app_users (id, email, wallet_user_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
    `,
    [appUserId, normalizedEmail, walletUserId],
  );

  await query(
    `
      INSERT INTO app_user_passwords (user_id, password_hash, hash_algo, updated_at)
      VALUES ($1, $2, 'scrypt', NOW())
    `,
    [appUserId, passwordHash],
  );

  await ensureUserOnboardingState(appUserId);
  await ensureUserSettingsRow(appUserId);
  await ensureUserProfileDefaults({
    walletUserId,
    email: normalizedEmail,
  });

  return {
    appUserId,
    walletUserId,
    email: normalizedEmail,
  };
}

export async function authenticateWithPassword(input: {
  email: string;
  password: string;
}): Promise<{ appUserId: string; walletUserId: string; email: string }> {
  const normalizedEmail = normalizeEmail(input.email);
  const user = await findUserByEmail(normalizedEmail);
  if (!user) {
    throw new AuthError('Invalid email or password.', 401);
  }

  const passwordResult = await query<PasswordRow>(
    `
      SELECT user_id, password_hash
      FROM app_user_passwords
      WHERE user_id = $1
      LIMIT 1
    `,
    [user.id],
  );

  const passwordRow = passwordResult.rows[0];
  if (!passwordRow) {
    throw new AuthError('Invalid email or password.', 401);
  }

  const isValid = await verifyPassword(input.password, passwordRow.password_hash);
  if (!isValid) {
    throw new AuthError('Invalid email or password.', 401);
  }

  await ensureWalletPlaceholder(user.wallet_user_id);
  await ensureUserOnboardingState(user.id);
  await ensureUserSettingsRow(user.id);
  await ensureUserProfileDefaults({
    walletUserId: user.wallet_user_id,
    email: user.email,
  });

  return {
    appUserId: user.id,
    walletUserId: user.wallet_user_id,
    email: user.email,
  };
}

export async function createSession(input: {
  appUserId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  const token = base64Url(randomBytes(48));
  const tokenHash = hashSessionToken(token);
  const sessionId = `sess_${randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await query(
    `
      INSERT INTO app_user_sessions (
        id,
        user_id,
        token_hash,
        expires_at,
        ip,
        user_agent,
        created_at,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4::timestamptz, $5, $6, NOW(), NOW())
    `,
    [sessionId, input.appUserId, tokenHash, expiresAt, input.ip || null, input.userAgent || null],
  );

  return {
    token,
    sessionId,
    expiresAt,
  };
}

async function findSessionByToken(token: string): Promise<SessionLookupRow | null> {
  const tokenHash = hashSessionToken(token);
  const result = await query<SessionLookupRow>(
    `
      SELECT
        s.id AS session_id,
        s.user_id,
        u.wallet_user_id,
        u.email,
        s.expires_at::text
      FROM app_user_sessions s
      INNER JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash],
  );
  return result.rows[0] || null;
}

export async function revokeSessionByToken(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await query(
    `
      UPDATE app_user_sessions
      SET revoked_at = NOW()
      WHERE token_hash = $1
        AND revoked_at IS NULL
    `,
    [tokenHash],
  );
}

export async function getSessionTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_SESSION_COOKIE)?.value || null;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const token = await getSessionTokenFromCookies();
  if (!token) return null;

  const session = await findSessionByToken(token);
  if (!session) return null;

  await query(
    `
      UPDATE app_user_sessions
      SET last_seen_at = NOW()
      WHERE id = $1
    `,
    [session.session_id],
  );

  return {
    appUserId: session.user_id,
    walletUserId: session.wallet_user_id,
    email: session.email,
    sessionId: session.session_id,
    expiresAt: session.expires_at,
  };
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new AuthError('Authentication required.', 401);
  }
  return user;
}

export async function getWalletUserIdFromSession(): Promise<string> {
  const user = await requireAuthenticatedUser();
  return user.walletUserId;
}

export async function revokeCurrentSessionFromCookies(): Promise<void> {
  const token = await getSessionTokenFromCookies();
  if (!token) return;
  await revokeSessionByToken(token);
}

export async function getRawSessionByToken(token: string): Promise<SessionRow | null> {
  const tokenHash = hashSessionToken(token);
  const result = await query<SessionRow>(
    `
      SELECT id, user_id, token_hash, expires_at::text, revoked_at::text
      FROM app_user_sessions
      WHERE token_hash = $1
      LIMIT 1
    `,
    [tokenHash],
  );
  return result.rows[0] || null;
}

export async function issuePasswordResetToken(email: string): Promise<{
  appUserId: string | null;
  token: string | null;
  expiresAt: string | null;
}> {
  const user = await findUserByEmail(email);
  if (!user) {
    return {
      appUserId: null,
      token: null,
      expiresAt: null,
    };
  }

  await query(
    `
      UPDATE app_password_reset_tokens
      SET consumed_at = NOW()
      WHERE user_id = $1
        AND consumed_at IS NULL
    `,
    [user.id],
  );

  const token = base64Url(randomBytes(48));
  const tokenHash = hashPasswordResetToken(token);
  const tokenId = `prt_${randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();

  await query(
    `
      INSERT INTO app_password_reset_tokens (
        id,
        user_id,
        token_hash,
        expires_at,
        consumed_at,
        created_at
      )
      VALUES ($1, $2, $3, $4::timestamptz, NULL, NOW())
    `,
    [tokenId, user.id, tokenHash, expiresAt],
  );

  return {
    appUserId: user.id,
    token,
    expiresAt,
  };
}

export async function resetPasswordWithToken(input: {
  token: string;
  newPassword: string;
}): Promise<{ appUserId: string }> {
  try {
    assertPasswordStrength(input.newPassword);
  } catch (error) {
    throw new AuthError(error instanceof Error ? error.message : 'Password does not meet requirements.', 400);
  }

  const tokenHash = hashPasswordResetToken(input.token);
  const passwordHash = await hashPassword(input.newPassword);

  const consumed = await query<PasswordResetLookupRow>(
    `
      WITH consumed AS (
        UPDATE app_password_reset_tokens
        SET consumed_at = NOW()
        WHERE token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > NOW()
        RETURNING id, user_id
      )
      SELECT id, user_id
      FROM consumed
      LIMIT 1
    `,
    [tokenHash],
  );

  const consumedRow = consumed.rows[0];
  if (!consumedRow) {
    throw new AuthError('Reset token is invalid or expired.', 400);
  }

  await query(
    `
      INSERT INTO app_user_passwords (user_id, password_hash, hash_algo, updated_at)
      VALUES ($1, $2, 'scrypt', NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        hash_algo = 'scrypt',
        updated_at = NOW()
    `,
    [consumedRow.user_id, passwordHash],
  );

  await query(
    `
      UPDATE app_user_sessions
      SET revoked_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
    `,
    [consumedRow.user_id],
  );

  await query(
    `
      UPDATE app_password_reset_tokens
      SET consumed_at = NOW()
      WHERE user_id = $1
        AND consumed_at IS NULL
    `,
    [consumedRow.user_id],
  );

  return {
    appUserId: consumedRow.user_id,
  };
}

// Scaffolding for future email verification flow (token issuance only).
export async function issueEmailVerificationToken(appUserId: string): Promise<{
  token: string;
  expiresAt: string;
}> {
  const token = base64Url(randomBytes(48));
  const tokenHash = hashEmailVerificationToken(token);
  const tokenId = `evt_${randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();

  await query(
    `
      INSERT INTO app_email_verification_tokens (
        id,
        user_id,
        token_hash,
        expires_at,
        consumed_at,
        created_at
      )
      VALUES ($1, $2, $3, $4::timestamptz, NULL, NOW())
    `,
    [tokenId, appUserId, tokenHash, expiresAt],
  );

  return {
    token,
    expiresAt,
  };
}
