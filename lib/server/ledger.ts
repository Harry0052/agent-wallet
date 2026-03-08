import { randomUUID } from 'node:crypto';
import type { Recipient, Transaction, UserAutofillProfile, Wallet, WalletSettings } from '@/lib/types';
import { query } from '@/lib/server/db';

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
  stripe_account_id: string;
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

function rowToRecipient(row: RecipientRow): Recipient {
  const status = row.status === 'blocked' || row.status === 'pending' || row.status === 'approved'
    ? row.status
    : 'approved';

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    stripeAccountId: row.stripe_account_id,
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

function startOfDayMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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

export function getWalletUserId(): string {
  return process.env.WALLET_USER_ID || 'default-user';
}

async function listRecipientsForUser(userId: string): Promise<Recipient[]> {
  const recipientResult = await query<RecipientRow>(
    `
      WITH normalized AS (
        SELECT
          r.id,
          r.user_id,
          r.name,
          r.stripe_account_id,
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
          wr.stripe_account_id,
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
      SELECT id, user_id, name, stripe_account_id, default_currency, notes, status, created_at
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
  const id = randomUUID();
  const trimmedName = name.trim();
  const trimmedStripeAccountId = stripeAccountId.trim();

  await query(
    `
      INSERT INTO recipients (id, user_id, name, stripe_account_id, default_currency, notes)
      VALUES ($1, $2, $3, $4, 'usd', $5)
    `,
    [id, userId, trimmedName, trimmedStripeAccountId, notes?.trim() || null],
  );

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
    [id, userId, trimmedName, trimmedStripeAccountId, status],
  );

  const result = await query<RecipientRow>(
    `
      SELECT
        r.id,
        r.user_id,
        r.name,
        r.stripe_account_id,
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
    `,
    [id, userId],
  );

  if (!result.rows[0]) {
    throw new Error('Failed to create recipient');
  }

  return rowToRecipient(result.rows[0]);
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
      RETURNING id, user_id, name, stripe_account_id, 'usd'::text AS default_currency, NULL::text AS notes, status, created_at::text
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
        RETURNING id, user_id, name, stripe_account_id, 'usd'::text AS default_currency, NULL::text AS notes, status, created_at::text
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

  const exact = approved.find((recipient) => recipient.name.trim().toLowerCase() === lookup);
  if (exact) return exact;

  const partial = approved.find((recipient) => {
    const normalized = recipient.name.trim().toLowerCase();
    return normalized.includes(lookup) || lookup.includes(normalized);
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
      entry.metadata ? JSON.stringify(entry.metadata) : null,
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
      params.metadataPatch ? JSON.stringify(params.metadataPatch) : null,
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
}): Promise<{ allowed: boolean; reason?: string; recipient?: Recipient }> {
  const wallet = await getWallet(params.userId);

  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { allowed: false, reason: 'Invalid amount' };
  }

  if (params.amount > wallet.balance) {
    return { allowed: false, reason: 'Insufficient balance' };
  }

  if (params.amount > wallet.settings.maxTransaction) {
    return { allowed: false, reason: `Exceeds max transaction of $${wallet.settings.maxTransaction.toFixed(2)}` };
  }

  const dailySpent = sumSucceededDebitsSince(wallet.transactions, startOfDayMs());
  if (dailySpent + params.amount > wallet.settings.dailyLimit) {
    return { allowed: false, reason: `Would exceed daily limit of $${wallet.settings.dailyLimit.toFixed(2)}` };
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

export async function recordWebAction(params: {
  userId: string;
  taskId?: string;
  actionType: string;
  url?: string;
  status: 'done' | 'error' | 'running';
  details?: Record<string, unknown>;
}): Promise<void> {
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
      params.details ? JSON.stringify(params.details) : null,
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
        LIMIT ${limit}
      `,
      [params.userId, params.taskId, params.since],
    )
    : await query<WebActionLogRow>(
      `
        SELECT id, task_id, action_type, url, status, details, created_at::text
        FROM web_action_logs
        WHERE user_id = $1
          AND task_id = $2
        ORDER BY created_at ASC
        LIMIT ${limit}
      `,
      [params.userId, params.taskId],
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

  await query(
    `
      INSERT INTO agent_tasks (id, user_id, task_type, intent, status, input, result, error)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      ON CONFLICT (id)
      DO UPDATE SET
        status = EXCLUDED.status,
        result = EXCLUDED.result,
        error = EXCLUDED.error,
        updated_at = NOW()
    `,
    [
      id,
      params.userId,
      params.taskType,
      params.intent,
      params.status,
      params.input ? JSON.stringify(params.input) : null,
      params.result ? JSON.stringify(params.result) : null,
      params.error || null,
    ],
  );

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
