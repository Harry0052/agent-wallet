import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SavedPaymentMethod } from '@/lib/types';
import { query } from '@/lib/server/db';
import { decryptData, encryptData, hashSensitiveValue } from '@/security/encryption';

const DEFAULT_WALLET_SETTINGS = {
  maxTransaction: 50,
  dailyLimit: 100,
  monthlyBudget: 500,
  approvalThreshold: 10,
  requireLocation: true,
  allowedMerchants: [],
  blockedMerchants: [],
};

const HASH_PREFIX = 'h1:';
const STRIPE_CUSTOMER_HASH_SCOPE = 'wallet_users.stripe_customer_id';
const STRIPE_PAYMENT_METHOD_HASH_SCOPE = 'wallet_payment_methods.stripe_payment_method_id';

type PaymentMethodRow = {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_customer_id_encrypted: string | null;
  stripe_customer_id_key_version: string | null;
  stripe_payment_method_id: string;
  stripe_payment_method_id_encrypted: string | null;
  stripe_payment_method_id_key_version: string | null;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  funding: string | null;
  is_default: boolean;
  status: 'active' | 'removed';
  consented_at: string;
  consent_metadata: Record<string, string> | null;
  created_at: string;
  updated_at: string;
};

type WalletUserCustomerRow = {
  stripe_customer_id: string | null;
  stripe_customer_id_encrypted: string | null;
  stripe_customer_id_key_version: string | null;
};

function hashStripeCustomerId(value: string): string {
  return hashSensitiveValue(value, STRIPE_CUSTOMER_HASH_SCOPE);
}

function hashStripePaymentMethodId(value: string): string {
  return hashSensitiveValue(value, STRIPE_PAYMENT_METHOD_HASH_SCOPE);
}

function looksHashed(value: string): boolean {
  return value.startsWith(HASH_PREFIX);
}

function decryptSensitiveString(input: {
  encrypted: string | null;
  keyVersion: string | null;
  fallback: string | null;
}): string | null {
  if (input.encrypted && input.keyVersion) {
    try {
      const decrypted = decryptData<unknown>(input.encrypted, input.keyVersion);
      if (typeof decrypted === 'string' && decrypted.trim()) {
        return decrypted;
      }
    } catch {
      // Fall back for legacy plaintext rows.
    }
  }

  if (!input.fallback) return null;
  if (looksHashed(input.fallback)) return null;
  return input.fallback;
}

