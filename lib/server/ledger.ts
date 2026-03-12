import { randomUUID } from 'node:crypto';
import type { Recipient, Transaction, UserAutofillProfile, Wallet, WalletSettings } from '@/lib/types';
import { query } from '@/lib/server/db';
import { logServerEvent } from '@/lib/server/observability';
import { getWalletUserIdFromSession } from '@/lib/server/auth';
import { decryptData, encryptData, hashSensitiveValue } from '@/security/encryption';
import { minimizeTransactionMetadata } from '@/security/dataMinimization';
import { enforceTransactionGuardrails } from '@/security/transactionGuard';

const DEFAULT_SETTINGS: WalletSettings = {
  maxTransaction: 50,
  dailyLimit: 100,
  monthlyBudget: 500,
  approvalThreshold: 10,
  requireLocation: true,
  allowedMerchants: [],
  blockedMerchants: [],
};

type UserRow = {
  user_id: string;
  currency: string;
  settings: unknown;
};

type LedgerRow = {
  id: string;
  user_id: string;
  type: Transaction['type'];
  amount: string;
  currency: string;
  direction: Transaction['direction'];
  status: Transaction['status'];
  provider: string | null;
  provider_reference_id: string | null;
  stripe_event_id: string | null;
  description: string;
  source_url: string | null;
  merchant: string | null;
  recipient_id: string | null;
  metadata: Record<string, string> | null;
  created_at: string;
};

type RecipientRow = {
  id: string;
  user_id: string;
  name: string;
  send_method: 'cash_app' | 'stripe_connected' | 'bank' | null;
  stripe_account_id: string | null;
  cash_app_cashtag: string | null;
  bank_reference: string | null;
  bank_reference_encrypted: string | null;
  bank_reference_key_version: string | null;
  aliases: unknown;
  default_currency: string | null;
  notes: string | null;
  status: Recipient['status'] | null;
  created_at: string;
};

type AutofillProfileRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  billing_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country: string | null;
  created_at: string;
  updated_at: string;
};

type WebActionLogRow = {
  id: string;
  task_id: string | null;
  action_type: string;
  url: string | null;
  status: 'done' | 'error' | 'running';
  details: Record<string, unknown> | null;
  created_at: string;
};

type AgentTaskRow = {
  id: string;
  user_id: string;
  task_type: string;
  intent: string;
  status: string;
  input: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const HASH_PREFIX = 'h1:';
const BANK_REFERENCE_HASH_SCOPE = 'recipients.bank_reference';

function normalizeSettings(input: unknown): WalletSettings {
  const raw = (input && typeof input === 'object') ? (input as Partial<WalletSettings>) : {};
  const merged = { ...DEFAULT_SETTINGS, ...raw };

  return {
    maxTransaction: Math.max(1, Math.round(merged.maxTransaction)),
    dailyLimit: Math.max(1, Math.round(merged.dailyLimit)),
    monthlyBudget: Math.max(1, Math.round(merged.monthlyBudget)),
    approvalThreshold: Math.max(1, Math.round(merged.approvalThreshold)),
    requireLocation: Boolean(merged.requireLocation),
    allowedMerchants: Array.isArray(merged.allowedMerchants)
      ? merged.allowedMerchants.map((m) => m.trim()).filter(Boolean)
      : [],
    blockedMerchants: Array.isArray(merged.blockedMerchants)
      ? merged.blockedMerchants.map((m) => m.trim()).filter(Boolean)
      : [],
  };
}

function rowToTransaction(row: LedgerRow): Transaction {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amount: Number(row.amount),
    currency: row.currency,
    direction: row.direction,
    stripeObjectId: row.provider_reference_id || undefined,
    stripeEventId: row.stripe_event_id || undefined,
    description: row.description,
    merchant: row.merchant || undefined,
    recipientId: row.recipient_id || undefined,
    status: row.status,
    source: (row.provider as Transaction['source']) || undefined,
    metadata: row.metadata || undefined,
    createdAt: row.created_at,
  };
}

function decryptBankReference(row: Pick<RecipientRow, 'bank_reference' | 'bank_reference_encrypted' | 'bank_reference_key_version'>): string | null {
  if (row.bank_reference_encrypted && row.bank_reference_key_version) {
    try {
      const decrypted = decryptData<unknown>(row.bank_reference_encrypted, row.bank_reference_key_version);
      if (typeof decrypted === 'string' && decrypted.trim()) {
        return decrypted;
      }
    } catch {
      // Fall back for legacy plaintext rows.
    }
  }

  if (!row.bank_reference) return null;
  if (row.bank_reference.startsWith(HASH_PREFIX)) return null;
  return row.bank_reference;
}

