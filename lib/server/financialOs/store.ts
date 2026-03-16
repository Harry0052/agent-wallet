import "server-only";

import { randomUUID } from "node:crypto";
import { query } from "@/lib/server/db";
import { encryptData } from "@/security/encryption";
import type {
  FinancialDocumentHook,
  FinancialMemoryEntry,
  FinancialMemoryKey,
  FinancialNotification,
  FinancialNotificationPriority,
  FinancialSyncRunSummary,
} from "@/lib/server/financialOs/types";

interface FinancialSyncRunRow {
  id: string;
  user_id: string;
  plaid_item_id: string;
  status: "processing" | "completed" | "failed" | "skipped";
  added_count: string;
  modified_count: string;
  removed_count: string;
  pages: string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

interface FinancialNotificationRow {
  id: string;
  user_id: string;
  dedup_key: string;
  kind: string;
  title: string;
  summary: string;
  priority: FinancialNotificationPriority;
  status: "active" | "dismissed" | "suppressed";
  deep_link: string;
  cooldown_until: string | null;
  throttled_count: string;
  created_at: string;
  updated_at: string;
}

interface FinancialDocumentRow {
  id: string;
  user_id: string;
  document_type: "statement" | "bill" | "receipt" | "confirmation";
  status: "hooked" | "processed" | "failed";
  file_name: string;
  mime_type: string;
  source_hash: string | null;
  storage_provider: string | null;
  encrypted_ref: string | null;
  ref_key_version: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface FinancialMemoryRow {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

declare global {
  var __financialOsInfraSchemaInitPromise: Promise<void> | undefined;
}

function asNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSyncRun(row: FinancialSyncRunRow): FinancialSyncRunSummary {
  return {
    id: row.id,
    userId: row.user_id,
    plaidItemId: row.plaid_item_id,
    status: row.status,
    addedCount: asNumber(row.added_count),
    modifiedCount: asNumber(row.modified_count),
    removedCount: asNumber(row.removed_count),
    pages: asNumber(row.pages),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  };
}

function toNotification(row: FinancialNotificationRow): FinancialNotification {
  return {
    id: row.id,
    kind: row.kind,
    dedupKey: row.dedup_key,
    title: row.title,
    summary: row.summary,
    priority: row.priority,
    status: row.status,
    deepLink: row.deep_link,
    cooldownUntil: row.cooldown_until,
    throttledCount: asNumber(row.throttled_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDocument(row: FinancialDocumentRow): FinancialDocumentHook {
  return {
    id: row.id,
    userId: row.user_id,
    documentType: row.document_type,
    status: row.status,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sourceHash: row.source_hash,
    storageProvider: row.storage_provider,
    hasEncryptedReference: Boolean(row.encrypted_ref && row.ref_key_version),
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureFinancialOsInfraSchema(): Promise<void> {
  if (globalThis.__financialOsInfraSchemaInitPromise) {
    return globalThis.__financialOsInfraSchemaInitPromise;
  }

  globalThis.__financialOsInfraSchemaInitPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS financial_sync_leases (
        user_id TEXT NOT NULL,
        plaid_item_id TEXT NOT NULL,
        holder_id TEXT NOT NULL,
        lease_until TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, plaid_item_id)
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS financial_sync_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        plaid_item_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        cursor_start TEXT,
        cursor_end TEXT,
        added_count INTEGER NOT NULL DEFAULT 0,
        modified_count INTEGER NOT NULL DEFAULT 0,
        removed_count INTEGER NOT NULL DEFAULT 0,
        pages INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_financial_sync_runs_user_started
      ON financial_sync_runs (user_id, started_at DESC);
    `);

    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_sync_runs_idempotent
      ON financial_sync_runs (user_id, plaid_item_id, idempotency_key);
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS financial_notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dedup_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        deep_link TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        cooldown_until TIMESTAMPTZ,
        throttled_count INTEGER NOT NULL DEFAULT 0,
        last_triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, dedup_key)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_financial_notifications_user_status_updated
      ON financial_notifications (user_id, status, updated_at DESC);
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS financial_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        status TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        source_hash TEXT,
        storage_provider TEXT,
        encrypted_ref TEXT,
        ref_key_version TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_financial_documents_user_created
      ON financial_documents (user_id, created_at DESC);
    `);
  })();

  return globalThis.__financialOsInfraSchemaInitPromise;
}

export async function acquireFinancialSyncLease(input: {
  userId: string;
  plaidItemId: string;
  holderId: string;
  leaseSeconds?: number;
}): Promise<boolean> {
  await ensureFinancialOsInfraSchema();
  const leaseSeconds = Math.max(20, Math.min(input.leaseSeconds ?? 180, 900));
  const result = await query<{ holder_id: string }>(
    `
      INSERT INTO financial_sync_leases (
        user_id,
        plaid_item_id,
        holder_id,
        lease_until
      )
      VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval)
      ON CONFLICT (user_id, plaid_item_id)
      DO UPDATE SET
        holder_id = EXCLUDED.holder_id,
        lease_until = EXCLUDED.lease_until,
        updated_at = NOW()
      WHERE financial_sync_leases.lease_until <= NOW()
         OR financial_sync_leases.holder_id = EXCLUDED.holder_id
      RETURNING holder_id
    `,
    [input.userId, input.plaidItemId, input.holderId, String(leaseSeconds)],
  );

  return result.rows[0]?.holder_id === input.holderId;
}

export async function releaseFinancialSyncLease(input: {
  userId: string;
  plaidItemId: string;
  holderId: string;
}): Promise<void> {
  await ensureFinancialOsInfraSchema();
  await query(
    `
      DELETE FROM financial_sync_leases
      WHERE user_id = $1
        AND plaid_item_id = $2
        AND holder_id = $3
    `,
    [input.userId, input.plaidItemId, input.holderId],
  );
}

export async function beginFinancialSyncRun(input: {
  userId: string;
  plaidItemId: string;
  idempotencyKey: string;
  cursorStart: string | null;
}): Promise<{ id: string }> {
  await ensureFinancialOsInfraSchema();
  const id = randomUUID();
  const result = await query<{ id: string }>(
    `
      INSERT INTO financial_sync_runs (
        id,
        user_id,
        plaid_item_id,
        idempotency_key,
        status,
        cursor_start
      )
      VALUES ($1, $2, $3, $4, 'processing', $5)
      ON CONFLICT (user_id, plaid_item_id, idempotency_key)
      DO UPDATE SET
        updated_at = NOW()
      RETURNING id
    `,
    [id, input.userId, input.plaidItemId, input.idempotencyKey, input.cursorStart],
  );

  return { id: result.rows[0].id };
}

export async function completeFinancialSyncRun(input: {
  id: string;
  userId: string;
  status: "completed" | "skipped";
  cursorEnd: string | null;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  pages: number;
}): Promise<void> {
  await ensureFinancialOsInfraSchema();
  await query(
    `
      UPDATE financial_sync_runs
      SET
        status = $3,
        cursor_end = $4,
        added_count = $5,
        modified_count = $6,
        removed_count = $7,
        pages = $8,
        finished_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
    `,
    [
      input.id,
      input.userId,
      input.status,
      input.cursorEnd,
      Math.max(0, Math.round(input.addedCount)),
      Math.max(0, Math.round(input.modifiedCount)),
      Math.max(0, Math.round(input.removedCount)),
      Math.max(0, Math.round(input.pages)),
    ],
  );
}

export async function failFinancialSyncRun(input: {
  id: string;
  userId: string;
  cursorEnd: string | null;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  pages: number;
  errorMessage: string;
}): Promise<void> {
  await ensureFinancialOsInfraSchema();
  await query(
    `
      UPDATE financial_sync_runs
      SET
        status = 'failed',
        cursor_end = $3,
        added_count = $4,
        modified_count = $5,
        removed_count = $6,
        pages = $7,
        error_message = $8,
        finished_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
    `,
    [
      input.id,
      input.userId,
      input.cursorEnd,
      Math.max(0, Math.round(input.addedCount)),
      Math.max(0, Math.round(input.modifiedCount)),
      Math.max(0, Math.round(input.removedCount)),
      Math.max(0, Math.round(input.pages)),
      input.errorMessage.slice(0, 400),
    ],
  );
}

export async function listRecentFinancialSyncRuns(input: {
  userId: string;
  limit?: number;
}): Promise<FinancialSyncRunSummary[]> {
  await ensureFinancialOsInfraSchema();
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const result = await query<FinancialSyncRunRow>(
    `
      SELECT
        id,
        user_id,
        plaid_item_id,
        status,
        added_count::text,
        modified_count::text,
        removed_count::text,
        pages::text,
        started_at::text,
        finished_at::text,
        error_message
      FROM financial_sync_runs
      WHERE user_id = $1
      ORDER BY started_at DESC
      LIMIT $2
    `,
    [input.userId, limit],
  );

  return result.rows.map(toSyncRun);
}

export async function upsertFinancialMemoryEntry(input: {
  userId: string;
  key: FinancialMemoryKey;
  data: Record<string, unknown>;
}): Promise<void> {
  await ensureFinancialOsInfraSchema();
  await query(
    `
      INSERT INTO agent_memory (
        user_id,
        key,
        value
      )
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (user_id, key)
      DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
    `,
    [input.userId, `financial_memory/${input.key}`, JSON.stringify(input.data)],
  );
}

export async function listFinancialMemoryEntries(input: {
  userId: string;
}): Promise<FinancialMemoryEntry[]> {
  await ensureFinancialOsInfraSchema();
  const result = await query<FinancialMemoryRow>(
    `
      SELECT
        key,
        value,
        updated_at::text
      FROM agent_memory
      WHERE user_id = $1
        AND key LIKE 'financial_memory/%'
      ORDER BY key ASC
    `,
    [input.userId],
  );

  return result.rows.map((row) => ({
    key: row.key.replace("financial_memory/", "") as FinancialMemoryKey,
    updatedAt: row.updated_at,
    data: row.value || {},
  }));
}

export async function upsertFinancialNotificationCandidate(input: {
  userId: string;
  dedupKey: string;
  kind: string;
  title: string;
  summary: string;
  priority: FinancialNotificationPriority;
  deepLink: string;
  payload?: Record<string, unknown>;
  cooldownMinutes: number;
}): Promise<{ suppressed: boolean; notification: FinancialNotification | null }> {
  await ensureFinancialOsInfraSchema();
  const existing = await query<FinancialNotificationRow>(
    `
      SELECT
        id,
        user_id,
        dedup_key,
        kind,
        title,
        summary,
        priority,
        status,
        deep_link,
        cooldown_until::text,
        throttled_count::text,
        created_at::text,
        updated_at::text
      FROM financial_notifications
      WHERE user_id = $1
        AND dedup_key = $2
      LIMIT 1
    `,
    [input.userId, input.dedupKey],
  );

  const existingRow = existing.rows[0];
  const now = Date.now();
  const cooldownUntilMs = existingRow?.cooldown_until ? Date.parse(existingRow.cooldown_until) : Number.NaN;

  if (existingRow && Number.isFinite(cooldownUntilMs) && cooldownUntilMs > now) {
    await query(
      `
        UPDATE financial_notifications
        SET
          throttled_count = throttled_count + 1,
          status = 'suppressed',
          updated_at = NOW()
        WHERE id = $1
      `,
      [existingRow.id],
    );
    return { suppressed: true, notification: null };
  }

  const cooldownMinutes = Math.max(5, Math.min(input.cooldownMinutes, 60 * 24 * 14));
  const id = existingRow?.id || randomUUID();
  const result = await query<FinancialNotificationRow>(
    `
      INSERT INTO financial_notifications (
        id,
        user_id,
        dedup_key,
        kind,
        title,
        summary,
        priority,
        status,
        deep_link,
        payload,
        cooldown_until,
        throttled_count,
        last_triggered_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'active',
        $8,
        $9::jsonb,
        NOW() + ($10 || ' minutes')::interval,
        0,
        NOW()
      )
      ON CONFLICT (user_id, dedup_key)
      DO UPDATE SET
        kind = EXCLUDED.kind,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        priority = EXCLUDED.priority,
        status = 'active',
        deep_link = EXCLUDED.deep_link,
        payload = EXCLUDED.payload,
        cooldown_until = EXCLUDED.cooldown_until,
        last_triggered_at = NOW(),
        updated_at = NOW()
      RETURNING
        id,
        user_id,
        dedup_key,
        kind,
        title,
        summary,
        priority,
        status,
        deep_link,
        cooldown_until::text,
        throttled_count::text,
        created_at::text,
        updated_at::text
    `,
    [
      id,
      input.userId,
      input.dedupKey,
      input.kind,
      input.title,
      input.summary,
      input.priority,
      input.deepLink,
      JSON.stringify(input.payload || {}),
      String(cooldownMinutes),
    ],
  );

  return {
    suppressed: false,
    notification: toNotification(result.rows[0]),
  };
}

export async function listActiveFinancialNotifications(input: {
  userId: string;
  limit?: number;
}): Promise<FinancialNotification[]> {
  await ensureFinancialOsInfraSchema();
  const limit = Math.max(1, Math.min(input.limit ?? 30, 100));
  const result = await query<FinancialNotificationRow>(
    `
      SELECT
        id,
        user_id,
        dedup_key,
        kind,
        title,
        summary,
        priority,
        status,
        deep_link,
        cooldown_until::text,
        throttled_count::text,
        created_at::text,
        updated_at::text
      FROM financial_notifications
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        updated_at DESC
      LIMIT $2
    `,
    [input.userId, limit],
  );

  return result.rows.map(toNotification);
}

export async function dismissFinancialNotification(input: {
  userId: string;
  notificationId: string;
}): Promise<boolean> {
  await ensureFinancialOsInfraSchema();
  const result = await query<{ id: string }>(
    `
      UPDATE financial_notifications
      SET status = 'dismissed', updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
      RETURNING id
    `,
    [input.notificationId, input.userId],
  );
  return result.rows.length > 0;
}

export async function createFinancialDocumentHook(input: {
  userId: string;
  documentType: FinancialDocumentHook["documentType"];
  fileName: string;
  mimeType: string;
  sourceHash?: string | null;
  storageProvider?: string | null;
  storageReference?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<FinancialDocumentHook> {
  await ensureFinancialOsInfraSchema();
  const id = randomUUID();
  const reference = input.storageReference?.trim() || null;
  const encrypted = reference ? encryptData({ reference }) : null;

  const result = await query<FinancialDocumentRow>(
    `
      INSERT INTO financial_documents (
        id,
        user_id,
        document_type,
        status,
        file_name,
        mime_type,
        source_hash,
        storage_provider,
        encrypted_ref,
        ref_key_version,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        'hooked',
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::jsonb
      )
      RETURNING
        id,
        user_id,
        document_type,
        status,
        file_name,
        mime_type,
        source_hash,
        storage_provider,
        encrypted_ref,
        ref_key_version,
        metadata,
        created_at::text,
        updated_at::text
    `,
    [
      id,
      input.userId,
      input.documentType,
      input.fileName.trim(),
      input.mimeType.trim().toLowerCase(),
      input.sourceHash?.trim() || null,
      input.storageProvider?.trim() || null,
      encrypted?.encrypted || null,
      encrypted?.keyVersion || null,
      JSON.stringify(input.metadata || {}),
    ],
  );

  return toDocument(result.rows[0]);
}

export async function listFinancialDocumentHooks(input: {
  userId: string;
  limit?: number;
}): Promise<FinancialDocumentHook[]> {
  await ensureFinancialOsInfraSchema();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const result = await query<FinancialDocumentRow>(
    `
      SELECT
        id,
        user_id,
        document_type,
        status,
        file_name,
        mime_type,
        source_hash,
        storage_provider,
        encrypted_ref,
        ref_key_version,
        metadata,
        created_at::text,
        updated_at::text
      FROM financial_documents
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [input.userId, limit],
  );

  return result.rows.map(toDocument);
}