function toSavedPaymentMethod(row: PaymentMethodRow): SavedPaymentMethod | null {
  const stripeCustomerId = decryptSensitiveString({
    encrypted: row.stripe_customer_id_encrypted,
    keyVersion: row.stripe_customer_id_key_version,
    fallback: row.stripe_customer_id,
  });
  const stripePaymentMethodId = decryptSensitiveString({
    encrypted: row.stripe_payment_method_id_encrypted,
    keyVersion: row.stripe_payment_method_id_key_version,
    fallback: row.stripe_payment_method_id,
  });

  if (!stripeCustomerId || !stripePaymentMethodId) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    stripeCustomerId,
    stripePaymentMethodId,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    funding: row.funding,
    isDefault: row.is_default,
    status: row.status,
    consentedAt: row.consented_at,
    consentMetadata: row.consent_metadata || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureWalletUserRow(userId: string): Promise<void> {
  await query(
    `
      INSERT INTO wallet_users (user_id, currency, settings)
      VALUES ($1, 'usd', $2::jsonb)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId, JSON.stringify(DEFAULT_WALLET_SETTINGS)],
  );
}

function normalizeConsentMetadata(input: Record<string, unknown> | null | undefined): Record<string, string> | null {
  if (!input) return null;
  const entries = Object.entries(input)
    .map(([key, value]) => {
      if (typeof value === 'string') return [key, value.trim()] as const;
      if (typeof value === 'number' || typeof value === 'boolean') return [key, String(value)] as const;
      return [key, ''] as const;
    })
    .filter(([, value]) => value.length > 0)
    .slice(0, 24);

  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

async function readActiveCustomerFromSavedMethod(userId: string): Promise<string | null> {
  const result = await query<{
    stripe_customer_id: string;
    stripe_customer_id_encrypted: string | null;
    stripe_customer_id_key_version: string | null;
  }>(
    `
      SELECT
        stripe_customer_id,
        stripe_customer_id_encrypted,
        stripe_customer_id_key_version
      FROM wallet_payment_methods
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1
    `,
    [userId],
  );

  const row = result.rows[0];
  if (!row) return null;
  return decryptSensitiveString({
    encrypted: row.stripe_customer_id_encrypted,
    keyVersion: row.stripe_customer_id_key_version,
    fallback: row.stripe_customer_id,
  });
}

export async function getStripeCustomerIdForUser(userId: string): Promise<string | null> {
  await ensureWalletUserRow(userId);

  const result = await query<WalletUserCustomerRow>(
    `
      SELECT
        stripe_customer_id,
        stripe_customer_id_encrypted,
        stripe_customer_id_key_version
      FROM wallet_users
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  const current = result.rows[0];
  const decrypted = current
    ? decryptSensitiveString({
      encrypted: current.stripe_customer_id_encrypted,
      keyVersion: current.stripe_customer_id_key_version,
      fallback: current.stripe_customer_id,
    })
    : null;

  if (decrypted) {
    return decrypted;
  }

  const recovered = await readActiveCustomerFromSavedMethod(userId);
  if (recovered) {
    await setStripeCustomerIdForUser(userId, recovered);
  }
  return recovered;
}

export async function setStripeCustomerIdForUser(userId: string, stripeCustomerId: string): Promise<void> {
  const normalized = stripeCustomerId.trim();
  if (!normalized) throw new Error('stripeCustomerId is required');

  await ensureWalletUserRow(userId);

  const encrypted = encryptData(normalized);
  const hashed = hashStripeCustomerId(normalized);

  await query(
    `
      UPDATE wallet_users
      SET stripe_customer_id = $2,
          stripe_customer_id_encrypted = $3,
          stripe_customer_id_key_version = $4,
          updated_at = NOW()
      WHERE user_id = $1
    `,
    [userId, hashed, encrypted.encrypted, encrypted.keyVersion],
  );
}

export async function listSavedPaymentMethodsForUser(userId: string): Promise<SavedPaymentMethod[]> {
  const result = await query<PaymentMethodRow>(
    `
      SELECT
        id,
        user_id,
        stripe_customer_id,
        stripe_customer_id_encrypted,
        stripe_customer_id_key_version,
        stripe_payment_method_id,
        stripe_payment_method_id_encrypted,
        stripe_payment_method_id_key_version,
        brand,
        last4,
        exp_month,
        exp_year,
        funding,
        is_default,
        status,
        consented_at::text,
        consent_metadata,
        created_at::text,
        updated_at::text
      FROM wallet_payment_methods
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY is_default DESC, updated_at DESC
    `,
    [userId],
  );

  return result.rows
    .map(toSavedPaymentMethod)
    .filter((method): method is SavedPaymentMethod => Boolean(method));
}

export async function getSavedPaymentMethodForUser(input: {
  userId: string;
  stripePaymentMethodId: string;
}): Promise<SavedPaymentMethod | null> {
  const pmId = input.stripePaymentMethodId.trim();
  if (!pmId) return null;
  const pmHash = hashStripePaymentMethodId(pmId);

  const result = await query<PaymentMethodRow>(
    `
      SELECT
        id,
        user_id,
        stripe_customer_id,
        stripe_customer_id_encrypted,
        stripe_customer_id_key_version,
        stripe_payment_method_id,
        stripe_payment_method_id_encrypted,
        stripe_payment_method_id_key_version,
        brand,
        last4,
        exp_month,
        exp_year,
        funding,
        is_default,
        status,
        consented_at::text,
        consent_metadata,
        created_at::text,
        updated_at::text
      FROM wallet_payment_methods
      WHERE user_id = $1
        AND (stripe_payment_method_id = $2 OR stripe_payment_method_id = $3)
      LIMIT 1
    `,
    [input.userId, pmHash, pmId],
  );

  if (!result.rows[0]) return null;
  return toSavedPaymentMethod(result.rows[0]);
}

export async function getDefaultSavedPaymentMethodForUser(userId: string): Promise<SavedPaymentMethod | null> {
  const result = await query<PaymentMethodRow>(
    `
      SELECT
        id,
        user_id,
        stripe_customer_id,
        stripe_customer_id_encrypted,
        stripe_customer_id_key_version,
        stripe_payment_method_id,
        stripe_payment_method_id_encrypted,
        stripe_payment_method_id_key_version,
        brand,
        last4,
        exp_month,
        exp_year,
        funding,
        is_default,
        status,
        consented_at::text,
        consent_metadata,
        created_at::text,
        updated_at::text
      FROM wallet_payment_methods
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1
    `,
    [userId],
  );

  if (!result.rows[0]) return null;
  return toSavedPaymentMethod(result.rows[0]);
}

export async function upsertSavedPaymentMethodForUser(input: {
  userId: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  funding?: string | null;
  consentMetadata?: Record<string, unknown> | null;
  setAsDefault?: boolean;
}): Promise<SavedPaymentMethod> {
  const stripeCustomerId = input.stripeCustomerId.trim();
  const stripePaymentMethodId = input.stripePaymentMethodId.trim();
  if (!stripeCustomerId) throw new Error('stripeCustomerId is required');
  if (!stripePaymentMethodId) throw new Error('stripePaymentMethodId is required');

  const hashedCustomerId = hashStripeCustomerId(stripeCustomerId);
  const hashedPaymentMethodId = hashStripePaymentMethodId(stripePaymentMethodId);
  const encryptedCustomerId = encryptData(stripeCustomerId);
  const encryptedPaymentMethodId = encryptData(stripePaymentMethodId);

  await ensureWalletUserRow(input.userId);

  const shouldSetDefault = input.setAsDefault !== false;
  if (shouldSetDefault) {
    await query(
      `
        UPDATE wallet_payment_methods
        SET is_default = FALSE,
            updated_at = NOW()
        WHERE user_id = $1
      `,
      [input.userId],
    );
  }

  const consentMetadata = normalizeConsentMetadata(input.consentMetadata);

  // Migrate legacy plaintext key rows before relying on hash-based uniqueness.
  await query(
    `
      UPDATE wallet_payment_methods
      SET
        stripe_customer_id = $3,
        stripe_customer_id_encrypted = $4,
        stripe_customer_id_key_version = $5,
        stripe_payment_method_id = $6,
        stripe_payment_method_id_encrypted = $7,
        stripe_payment_method_id_key_version = $8,
        updated_at = NOW()
      WHERE user_id = $1
        AND stripe_payment_method_id = $2
    `,
    [
      input.userId,
      stripePaymentMethodId,
      hashedCustomerId,
      encryptedCustomerId.encrypted,
      encryptedCustomerId.keyVersion,
      hashedPaymentMethodId,
      encryptedPaymentMethodId.encrypted,
      encryptedPaymentMethodId.keyVersion,
    ],
  );

  const result = await query<PaymentMethodRow>(
    `
      INSERT INTO wallet_payment_methods (
        id,
        user_id,
        stripe_customer_id,
        stripe_customer_id_encrypted,
        stripe_customer_id_key_version,
        stripe_payment_method_id,
        stripe_payment_method_id_encrypted,
        stripe_payment_method_id_key_version,
        brand,
        last4,
        exp_month,
        exp_year,
        funding,
        is_default,
        status,
        consented_at,
        consent_metadata,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active', NOW(), $15::jsonb, NOW(), NOW())
      ON CONFLICT (user_id, stripe_payment_method_id)
      DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_customer_id_encrypted = EXCLUDED.stripe_customer_id_encrypted,
        stripe_customer_id_key_version = EXCLUDED.stripe_customer_id_key_version,
        stripe_payment_method_id_encrypted = EXCLUDED.stripe_payment_method_id_encrypted,
        stripe_payment_method_id_key_version = EXCLUDED.stripe_payment_method_id_key_version,
        brand = COALESCE(EXCLUDED.brand, wallet_payment_methods.brand),
        last4 = COALESCE(EXCLUDED.last4, wallet_payment_methods.last4),
        exp_month = COALESCE(EXCLUDED.exp_month, wallet_payment_methods.exp_month),
        exp_year = COALESCE(EXCLUDED.exp_year, wallet_payment_methods.exp_year),
        funding = COALESCE(EXCLUDED.funding, wallet_payment_methods.funding),
        is_default = EXCLUDED.is_default,
        status = 'active',
        consented_at = NOW(),
        consent_metadata = COALESCE(EXCLUDED.consent_metadata, wallet_payment_methods.consent_metadata),
        updated_at = NOW()
      RETURNING
        id,
        user_id,
        stripe_customer_id,
        stripe_customer_id_encrypted,
        stripe_customer_id_key_version,
        stripe_payment_method_id,
        stripe_payment_method_id_encrypted,
        stripe_payment_method_id_key_version,
        brand,
        last4,
        exp_month,
        exp_year,
        funding,
        is_default,
        status,
        consented_at::text,
        consent_metadata,
        created_at::text,
        updated_at::text
    `,
    [
      randomUUID(),
      input.userId,
      hashedCustomerId,
      encryptedCustomerId.encrypted,
      encryptedCustomerId.keyVersion,
      hashedPaymentMethodId,
      encryptedPaymentMethodId.encrypted,
      encryptedPaymentMethodId.keyVersion,
      input.brand || null,
      input.last4 || null,
      input.expMonth || null,
      input.expYear || null,
      input.funding || null,
      shouldSetDefault,
      consentMetadata ? JSON.stringify(consentMetadata) : null,
    ],
  );

  const saved = result.rows[0] ? toSavedPaymentMethod(result.rows[0]) : null;
  if (!saved) {
    throw new Error('Failed to save payment method');
  }

  await setStripeCustomerIdForUser(input.userId, stripeCustomerId);
  return saved;
}

export async function markPaymentMethodRemovedForUser(input: {
  userId: string;
  stripePaymentMethodId: string;
}): Promise<boolean> {
  const paymentMethodId = input.stripePaymentMethodId.trim();
  if (!paymentMethodId) return false;
  const paymentMethodHash = hashStripePaymentMethodId(paymentMethodId);

  const result = await query(
    `
      UPDATE wallet_payment_methods
      SET
        status = 'removed',
        is_default = FALSE,
        updated_at = NOW()
      WHERE user_id = $1
        AND (stripe_payment_method_id = $2 OR stripe_payment_method_id = $3)
        AND status = 'active'
      RETURNING id
    `,
    [input.userId, paymentMethodHash, paymentMethodId],
  );

  return (result.rowCount || 0) > 0;
}

export async function markPaymentMethodRemovedByStripeId(stripePaymentMethodId: string): Promise<void> {
  const paymentMethodId = stripePaymentMethodId.trim();
  if (!paymentMethodId) return;
  const paymentMethodHash = hashStripePaymentMethodId(paymentMethodId);

  await query(
    `
      UPDATE wallet_payment_methods
      SET
        status = 'removed',
        is_default = FALSE,
        updated_at = NOW()
      WHERE (stripe_payment_method_id = $1 OR stripe_payment_method_id = $2)
        AND status = 'active'
    `,
    [paymentMethodHash, paymentMethodId],
  );
}

export async function listUsersWithActivePaymentMethods(userId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `
      SELECT id
      FROM wallet_payment_methods
      WHERE user_id = $1
        AND status = 'active'
      LIMIT 1
    `,
    [userId],
  );

  return Boolean(result.rows[0]);
}

export async function markPaymentMethodRemovedByStripeIdWithUsers(stripePaymentMethodId: string): Promise<string[]> {
  const paymentMethodId = stripePaymentMethodId.trim();
  if (!paymentMethodId) return [];
  const paymentMethodHash = hashStripePaymentMethodId(paymentMethodId);

  const updated = await query<{ user_id: string }>(
    `
      UPDATE wallet_payment_methods
      SET
        status = 'removed',
        is_default = FALSE,
        updated_at = NOW()
      WHERE (stripe_payment_method_id = $1 OR stripe_payment_method_id = $2)
        AND status = 'active'
      RETURNING user_id
    `,
    [paymentMethodHash, paymentMethodId],
  );

  return Array.from(new Set(updated.rows.map((row) => row.user_id)));
}