function rowToRecipient(row: RecipientRow): Recipient {
  const status = row.status === 'blocked' || row.status === 'pending' || row.status === 'approved'
    ? row.status
    : 'approved';
  const sendMethod = row.send_method === 'cash_app' || row.send_method === 'bank' || row.send_method === 'stripe_connected'
    ? row.send_method
    : 'stripe_connected';
  const aliases = Array.isArray(row.aliases)
    ? row.aliases.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    sendMethod,
    stripeAccountId: row.stripe_account_id || null,
    cashAppCashtag: row.cash_app_cashtag || null,
    bankReference: decryptBankReference(row),
    aliases,
    defaultCurrency: (row.default_currency || 'usd').toUpperCase(),
    notes: row.notes || undefined,
    status,
    createdAt: row.created_at,
  };
}

function rowToAutofillProfile(row: AutofillProfileRow): UserAutofillProfile {
  return {
    userId: row.user_id,
    fullName: row.full_name || undefined,
    email: row.email || undefined,
    phone: row.phone || undefined,
    companyName: row.company_name || undefined,
    billingName: row.billing_name || undefined,
    addressLine1: row.address_line1 || undefined,
    addressLine2: row.address_line2 || undefined,
    city: row.city || undefined,
    stateRegion: row.state_region || undefined,
    postalCode: row.postal_code || undefined,
    country: row.country || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computeBalance(transactions: Transaction[]): number {
  const value = transactions.reduce((acc, tx) => {
    if (tx.status !== 'succeeded') return acc;
    return tx.direction === 'credit' ? acc + tx.amount : acc - tx.amount;
  }, 0);

  return Math.round(value * 100) / 100;
}

function startOfMonthMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function sumSucceededDebitsSince(transactions: Transaction[], sinceMs: number): number {
  return Math.round(transactions.reduce((acc, tx) => {
    if (tx.status !== 'succeeded' || tx.direction !== 'debit') return acc;
    const createdAt = Date.parse(tx.createdAt);
    if (Number.isNaN(createdAt) || createdAt < sinceMs) return acc;
    return acc + tx.amount;
  }, 0) * 100) / 100;
}

function merchantMatches(name: string | undefined, list: string[]): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  return list.some((item) => normalized.includes(item.toLowerCase()));
}

function normalizeRequiredText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeJsonRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const normalized = JSON.parse(JSON.stringify(value, (_key, item) => {
      return item === undefined ? null : item;
    })) as unknown;
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
    return normalized as Record<string, unknown>;
  } catch {
    return {
      normalizationError: 'unserializable_payload',
    };
  }
}

const SENSITIVE_KEY_PATTERN = /(password|passcode|secret|token|api[_-]?key|credential|authorization|cookie|session)/i;
const SENSITIVE_VALUE_PATTERN = /\b(password|passcode|credential|token|api\s*key|secret|authorization|cookie|session)\b\s*(?:is|=|:)\s*([^\s,;]+)/gi;
const BEARER_VALUE_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/=]+\b/gi;

function redactSensitiveText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  const withLabeledRedaction = trimmed.replace(
    SENSITIVE_VALUE_PATTERN,
    (_match, label: string) => `${label}=[redacted]`,
  );

  return withLabeledRedaction.replace(BEARER_VALUE_PATTERN, 'Bearer [redacted]');
}

function sanitizeSensitivePayload(value: unknown, keyHint?: string): unknown {
  if (typeof value === 'string') {
    if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) {
      return '[redacted]';
    }
    return redactSensitiveText(value);
  }

  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSensitivePayload(item));
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    output[key] = sanitizeSensitivePayload(item, key);
  }
  return output;
}

