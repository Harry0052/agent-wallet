import 'server-only';

import { randomBytes } from 'node:crypto';
import type { SecureDbClient } from '@/database/dbService';
import { withDbTransaction } from '@/lib/server/db';
import { type VerifiedGoogleIdentity } from '@/auth/oauth/googleOAuth';

type AppUserRow = {
  id: string;
  email: string;
  wallet_user_id: string;
};

export interface GoogleOAuthUserResult {
  appUserId: string;
  walletUserId: string;
  email: string;
  isNewUser: boolean;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeOptionalText(value: string | null | undefined, maxLen: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

async function findUserByEmail(
  client: SecureDbClient,
  email: string,
): Promise<AppUserRow | null> {
  const result = await client.query<AppUserRow>(
    `
      SELECT id, email, wallet_user_id
      FROM app_users
      WHERE email = $1
      LIMIT 1
    `,
    [email],
  );

  return result.rows[0] || null;
}

async function findUserByGoogleProviderId(
  client: SecureDbClient,
  providerId: string,
): Promise<AppUserRow | null> {
  const result = await client.query<AppUserRow>(
    `
      SELECT id, email, wallet_user_id
      FROM app_users
      WHERE oauth_provider = 'google'
        AND oauth_provider_id = $1
      LIMIT 1
    `,
    [providerId],
  );

  return result.rows[0] || null;
}

async function ensureWalletPlaceholder(client: SecureDbClient, walletUserId: string): Promise<void> {
  const defaultSettings = {
    maxTransaction: 50,
    dailyLimit: 100,
    monthlyBudget: 500,
    approvalThreshold: 10,
    requireLocation: true,
    allowedMerchants: [],
    blockedMerchants: [],
  };

  await client.query(
    `
      INSERT INTO wallet_users (user_id, currency, settings)
      VALUES ($1, 'usd', $2::jsonb)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [walletUserId, JSON.stringify(defaultSettings)],
  );
}

async function ensureUserOnboardingState(client: SecureDbClient, appUserId: string): Promise<void> {
  await client.query(
    `
      INSERT INTO app_user_onboarding_states (user_id, onboarding_step, skipped_tool_setup, preferences)
      VALUES ($1, 'welcome', FALSE, '{}'::jsonb)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [appUserId],
  );
}

async function ensureUserSettings(client: SecureDbClient, appUserId: string): Promise<void> {
  await client.query(
    `
      INSERT INTO app_user_settings (
        user_id,
        locale,
        timezone,
        dashboard_default_view,
        security,
        agent_defaults,
        notifications
      )
      VALUES ($1, 'en-US', 'UTC', 'operator', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [appUserId],
  );
}

async function ensureUserProfileDefaults(input: {
  client: SecureDbClient;
  walletUserId: string;
  email: string;
  fullName: string | null;
}): Promise<void> {
  await input.client.query(
    `
      INSERT INTO user_autofill_profiles (user_id, full_name, email, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        full_name = COALESCE(user_autofill_profiles.full_name, EXCLUDED.full_name),
        email = COALESCE(user_autofill_profiles.email, EXCLUDED.email),
        updated_at = NOW()
    `,
    [input.walletUserId, input.fullName, input.email],
  );
}

async function resolveWalletUserIdForNewUser(client: SecureDbClient): Promise<string> {
  const existingUsers = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM app_users');
  const userCount = Number(existingUsers.rows[0]?.count || '0');
  if (userCount === 0) {
    return process.env.WALLET_USER_ID || 'default-user';
  }
  return `wallet_${randomBytes(12).toString('hex')}`;
}

async function updateExistingUserForGoogleOAuth(input: {
  client: SecureDbClient;
  user: AppUserRow;
  identity: VerifiedGoogleIdentity;
}): Promise<GoogleOAuthUserResult> {
  const providerPicture = normalizeOptionalText(input.identity.profilePicture, 1024);

  await input.client.query(
    `
      UPDATE app_users
      SET
        oauth_provider = 'google',
        oauth_provider_id = $2,
        profile_picture = COALESCE($3, profile_picture),
        updated_at = NOW()
      WHERE id = $1
    `,
    [input.user.id, input.identity.providerId, providerPicture],
  );

  await ensureWalletPlaceholder(input.client, input.user.wallet_user_id);
  await ensureUserOnboardingState(input.client, input.user.id);
  await ensureUserSettings(input.client, input.user.id);
  await ensureUserProfileDefaults({
    client: input.client,
    walletUserId: input.user.wallet_user_id,
    email: input.user.email,
    fullName: normalizeOptionalText(input.identity.name, 200),
  });

  return {
    appUserId: input.user.id,
    walletUserId: input.user.wallet_user_id,
    email: input.user.email,
    isNewUser: false,
  };
}

export async function signInWithGoogleOAuth(identity: VerifiedGoogleIdentity): Promise<GoogleOAuthUserResult> {
  const normalizedEmail = normalizeEmail(identity.email);

  return withDbTransaction(async (client) => {
    const existingByEmail = await findUserByEmail(client, normalizedEmail);
    const existingByProviderId = await findUserByGoogleProviderId(client, identity.providerId);

    if (existingByEmail && existingByProviderId && existingByEmail.id !== existingByProviderId.id) {
      throw new Error('Google OAuth conflict: provider identity is already linked to another account.');
    }

    if (existingByProviderId && !existingByEmail) {
      throw new Error('Google OAuth email mismatch: account must be matched by email.');
    }

    if (existingByEmail) {
      return updateExistingUserForGoogleOAuth({
        client,
        user: existingByEmail,
        identity,
      });
    }

    const appUserId = `usr_${randomBytes(12).toString('hex')}`;
    const walletUserId = await resolveWalletUserIdForNewUser(client);
    const providerPicture = normalizeOptionalText(identity.profilePicture, 1024);

    await ensureWalletPlaceholder(client, walletUserId);

    await client.query(
      `
        INSERT INTO app_users (
          id,
          email,
          wallet_user_id,
          oauth_provider,
          oauth_provider_id,
          profile_picture,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'google', $4, $5, NOW(), NOW())
      `,
      [appUserId, normalizedEmail, walletUserId, identity.providerId, providerPicture],
    );

    await ensureUserOnboardingState(client, appUserId);
    await ensureUserSettings(client, appUserId);
    await ensureUserProfileDefaults({
      client,
      walletUserId,
      email: normalizedEmail,
      fullName: normalizeOptionalText(identity.name, 200),
    });

    return {
      appUserId,
      walletUserId,
      email: normalizedEmail,
      isNewUser: true,
    };
  });
}
