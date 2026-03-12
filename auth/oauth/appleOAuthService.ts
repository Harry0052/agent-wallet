import 'server-only';

import { randomBytes } from 'node:crypto';
import type { SecureDbClient } from '@/database/dbService';
import { withDbTransaction } from '@/lib/server/db';
import type { VerifiedAppleIdentity } from '@/auth/oauth/appleOAuth';

type AppUserRow = {
  id: string;
  email: string;
  wallet_user_id: string;
  oauth_provider: string | null;
};

export interface AppleOAuthUserResult {
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

async function findUserByEmail(client: SecureDbClient, email: string): Promise<AppUserRow | null> {
  const result = await client.query<AppUserRow>(
    `
      SELECT id, email, wallet_user_id, oauth_provider
      FROM app_users
      WHERE email = $1
      LIMIT 1
    `,
    [email],
  );

  return result.rows[0] || null;
}

async function findUserByAppleProviderId(client: SecureDbClient, providerId: string): Promise<AppUserRow | null> {
  const result = await client.query<AppUserRow>(
    `
      SELECT id, email, wallet_user_id, oauth_provider
      FROM app_users
      WHERE oauth_provider = 'apple'
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

async function updateExistingUserForAppleOAuth(input: {
  client: SecureDbClient;
  user: AppUserRow;
  identity: VerifiedAppleIdentity;
  displayName: string | null;
}): Promise<AppleOAuthUserResult> {
  await input.client.query(
    `
      UPDATE app_users
      SET
        oauth_provider = CASE
          WHEN oauth_provider IS NULL OR oauth_provider = 'apple' THEN 'apple'
          ELSE oauth_provider
        END,
        oauth_provider_id = CASE
          WHEN oauth_provider IS NULL OR oauth_provider = 'apple' THEN $2
          ELSE oauth_provider_id
        END,
        updated_at = NOW()
      WHERE id = $1
    `,
    [input.user.id, input.identity.providerId],
  );

  await ensureWalletPlaceholder(input.client, input.user.wallet_user_id);
  await ensureUserOnboardingState(input.client, input.user.id);
  await ensureUserSettings(input.client, input.user.id);
  await ensureUserProfileDefaults({
    client: input.client,
    walletUserId: input.user.wallet_user_id,
    email: input.user.email,
    fullName: normalizeOptionalText(input.displayName, 200),
  });

  return {
    appUserId: input.user.id,
    walletUserId: input.user.wallet_user_id,
    email: input.user.email,
    isNewUser: false,
  };
}

export async function signInWithAppleOAuth(input: {
  identity: VerifiedAppleIdentity;
  displayName?: string | null;
}): Promise<AppleOAuthUserResult> {
  const normalizedEmail = normalizeEmail(input.identity.email);
  const displayName = normalizeOptionalText(input.displayName || null, 200);

  return withDbTransaction(async (client) => {
    const existingByEmail = await findUserByEmail(client, normalizedEmail);
    const existingByProviderId = await findUserByAppleProviderId(client, input.identity.providerId);

    if (existingByEmail && existingByProviderId && existingByEmail.id !== existingByProviderId.id) {
      throw new Error('Apple OAuth conflict: provider identity is already linked to another account.');
    }

    if (!existingByEmail && existingByProviderId) {
      return updateExistingUserForAppleOAuth({
        client,
        user: existingByProviderId,
        identity: input.identity,
        displayName,
      });
    }

    if (existingByEmail) {
      return updateExistingUserForAppleOAuth({
        client,
        user: existingByEmail,
        identity: input.identity,
        displayName,
      });
    }

    const appUserId = `usr_${randomBytes(12).toString('hex')}`;
    const walletUserId = await resolveWalletUserIdForNewUser(client);

    await ensureWalletPlaceholder(client, walletUserId);

    await client.query(
      `
        INSERT INTO app_users (
          id,
          email,
          wallet_user_id,
          oauth_provider,
          oauth_provider_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'apple', $4, NOW(), NOW())
      `,
      [appUserId, normalizedEmail, walletUserId, input.identity.providerId],
    );

    await ensureUserOnboardingState(client, appUserId);
    await ensureUserSettings(client, appUserId);
    await ensureUserProfileDefaults({
      client,
      walletUserId,
      email: normalizedEmail,
      fullName: displayName,
    });

    return {
      appUserId,
      walletUserId,
      email: normalizedEmail,
      isNewUser: true,
    };
  });
}