async function ensureUser(userId: string): Promise<void> {
  await query(
    `
      INSERT INTO wallet_users (user_id, currency, settings)
      VALUES ($1, 'usd', $2::jsonb)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId, JSON.stringify(DEFAULT_SETTINGS)],
  );
}

async function getUserRow(userId: string): Promise<UserRow> {
  await ensureUser(userId);
  const result = await query<UserRow>(
    `SELECT user_id, currency, settings FROM wallet_users WHERE user_id = $1`,
    [userId],
  );

  if (!result.rows[0]) {
    throw new Error(`Wallet user not found: ${userId}`);
  }

  return result.rows[0];
}

export async function getWalletUserId(): Promise<string> {
  return getWalletUserIdFromSession();
}

async function listRecipientsForUser(userId: string): Promise<Recipient[]> {
  const recipientResult = await query<RecipientRow>(
    `
      WITH normalized AS (
        SELECT
          r.id,
          r.user_id,
          r.name,
          r.send_method,
          r.stripe_account_id,
          r.cash_app_cashtag,
          r.bank_reference,
          r.bank_reference_encrypted,
          r.bank_reference_key_version,
          r.aliases,
          r.default_currency,
          r.notes,
          COALESCE(wr.status, 'approved') AS status,
          r.created_at::text AS created_at
        FROM recipients r
        LEFT JOIN wallet_recipients wr
          ON wr.id = r.id
         AND wr.user_id = r.user_id
        WHERE r.user_id = $1

        UNION ALL

        SELECT
          wr.id,
          wr.user_id,
          wr.name,
          'stripe_connected'::text AS send_method,
          wr.stripe_account_id,
          NULL::text AS cash_app_cashtag,
          NULL::text AS bank_reference,
          NULL::text AS bank_reference_encrypted,
          NULL::text AS bank_reference_key_version,
          '[]'::jsonb AS aliases,
          'usd'::text AS default_currency,
          NULL::text AS notes,
          wr.status,
          wr.created_at::text AS created_at
        FROM wallet_recipients wr
        WHERE wr.user_id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM recipients r
            WHERE r.id = wr.id
              AND r.user_id = wr.user_id
          )
      )
      SELECT id, user_id, name, send_method, stripe_account_id, cash_app_cashtag, bank_reference, bank_reference_encrypted, bank_reference_key_version, aliases, default_currency, notes, status, created_at
      FROM normalized
      ORDER BY created_at DESC
    `,
    [userId],
  );

  return recipientResult.rows.map(rowToRecipient);
}

export async function listRecipients(userId: string): Promise<Recipient[]> {
  return listRecipientsForUser(userId);
}

export async function getWallet(userId: string): Promise<Wallet> {
  const user = await getUserRow(userId);

  const txResult = await query<LedgerRow>(
    `
      SELECT id, user_id, type, amount::text, currency, direction, status,
             provider, provider_reference_id, stripe_event_id, description,
             source_url, merchant, recipient_id, metadata, created_at::text
      FROM ledger_entries
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 500
    `,
    [userId],
  );

  const transactions = txResult.rows.map(rowToTransaction);
  const recipients = await listRecipientsForUser(userId);

  return {
    balance: computeBalance(transactions),
    currency: user.currency.toUpperCase(),
    transactions,
    settings: normalizeSettings(user.settings),
    recipients,
  };
}

export async function updateWalletSettings(userId: string, updates: Partial<WalletSettings>): Promise<Wallet> {
  const user = await getUserRow(userId);
  const next = normalizeSettings({ ...normalizeSettings(user.settings), ...updates });

  await query(
    `
      UPDATE wallet_users
      SET settings = $2::jsonb,
          updated_at = NOW()
      WHERE user_id = $1
    `,
    [userId, JSON.stringify(next)],
  );

  return getWallet(userId);
}

export async function addRecipient(
  userId: string,
  name: string,
  stripeAccountId: string,
  status: Recipient['status'] = 'approved',
  notes?: string,
): Promise<Recipient> {
  return upsertRecipientDelivery({
    userId,
    name,
    sendMethod: 'stripe_connected',
    stripeAccountId,
    status,
    notes,
    aliases: [name],
  });
}

function normalizeAliasList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

async function fetchRecipientById(userId: string, recipientId: string): Promise<Recipient | null> {
  const result = await query<RecipientRow>(
    `
      SELECT
        r.id,
        r.user_id,
        r.name,
        r.send_method,
        r.stripe_account_id,
        r.cash_app_cashtag,
        r.bank_reference,
        r.bank_reference_encrypted,
        r.bank_reference_key_version,
        r.aliases,
        r.default_currency,
        r.notes,
        COALESCE(wr.status, 'approved') AS status,
        r.created_at::text AS created_at
      FROM recipients r
      LEFT JOIN wallet_recipients wr
        ON wr.id = r.id
       AND wr.user_id = r.user_id
      WHERE r.id = $1
        AND r.user_id = $2
      LIMIT 1
    `,
    [recipientId, userId],
  );

  if (!result.rows[0]) return null;
  return rowToRecipient(result.rows[0]);
}

export async function upsertRecipientDelivery(params: {
  userId: string;
  name: string;
  sendMethod: Recipient['sendMethod'];
  stripeAccountId?: string | null;
  cashAppCashtag?: string | null;
  bankReference?: string | null;
  status?: Recipient['status'];
  notes?: string;
  aliases?: string[];
}): Promise<Recipient> {
  const trimmedName = params.name.trim();
  if (!trimmedName) {
    throw new Error('Recipient name is required');
  }

  const normalizedAliases = normalizeAliasList([
    trimmedName,
    ...(params.aliases || []),
  ]);

  const existing = await query<{ id: string }>(
    `
      SELECT r.id
      FROM recipients r
      WHERE r.user_id = $1
        AND (
          lower(r.name) = lower($2)
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(r.aliases, '[]'::jsonb)) AS alias(value)
            WHERE lower(alias.value) = lower($2)
          )
        )
      ORDER BY r.created_at DESC
      LIMIT 1
    `,
    [params.userId, trimmedName],
  );

  const recipientId = existing.rows[0]?.id || randomUUID();
  const normalizedBankReference = params.bankReference?.trim() || null;
  const encryptedBankReference = normalizedBankReference ? encryptData(normalizedBankReference) : null;
  const bankReferenceHash = normalizedBankReference
    ? hashSensitiveValue(normalizedBankReference, BANK_REFERENCE_HASH_SCOPE)
    : null;

  if (existing.rows[0]) {
    await query(
      `
        UPDATE recipients
        SET
          send_method = $3,
          stripe_account_id = COALESCE($4, stripe_account_id),
          cash_app_cashtag = COALESCE($5, cash_app_cashtag),
          bank_reference = COALESCE($6, bank_reference),
          bank_reference_encrypted = COALESCE($7, bank_reference_encrypted),
          bank_reference_key_version = COALESCE($8, bank_reference_key_version),
          aliases = (
            SELECT COALESCE(jsonb_agg(DISTINCT alias), '[]'::jsonb)
            FROM (
              SELECT jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb)) AS alias
              UNION ALL
              SELECT jsonb_array_elements_text($9::jsonb) AS alias
            ) merged
          ),
          notes = COALESCE($10, notes),
          updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
      `,
      [
        recipientId,
        params.userId,
        params.sendMethod,
        params.stripeAccountId?.trim() || null,
        params.cashAppCashtag?.trim() || null,
        bankReferenceHash,
        encryptedBankReference?.encrypted || null,
        encryptedBankReference?.keyVersion || null,
        JSON.stringify(normalizedAliases),
        params.notes?.trim() || null,
      ],
    );
  } else {
    await query(
      `
        INSERT INTO recipients (
          id,
          user_id,
          name,
          send_method,
          stripe_account_id,
          cash_app_cashtag,
          bank_reference,
          bank_reference_encrypted,
          bank_reference_key_version,
          aliases,
          default_currency,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'usd', $11)
      `,
      [
        recipientId,
        params.userId,
        trimmedName,
        params.sendMethod,
        params.stripeAccountId?.trim() || null,
        params.cashAppCashtag?.trim() || null,
        bankReferenceHash,
        encryptedBankReference?.encrypted || null,
        encryptedBankReference?.keyVersion || null,
        JSON.stringify(normalizedAliases),
        params.notes?.trim() || null,
      ],
    );
  }

  if (params.sendMethod === 'stripe_connected') {
    const stripeAccountId = params.stripeAccountId?.trim() || null;
    if (!stripeAccountId) {
      throw new Error('Stripe recipient requires stripeAccountId');
    }

    await query(
      `
        INSERT INTO wallet_recipients (id, user_id, name, stripe_account_id, status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE
        SET
          name = EXCLUDED.name,
          stripe_account_id = EXCLUDED.stripe_account_id,
          status = EXCLUDED.status,
          updated_at = NOW()
      `,
      [recipientId, params.userId, trimmedName, stripeAccountId, params.status || 'approved'],
    );
  }

  const recipient = await fetchRecipientById(params.userId, recipientId);
  if (!recipient) {
    throw new Error('Failed to save recipient');
  }

  return recipient;
}

export async function setRecipientStatus(
  userId: string,
  recipientId: string,
  status: Recipient['status'],
): Promise<Recipient | null> {
  let result = await query<RecipientRow>(
    `
      UPDATE wallet_recipients
      SET status = $3,
          updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING
        id,
        user_id,
        name,
        'stripe_connected'::text AS send_method,
        stripe_account_id,
        NULL::text AS cash_app_cashtag,
        NULL::text AS bank_reference,
        NULL::text AS bank_reference_encrypted,
        NULL::text AS bank_reference_key_version,
        '[]'::jsonb AS aliases,
        'usd'::text AS default_currency,
        NULL::text AS notes,
        status,
        created_at::text AS created_at
    `,
    [recipientId, userId, status],
  );

  if (!result.rows[0]) {
    result = await query<RecipientRow>(
      `
        INSERT INTO wallet_recipients (id, user_id, name, stripe_account_id, status)
        SELECT id, user_id, name, stripe_account_id, $3
        FROM recipients
        WHERE id = $1 AND user_id = $2
        RETURNING
          id,
          user_id,
          name,
          'stripe_connected'::text AS send_method,
          stripe_account_id,
          NULL::text AS cash_app_cashtag,
          NULL::text AS bank_reference,
          NULL::text AS bank_reference_encrypted,
          NULL::text AS bank_reference_key_version,
          '[]'::jsonb AS aliases,
          'usd'::text AS default_currency,
          NULL::text AS notes,
          status,
          created_at::text AS created_at
      `,
      [recipientId, userId, status],
    );
  }

  if (!result.rows[0]) return null;
  return rowToRecipient(result.rows[0]);
}

export async function resolveRecipientByName(userId: string, rawName: string): Promise<Recipient | null> {
  const lookup = rawName.trim().toLowerCase();
  if (!lookup) return null;

  const recipients = await listRecipientsForUser(userId);
  const approved = recipients.filter((recipient) => recipient.status === 'approved');

  const exact = approved.find((recipient) => {
    const nameMatch = recipient.name.trim().toLowerCase() === lookup;
    const aliasMatch = (recipient.aliases || []).some((alias) => alias.trim().toLowerCase() === lookup);
    return nameMatch || aliasMatch;
  });
  if (exact) return exact;

  const partial = approved.find((recipient) => {
    const candidates = [
      recipient.name.trim().toLowerCase(),
      ...(recipient.aliases || []).map((alias) => alias.trim().toLowerCase()),
    ];
    return candidates.some((normalized) => normalized.includes(lookup) || lookup.includes(normalized));
  });

  return partial || null;
}

export async function getUserAutofillProfile(userId: string): Promise<UserAutofillProfile | null> {
  const result = await query<AutofillProfileRow>(
    `
      SELECT
        user_id,
        full_name,
        email,
        phone,
        company_name,
        billing_name,
        address_line1,
        address_line2,
        city,
        state_region,
        postal_code,
        country,
        created_at::text,
        updated_at::text
      FROM user_autofill_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  if (!result.rows[0]) return null;
  return rowToAutofillProfile(result.rows[0]);
}

