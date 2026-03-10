import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SavedPaymentMethod } from '@/lib/types';
import { query } from '@/lib/server/db';

const DEFAULT_WALLET_SETTINGS = {
  maxTransaction: 50,
  dailyLimit: 100,
  monthlyBudget: 500,
  approvalThreshold: 10,
  requireLocation: true,
  allowedMerchants: [],
  blockedMerchants: [],
};

type PaymentMethodRow = {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_payment_method_id: string;
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
};

function toSavedPaymentMethod(row: PaymentMethodRow): SavedPaymentMethod {
  return {
    id: row.id,
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    stripePaymentMethodId: row.stripe_payment_method_id,
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

export async function getStripeCustomerIdForUser(userId: string): Promise<string | null> {
  await ensureWalletUserRow(userId);

  const result = await query<WalletUserCustomerRow>(
    `
      SELECT stripe_customer_id
      FROM wallet_users
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0]?.stripe_customer_id || null;
}

export async function setStripeCustomerIdForUser(userId: string, stripeCustomerId: string): Promise<void> {
  const normalized = stripeCustomerId.trim();
  if (!normalized) throw new Error('stripeCustomerId is required');

  await ensureWalletUserRow(userId);

  await query(
    `
      UPDATE wallet_users
      SET stripe_customer_id = $2,
          updated_at = NOW()
      WHERE user_id = $1
    `,
    [userId, normalized],
  );
}

export async function listSavedPaymentMethodsForUser(userId: string): Promise<SavedPaymentMethod[]> {
  const result = await query<PaymentMethodRow>(
    `
      SELECT
        id,
        user_id,
        stripe_customer_id,
        stripe_payment_method_id,
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

  return result.rows.map(toSavedPaymentMethod);
}

export async function getSavedPaymentMethodForUser(input: {
  userId: string;
  stripePaymentMethodId: string;
}): Promise<SavedPaymentMethod | null> {
  const pmId = input.stripePaymentMethodId.trim();
  if (!pmId) return null;

  const result = await query<PaymentMethodRow>(
    `
      SELECT
        id,
        user_id,
        stripe_customer_id,
        stripe_payment_method_id,
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
        AND stripe_payment_method_id = $2
      LIMIT 1
    `,
    [input.userId, pmId],
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
        stripe_payment_method_id,
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

  const result = await query<PaymentMethodRow>(
    `
      INSERT INTO wallet_payment_methods (
        id,
        user_id,
        stripe_customer_id,
        stripe_payment_method_id,
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW(), $11::jsonb, NOW(), NOW())
      ON CONFLICT (user_id, stripe_payment_method_id)
      DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
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
        stripe_payment_method_id,
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
      stripeCustomerId,
      stripePaymentMethodId,
      input.brand || null,
      input.last4 || null,
      input.expMonth || null,
      input.expYear || null,
      input.funding || null,
      shouldSetDefault,
      consentMetadata ? JSON.stringify(consentMetadata) : null,
    ],
  );

  if (!result.rows[0]) {
    throw new Error('Failed to save payment method');
  }

  await setStripeCustomerIdForUser(input.userId, stripeCustomerId);
  return toSavedPaymentMethod(result.rows[0]);
}

export async function markPaymentMethodRemovedForUser(input: {
  userId: string;
  stripePaymentMethodId: string;
}): Promise<boolean> {
  const paymentMethodId = input.stripePaymentMethodId.trim();
  if (!paymentMethodId) return false;

  const result = await query(
    `
      UPDATE wallet_payment_methods
      SET
        status = 'removed',
        is_default = FALSE,
        updated_at = NOW()
      WHERE user_id = $1
        AND stripe_payment_method_id = $2
        AND status = 'active'
      RETURNING id
    `,
    [input.userId, paymentMethodId],
  );

  return (result.rowCount || 0) > 0;
}

export async function markPaymentMethodRemovedByStripeId(stripePaymentMethodId: string): Promise<void> {
  const paymentMethodId = stripePaymentMethodId.trim();
  if (!paymentMethodId) return;

  await query(
    `
      UPDATE wallet_payment_methods
      SET
        status = 'removed',
        is_default = FALSE,
        updated_at = NOW()
      WHERE stripe_payment_method_id = $1
        AND status = 'active'
    `,
    [paymentMethodId],
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

  const updated = await query<{ user_id: string }>(
    `
      UPDATE wallet_payment_methods
      SET
        status = 'removed',
        is_default = FALSE,
        updated_at = NOW()
      WHERE stripe_payment_method_id = $1
        AND status = 'active'
      RETURNING user_id
    `,
    [paymentMethodId],
  );

  return Array.from(new Set(updated.rows.map((row) => row.user_id)));
}