export async function upsertUserAutofillProfile(
  userId: string,
  patch: Partial<Omit<UserAutofillProfile, 'userId' | 'createdAt' | 'updatedAt'>>,
): Promise<UserAutofillProfile> {
  const normalized = {
    fullName: patch.fullName?.trim() || null,
    email: patch.email?.trim() || null,
    phone: patch.phone?.trim() || null,
    companyName: patch.companyName?.trim() || null,
    billingName: patch.billingName?.trim() || null,
    addressLine1: patch.addressLine1?.trim() || null,
    addressLine2: patch.addressLine2?.trim() || null,
    city: patch.city?.trim() || null,
    stateRegion: patch.stateRegion?.trim() || null,
    postalCode: patch.postalCode?.trim() || null,
    country: patch.country?.trim() || null,
  };

  const result = await query<AutofillProfileRow>(
    `
      INSERT INTO user_autofill_profiles (
        user_id,
        full_name,
        email,
        phone,
        company_name,
        billing_name,
        address_line1,
        address_line2,
        city,
        state_region,
        postal_code,
        country
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (user_id)
      DO UPDATE SET
        full_name = COALESCE(EXCLUDED.full_name, user_autofill_profiles.full_name),
        email = COALESCE(EXCLUDED.email, user_autofill_profiles.email),
        phone = COALESCE(EXCLUDED.phone, user_autofill_profiles.phone),
        company_name = COALESCE(EXCLUDED.company_name, user_autofill_profiles.company_name),
        billing_name = COALESCE(EXCLUDED.billing_name, user_autofill_profiles.billing_name),
        address_line1 = COALESCE(EXCLUDED.address_line1, user_autofill_profiles.address_line1),
        address_line2 = COALESCE(EXCLUDED.address_line2, user_autofill_profiles.address_line2),
        city = COALESCE(EXCLUDED.city, user_autofill_profiles.city),
        state_region = COALESCE(EXCLUDED.state_region, user_autofill_profiles.state_region),
        postal_code = COALESCE(EXCLUDED.postal_code, user_autofill_profiles.postal_code),
        country = COALESCE(EXCLUDED.country, user_autofill_profiles.country),
        updated_at = NOW()
      RETURNING
        user_id,
        full_name,
        email,
        phone,
        company_name,
        billing_name,
        address_line1,
        address_line2,
        city,
        state_region,
        postal_code,
        country,
        created_at::text,
        updated_at::text
    `,
    [
      userId,
      normalized.fullName,
      normalized.email,
      normalized.phone,
      normalized.companyName,
      normalized.billingName,
      normalized.addressLine1,
      normalized.addressLine2,
      normalized.city,
      normalized.stateRegion,
      normalized.postalCode,
      normalized.country,
    ],
  );

  return rowToAutofillProfile(result.rows[0]);
}

export async function markWebhookProcessed(eventId: string): Promise<boolean> {
  const result = await query(
    `
      INSERT INTO stripe_webhook_events (id)
      VALUES ($1)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `,
    [eventId],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function hasWebhookBeenProcessed(eventId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `SELECT id FROM stripe_webhook_events WHERE id = $1`,
    [eventId],
  );

  return Boolean(result.rows[0]);
}

export async function hasSuccessfulTopupForPaymentIntent(
  userId: string,
  paymentIntentId: string,
): Promise<boolean> {
  const result = await query<{ id: string }>(
    `
      SELECT id
      FROM ledger_entries
      WHERE user_id = $1
        AND type = 'topup'
        AND status = 'succeeded'
        AND (
          provider_reference_id = $2
          OR provider_reference_id = $3
          OR metadata->>'payment_intent_id' = $4
        )
      LIMIT 1
    `,
    [userId, paymentIntentId, `pi:${paymentIntentId}`, paymentIntentId],
  );

  return Boolean(result.rows[0]);
}

export async function recordTopupCredit(params: {
  userId: string;
  amount: number;
  currency: string;
  stripeObjectId: string;
  source: Transaction['source'];
  stripeEventId?: string;
  description: string;
  metadata?: Record<string, string>;
}): Promise<Transaction> {
  return recordLedgerEntryUnique({
    userId: params.userId,
    type: 'topup',
    amount: params.amount,
    currency: params.currency,
    direction: 'credit',
    stripeObjectId: params.stripeObjectId,
    stripeEventId: params.stripeEventId,
    description: params.description,
    status: 'succeeded',
    source: params.source,
    metadata: params.metadata,
  });
}

export async function recordLedgerEntry(entry: Omit<Transaction, 'id' | 'createdAt'> & { sourceUrl?: string }): Promise<Transaction> {
  const id = randomUUID();
  const minimizedMetadata = minimizeTransactionMetadata(entry.metadata);

  const result = await query<LedgerRow>(
    `
      INSERT INTO ledger_entries (
        id, user_id, type, amount, currency, direction, status,
        provider, provider_reference_id, stripe_event_id, description,
        source_url, merchant, recipient_id, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
      RETURNING id, user_id, type, amount::text, currency, direction, status,
                provider, provider_reference_id, stripe_event_id, description,
                source_url, merchant, recipient_id, metadata, created_at::text
    `,
    [
      id,
      entry.userId,
      entry.type,
      entry.amount,
      entry.currency.toLowerCase(),
      entry.direction,
      entry.status,
      entry.source || null,
      entry.stripeObjectId || null,
      entry.stripeEventId || null,
      entry.description,
      entry.sourceUrl || null,
      entry.merchant || null,
      entry.recipientId || null,
      minimizedMetadata ? JSON.stringify(minimizedMetadata) : null,
    ],
  );

  return rowToTransaction(result.rows[0]);
}

export async function recordLedgerEntryUnique(entry: Omit<Transaction, 'id' | 'createdAt'> & { sourceUrl?: string }): Promise<Transaction> {
  if (!entry.stripeObjectId) {
    return recordLedgerEntry(entry);
  }

  const existing = await query<LedgerRow>(
    `
      SELECT id, user_id, type, amount::text, currency, direction, status,
             provider, provider_reference_id, stripe_event_id, description,
             source_url, merchant, recipient_id, metadata, created_at::text
      FROM ledger_entries
      WHERE user_id = $1
        AND type = $2
        AND direction = $3
        AND provider_reference_id = $4
      LIMIT 1
    `,
    [entry.userId, entry.type, entry.direction, entry.stripeObjectId],
  );

  if (existing.rows[0]) {
    return rowToTransaction(existing.rows[0]);
  }

  return recordLedgerEntry(entry);
}

export async function updateLedgerEntryStatus(params: {
  userId: string;
  entryId: string;
  status: Transaction['status'];
  stripeObjectId?: string;
  descriptionSuffix?: string;
  metadataPatch?: Record<string, string>;
}): Promise<Transaction | null> {
  const minimizedMetadataPatch = minimizeTransactionMetadata(params.metadataPatch);

  const result = await query<LedgerRow>(
    `
      UPDATE ledger_entries
      SET
        status = $3,
        provider_reference_id = COALESCE($4, provider_reference_id),
        description = CASE
          WHEN $5::text IS NULL THEN description
          ELSE description || ' - ' || $5::text
        END,
        metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($6::jsonb, '{}'::jsonb)
      WHERE id = $1
        AND user_id = $2
      RETURNING id, user_id, type, amount::text, currency, direction, status,
                provider, provider_reference_id, stripe_event_id, description,
                source_url, merchant, recipient_id, metadata, created_at::text
    `,
    [
      params.entryId,
      params.userId,
      params.status,
      params.stripeObjectId || null,
      params.descriptionSuffix || null,
      minimizedMetadataPatch ? JSON.stringify(minimizedMetadataPatch) : null,
    ],
  );

  if (!result.rows[0]) return null;
  return rowToTransaction(result.rows[0]);
}

export async function checkGuardrails(params: {
  userId: string;
  amount: number;
  merchant?: string;
  recipientId?: string;
  recipientName?: string;
  category?: string;
  approved?: boolean;
  enforceConfirmation?: boolean;
}): Promise<{ allowed: boolean; reason?: string; recipient?: Recipient }> {
  const wallet = await getWallet(params.userId);

  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { allowed: false, reason: 'Invalid amount' };
  }

  if (params.amount > wallet.balance) {
    return { allowed: false, reason: 'Insufficient balance' };
  }

  const transactionGuard = enforceTransactionGuardrails({
    userId: params.userId,
    context: 'ledger.checkGuardrails',
    amount: params.amount,
    wallet,
    merchant: params.merchant || params.recipientName || null,
    category: params.category || null,
    approved: params.approved,
    enforceConfirmation: params.enforceConfirmation ?? false,
  });
  if (!transactionGuard.allowed) {
    return {
      allowed: false,
      reason: transactionGuard.reason || 'Transfer blocked by transaction guardrails',
    };
  }

  const monthlySpent = sumSucceededDebitsSince(wallet.transactions, startOfMonthMs());
  if (monthlySpent + params.amount > wallet.settings.monthlyBudget) {
    return { allowed: false, reason: `Would exceed monthly budget of $${wallet.settings.monthlyBudget.toFixed(2)}` };
  }

  if (merchantMatches(params.merchant, wallet.settings.blockedMerchants)) {
    return { allowed: false, reason: 'Merchant is blocked by guardrails' };
  }

  if (wallet.settings.allowedMerchants.length > 0 && !merchantMatches(params.merchant, wallet.settings.allowedMerchants)) {
    return { allowed: false, reason: 'Merchant is not in allowed list' };
  }

  const recipient = params.recipientId
    ? wallet.recipients.find((candidate) => candidate.id === params.recipientId && candidate.status === 'approved')
    : await resolveRecipientByName(params.userId, params.recipientName || params.merchant || '');

  if (!recipient) {
    return { allowed: false, reason: 'No approved recipient matched this target' };
  }

  return { allowed: true, recipient };
}

/**
 * Lightweight guardrails check for subscription debits.
 * Checks budget, limits, and merchant lists but does NOT require a Stripe
 * Connect recipient — subscriptions are ledger-only debits.
 */
export async function checkSubscriptionGuardrails(params: {
  userId: string;
  amount: number;
  merchant?: string;
  category?: string;
  approved?: boolean;
  enforceConfirmation?: boolean;
}): Promise<{ allowed: boolean; reason?: string }> {
  const wallet = await getWallet(params.userId);

  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { allowed: false, reason: 'Invalid amount' };
  }

  if (params.amount > wallet.balance) {
    return { allowed: false, reason: 'Insufficient balance' };
  }

  const transactionGuard = enforceTransactionGuardrails({
    userId: params.userId,
    context: 'ledger.checkSubscriptionGuardrails',
    amount: params.amount,
    wallet,
    merchant: params.merchant || null,
    category: params.category || null,
    approved: params.approved,
    enforceConfirmation: params.enforceConfirmation ?? false,
  });
  if (!transactionGuard.allowed) {
    return {
      allowed: false,
      reason: transactionGuard.reason || 'Subscription debit blocked by transaction guardrails',
    };
  }

  const monthlySpent = sumSucceededDebitsSince(wallet.transactions, startOfMonthMs());
  if (monthlySpent + params.amount > wallet.settings.monthlyBudget) {
    return { allowed: false, reason: `Would exceed monthly budget of $${wallet.settings.monthlyBudget.toFixed(2)}` };
  }

  if (merchantMatches(params.merchant, wallet.settings.blockedMerchants)) {
    return { allowed: false, reason: 'Merchant is blocked by guardrails' };
  }

  if (wallet.settings.allowedMerchants.length > 0 && !merchantMatches(params.merchant, wallet.settings.allowedMerchants)) {
    return { allowed: false, reason: 'Merchant is not in allowed list' };
  }

  return { allowed: true };
}

export async function recordWebAction(params: {
  userId: string;
  taskId?: string;
  actionType: string;
  url?: string;
  status: 'done' | 'error' | 'running';
  details?: Record<string, unknown>;
}): Promise<void> {
  const safeDetails = params.details
    ? sanitizeSensitivePayload(params.details) as Record<string, unknown>
    : undefined;

  await query(
    `
      INSERT INTO web_action_logs (id, user_id, task_id, action_type, url, status, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      randomUUID(),
      params.userId,
      params.taskId || null,
      params.actionType,
      params.url || null,
      params.status,
      safeDetails ? JSON.stringify(safeDetails) : null,
    ],
  );
}

export async function listWebActionsForTask(params: {
  userId: string;
  taskId: string;
  since?: string;
  limit?: number;
}): Promise<Array<{
  id: string;
  taskId: string;
  actionType: string;
  url?: string;
  status: 'done' | 'error' | 'running';
  details?: Record<string, unknown>;
  createdAt: string;
}>> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 300);

  const result = params.since
    ? await query<WebActionLogRow>(
      `
        SELECT id, task_id, action_type, url, status, details, created_at::text
        FROM web_action_logs
        WHERE user_id = $1
          AND task_id = $2
          AND created_at > $3::timestamptz
        ORDER BY created_at ASC
        LIMIT $4
      `,
      [params.userId, params.taskId, params.since, limit],
    )
    : await query<WebActionLogRow>(
      `
        SELECT id, task_id, action_type, url, status, details, created_at::text
        FROM web_action_logs
        WHERE user_id = $1
          AND task_id = $2
        ORDER BY created_at ASC
        LIMIT $3
      `,
      [params.userId, params.taskId, limit],
    );

  return result.rows.map((row) => ({
    id: row.id,
    taskId: row.task_id || params.taskId,
    actionType: row.action_type,
    url: row.url || undefined,
    status: row.status,
    details: row.details || undefined,
    createdAt: row.created_at,
  }));
}

export async function recordApprovalDecision(params: {
  userId: string;
  taskId?: string;
  amount: number;
  currency: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}): Promise<void> {
  await query(
    `
      INSERT INTO approval_decisions (id, user_id, task_id, amount, currency, decision, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      randomUUID(),
      params.userId,
      params.taskId || null,
      params.amount,
      params.currency.toLowerCase(),
      params.decision,
      params.reason || null,
    ],
  );
}

export async function recordAgentTask(params: {
  userId: string;
  taskType: string;
  intent: string;
  status: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  taskId?: string;
}): Promise<string> {
  const id = params.taskId || randomUUID();
  const normalizedUserId = normalizeRequiredText(params.userId, '');
  if (!normalizedUserId) {
    throw new Error('recordAgentTask requires a non-empty userId');
  }
  const safeInput = params.input
    ? sanitizeSensitivePayload(params.input) as Record<string, unknown>
    : undefined;
  const safeResult = params.result
    ? sanitizeSensitivePayload(params.result) as Record<string, unknown>
    : undefined;
  const normalizedPayload = {
    id,
    userId: normalizedUserId,
    taskType: normalizeRequiredText(params.taskType, 'unknown_task'),
    intent: normalizeRequiredText(redactSensitiveText(params.intent), 'unspecified'),
    status: normalizeRequiredText(params.status, 'ready'),
    input: normalizeJsonRecord(safeInput),
    result: normalizeJsonRecord(safeResult),
    error: normalizeOptionalText(params.error ? redactSensitiveText(params.error) : undefined),
  };

  try {
    await query(
      `
        INSERT INTO agent_tasks (id, user_id, task_type, intent, status, input, result, error)
        VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::jsonb, $7::jsonb, $8::text)
        ON CONFLICT (id)
        DO UPDATE SET
          task_type = EXCLUDED.task_type,
          intent = EXCLUDED.intent,
          status = EXCLUDED.status,
          input = COALESCE(EXCLUDED.input, agent_tasks.input),
          result = EXCLUDED.result,
          error = EXCLUDED.error,
          updated_at = NOW()
      `,
      [
        normalizedPayload.id,
        normalizedPayload.userId,
        normalizedPayload.taskType,
        normalizedPayload.intent,
        normalizedPayload.status,
        normalizedPayload.input ? JSON.stringify(normalizedPayload.input) : null,
        normalizedPayload.result ? JSON.stringify(normalizedPayload.result) : null,
        normalizedPayload.error,
      ],
    );
  } catch (error) {
    const dbError = error as { message?: string; code?: string; detail?: string; hint?: string };
    logServerEvent('error', 'db.agent_tasks.record.failed', {
      queryContext: 'recordAgentTask.upsert',
      taskId: normalizedPayload.id,
      userId: normalizedPayload.userId,
      taskType: normalizedPayload.taskType,
      status: normalizedPayload.status,
      message: dbError.message || 'Unknown DB error',
      pgCode: dbError.code || null,
      detail: dbError.detail || null,
      hint: dbError.hint || null,
    });
    throw new Error(`Failed to persist agent task (agent_tasks): ${dbError.message || 'unknown database error'}`);
  }

  return id;
}

export async function getLatestPendingAgentTask(params: {
  userId: string;
  taskType?: string;
}): Promise<{
  id: string;
  userId: string;
  taskType: string;
  intent: string;
  status: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
} | null> {
  const result = await query<AgentTaskRow>(
    `
      SELECT
        id,
        user_id,
        task_type,
        intent,
        status,
        input,
        result,
        error,
        created_at::text,
        updated_at::text
      FROM agent_tasks
      WHERE user_id = $1
        AND status IN ('awaiting_clarification', 'awaiting_approval')
        AND ($2::text IS NULL OR task_type = $2)
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [params.userId, params.taskType || null],
  );

  if (!result.rows[0]) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    taskType: row.task_type,
    intent: row.intent,
    status: row.status,
    input: row.input || undefined,
    result: row.result || undefined,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function supersedePendingAgentTask(params: {
  userId: string;
  taskId: string;
  reason: string;
}): Promise<void> {
  const normalizedUserId = normalizeRequiredText(params.userId, '');
  if (!normalizedUserId) {
    throw new Error('supersedePendingAgentTask requires a non-empty userId');
  }
  const normalizedPayload = {
    taskId: normalizeRequiredText(params.taskId, ''),
    userId: normalizedUserId,
    reason: normalizeRequiredText(params.reason, 'Superseded by a new request'),
  };

  try {
    await query(
      `
        UPDATE agent_tasks
        SET
          status = 'superseded',
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'supersededReason', $3::text,
            'supersededAt', NOW()::text
          ),
          updated_at = NOW()
        WHERE id = $1::text
          AND user_id = $2::text
          AND status IN ('awaiting_clarification', 'awaiting_approval')
      `,
      [normalizedPayload.taskId, normalizedPayload.userId, normalizedPayload.reason],
    );
  } catch (error) {
    const dbError = error as { message?: string; code?: string; detail?: string; hint?: string };
    logServerEvent('error', 'db.agent_tasks.supersede.failed', {
      queryContext: 'supersedePendingAgentTask.update',
      fieldNames: ['id', 'user_id', 'supersededReason'],
      normalizedPayload,
      message: dbError.message || 'Unknown DB error',
      pgCode: dbError.code || null,
      detail: dbError.detail || null,
      hint: dbError.hint || null,
    });
    throw new Error(`Failed to supersede pending task (agent_tasks): ${dbError.message || 'unknown database error'}`);
  }
}
