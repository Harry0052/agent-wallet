import 'server-only';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/server/db';
import { decryptVaultValue, encryptVaultValue } from '@/lib/server/vaultCrypto';

export const TOOL_CONNECTION_TYPES = ['password', 'oauth', 'api_key', 'session'] as const;
export type ToolConnectionType = (typeof TOOL_CONNECTION_TYPES)[number];

export const TOOL_SECRET_TYPES = ['password', 'oauth_token', 'refresh_token', 'api_key', 'session'] as const;
export type ToolSecretType = (typeof TOOL_SECRET_TYPES)[number];

export const USER_TOOL_STATUSES = ['connected', 'disconnected', 'pending', 'failed'] as const;
export type UserToolStatus = (typeof USER_TOOL_STATUSES)[number];

export const USER_TOOL_CREATED_BY = ['manual', 'signup_flow', 'oauth', 'imported'] as const;
export type UserToolCreatedBy = (typeof USER_TOOL_CREATED_BY)[number];

export const USER_TOOL_EVENT_TYPES = [
  'connected',
  'updated',
  'login_used',
  'login_failed',
  'disabled',
  'enabled',
  'removed',
  'signup_created',
] as const;
export type UserToolEventType = (typeof USER_TOOL_EVENT_TYPES)[number];

interface ToolCatalogRow {
  id: string;
  key: string;
  display_name: string;
  category: string | null;
  icon_name: string | null;
  homepage_url: string | null;
  login_url: string | null;
  signup_url: string | null;
  supports_oauth: boolean;
  supports_password_login: boolean;
  supports_api_key: boolean;
  default_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface UserToolRow {
  id: string;
  user_id: string;
  tool_id: string;
  status: UserToolStatus;
  enabled: boolean;
  connection_type: ToolConnectionType;
  label: string | null;
  login_identifier_masked: string | null;
  last_used_at: string | null;
  last_verified_at: string | null;
  created_by: UserToolCreatedBy;
  created_at: string;
  updated_at: string;
}

interface UserToolJoinedRow extends UserToolRow {
  has_secret: boolean;
  tool_key: string;
  tool_display_name: string;
  tool_category: string | null;
  tool_icon_name: string | null;
  tool_homepage_url: string | null;
  tool_login_url: string | null;
  tool_signup_url: string | null;
  tool_supports_oauth: boolean;
  tool_supports_password_login: boolean;
  tool_supports_api_key: boolean;
  tool_default_enabled: boolean;
}

interface VaultEntryRow {
  id: string;
  user_tool_id: string;
  secret_type: ToolSecretType;
  encrypted_secret: string;
  encrypted_metadata: string | null;
  key_version: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  user_tool_id: string;
  event_type: UserToolEventType;
  message: string | null;
  created_at: string;
}

const DEFAULT_TOOL_CATALOG: Array<{
  key: string;
  displayName: string;
  category: string;
  iconName: string;
  homepageUrl: string;
  loginUrl: string;
  signupUrl: string;
  supportsOauth: boolean;
  supportsPasswordLogin: boolean;
  supportsApiKey: boolean;
  defaultEnabled?: boolean;
}> = [
  {
    key: 'stripe',
    displayName: 'Stripe',
    category: 'payments',
    iconName: 'stripe',
    homepageUrl: 'https://stripe.com',
    loginUrl: 'https://dashboard.stripe.com/login',
    signupUrl: 'https://dashboard.stripe.com/register',
    supportsOauth: true,
    supportsPasswordLogin: true,
    supportsApiKey: true,
    defaultEnabled: true,
  },
  {
    key: 'netflix',
    displayName: 'Netflix',
    category: 'subscriptions',
    iconName: 'netflix',
    homepageUrl: 'https://www.netflix.com',
    loginUrl: 'https://www.netflix.com/login',
    signupUrl: 'https://www.netflix.com/signup',
    supportsOauth: false,
    supportsPasswordLogin: true,
    supportsApiKey: false,
  },
  {
    key: 'notion',
    displayName: 'Notion',
    category: 'productivity',
    iconName: 'notion',
    homepageUrl: 'https://www.notion.so',
    loginUrl: 'https://www.notion.so/login',
    signupUrl: 'https://www.notion.so/signup',
    supportsOauth: true,
    supportsPasswordLogin: true,
    supportsApiKey: true,
  },
  {
    key: 'gmail',
    displayName: 'Gmail',
    category: 'email',
    iconName: 'gmail',
    homepageUrl: 'https://mail.google.com',
    loginUrl: 'https://accounts.google.com/signin',
    signupUrl: 'https://accounts.google.com/signup',
    supportsOauth: true,
    supportsPasswordLogin: true,
    supportsApiKey: false,
  },
  {
    key: 'linkedin',
    displayName: 'LinkedIn',
    category: 'social',
    iconName: 'linkedin',
    homepageUrl: 'https://www.linkedin.com',
    loginUrl: 'https://www.linkedin.com/login',
    signupUrl: 'https://www.linkedin.com/signup',
    supportsOauth: true,
    supportsPasswordLogin: true,
    supportsApiKey: true,
  },
];

declare global {
  var __agentWalletToolsSeeded: boolean | undefined;
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function toToolConnectionType(value: unknown): ToolConnectionType {
  if (value === 'password' || value === 'oauth' || value === 'api_key' || value === 'session') {
    return value;
  }
  return 'password';
}

function toToolSecretType(value: unknown, connectionType: ToolConnectionType): ToolSecretType {
  if (value === 'password' || value === 'oauth_token' || value === 'refresh_token' || value === 'api_key' || value === 'session') {
    return value;
  }

  if (connectionType === 'oauth') return 'oauth_token';
  if (connectionType === 'api_key') return 'api_key';
  if (connectionType === 'session') return 'session';
  return 'password';
}

function normalizeStatus(value: unknown): UserToolStatus {
  if (value === 'connected' || value === 'disconnected' || value === 'pending' || value === 'failed') {
    return value;
  }
  return 'pending';
}

function normalizeCreatedBy(value: unknown): UserToolCreatedBy {
  if (value === 'manual' || value === 'signup_flow' || value === 'oauth' || value === 'imported') {
    return value;
  }
  return 'manual';
}

export function normalizeToolKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeDisplayName(input: string, fallbackKey: string): string {
  const trimmed = input.trim();
  if (trimmed) return trimmed;
  return fallbackKey
    .split('_')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export function maskLoginIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!trimmed) return '';

  const atIndex = trimmed.indexOf('@');
  if (atIndex > 0 && atIndex < trimmed.length - 1) {
    const local = trimmed.slice(0, atIndex);
    const domain = trimmed.slice(atIndex + 1);
    const localMasked = `${local.slice(0, 1)}***`;
    return `${localMasked}@${domain}`;
  }

  if (trimmed.length <= 2) {
    return `${trimmed.slice(0, 1)}***`;
  }

  return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`;
}

const TOOL_EVENT_SECRET_PATTERN = /\b(password|passcode|credential|token|api\s*key|secret|authorization|cookie|session)\b\s*(?:is|=|:)\s*([^\s,;]+)/gi;
const TOOL_EVENT_BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/=]+\b/gi;

function sanitizeToolEventMessage(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withSecretRedaction = trimmed.replace(
    TOOL_EVENT_SECRET_PATTERN,
    (_match, label: string) => `${label}=[redacted]`,
  );

  return withSecretRedaction.replace(TOOL_EVENT_BEARER_PATTERN, 'Bearer [redacted]');
}

function mapCatalogRow(row: ToolCatalogRow) {
  return {
    id: row.id,
    key: row.key,
    displayName: row.display_name,
    category: row.category,
    iconName: row.icon_name,
    homepageUrl: row.homepage_url,
    loginUrl: row.login_url,
    signupUrl: row.signup_url,
    supportsOauth: row.supports_oauth,
    supportsPasswordLogin: row.supports_password_login,
    supportsApiKey: row.supports_api_key,
    defaultEnabled: row.default_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserToolRow(row: UserToolJoinedRow) {
  return {
    id: row.id,
    userId: row.user_id,
    toolId: row.tool_id,
    status: row.status,
    enabled: row.enabled,
    connectionType: row.connection_type,
    label: row.label,
    loginIdentifierMasked: row.login_identifier_masked,
    lastUsedAt: row.last_used_at,
    lastVerifiedAt: row.last_verified_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasSecret: row.has_secret,
    tool: {
      key: row.tool_key,
      displayName: row.tool_display_name,
      category: row.tool_category,
      iconName: row.tool_icon_name,
      homepageUrl: row.tool_homepage_url,
      loginUrl: row.tool_login_url,
      signupUrl: row.tool_signup_url,
      supportsOauth: row.tool_supports_oauth,
      supportsPasswordLogin: row.tool_supports_password_login,
      supportsApiKey: row.tool_supports_api_key,
      defaultEnabled: row.tool_default_enabled,
    },
  };
}

function mapEventRow(row: EventRow) {
  return {
    id: row.id,
    userToolId: row.user_tool_id,
    eventType: row.event_type,
    message: row.message,
    createdAt: row.created_at,
  };
}

async function seedDefaultToolsCatalogIfNeeded(): Promise<void> {
  if (globalThis.__agentWalletToolsSeeded) {
    return;
  }

  for (const item of DEFAULT_TOOL_CATALOG) {
    await query(
      `
        INSERT INTO tools_catalog (
          id,
          key,
          display_name,
          category,
          icon_name,
          homepage_url,
          login_url,
          signup_url,
          supports_oauth,
          supports_password_login,
          supports_api_key,
          default_enabled,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        ON CONFLICT (key) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          category = EXCLUDED.category,
          icon_name = EXCLUDED.icon_name,
          homepage_url = EXCLUDED.homepage_url,
          login_url = EXCLUDED.login_url,
          signup_url = EXCLUDED.signup_url,
          supports_oauth = EXCLUDED.supports_oauth,
          supports_password_login = EXCLUDED.supports_password_login,
          supports_api_key = EXCLUDED.supports_api_key,
          updated_at = NOW()
      `,
      [
        randomUUID(),
        item.key,
        item.displayName,
        item.category,
        item.iconName,
        item.homepageUrl,
        item.loginUrl,
        item.signupUrl,
        item.supportsOauth,
        item.supportsPasswordLogin,
        item.supportsApiKey,
        item.defaultEnabled === true,
      ],
    );
  }

  globalThis.__agentWalletToolsSeeded = true;
}

async function getCatalogByKey(toolKey: string): Promise<ToolCatalogRow | null> {
  const result = await query<ToolCatalogRow>(
    `
      SELECT
        id,
        key,
        display_name,
        category,
        icon_name,
        homepage_url,
        login_url,
        signup_url,
        supports_oauth,
        supports_password_login,
        supports_api_key,
        default_enabled,
        created_at,
        updated_at
      FROM tools_catalog
      WHERE key = $1
      LIMIT 1
    `,
    [toolKey],
  );

  return result.rows[0] || null;
}

async function upsertCatalogTool(input: {
  key: string;
  displayName: string;
  category?: string | null;
  iconName?: string | null;
  homepageUrl?: string | null;
  loginUrl?: string | null;
  signupUrl?: string | null;
  supportsOauth?: boolean;
  supportsPasswordLogin?: boolean;
  supportsApiKey?: boolean;
  defaultEnabled?: boolean;
}): Promise<ToolCatalogRow> {
  const created = await query<ToolCatalogRow>(
    `
      INSERT INTO tools_catalog (
        id,
        key,
        display_name,
        category,
        icon_name,
        homepage_url,
        login_url,
        signup_url,
        supports_oauth,
        supports_password_login,
        supports_api_key,
        default_enabled,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      ON CONFLICT (key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        category = COALESCE(EXCLUDED.category, tools_catalog.category),
        icon_name = COALESCE(EXCLUDED.icon_name, tools_catalog.icon_name),
        homepage_url = COALESCE(EXCLUDED.homepage_url, tools_catalog.homepage_url),
        login_url = COALESCE(EXCLUDED.login_url, tools_catalog.login_url),
        signup_url = COALESCE(EXCLUDED.signup_url, tools_catalog.signup_url),
        supports_oauth = EXCLUDED.supports_oauth,
        supports_password_login = EXCLUDED.supports_password_login,
        supports_api_key = EXCLUDED.supports_api_key,
        default_enabled = EXCLUDED.default_enabled,
        updated_at = NOW()
      RETURNING
        id,
        key,
        display_name,
        category,
        icon_name,
        homepage_url,
        login_url,
        signup_url,
        supports_oauth,
        supports_password_login,
        supports_api_key,
        default_enabled,
        created_at,
        updated_at
    `,
    [
      randomUUID(),
      input.key,
      input.displayName,
      input.category || null,
      input.iconName || null,
      input.homepageUrl || null,
      input.loginUrl || null,
      input.signupUrl || null,
      Boolean(input.supportsOauth),
      input.supportsPasswordLogin !== false,
      Boolean(input.supportsApiKey),
      Boolean(input.defaultEnabled),
    ],
  );

  if (!created.rows[0]) {
    throw new Error(`Unable to upsert tools_catalog for ${input.key}`);
  }

  return created.rows[0];
}

async function ensureCatalogTool(input: {
  toolKey: string;
  displayName: string;
  category?: string | null;
  iconName?: string | null;
  homepageUrl?: string | null;
  loginUrl?: string | null;
  signupUrl?: string | null;
  supportsOauth?: boolean;
  supportsPasswordLogin?: boolean;
  supportsApiKey?: boolean;
  defaultEnabled?: boolean;
}): Promise<ToolCatalogRow> {
  await seedDefaultToolsCatalogIfNeeded();

  const existing = await getCatalogByKey(input.toolKey);
  if (existing) {
    return upsertCatalogTool({
      key: existing.key,
      displayName: input.displayName || existing.display_name,
      category: input.category,
      iconName: input.iconName,
      homepageUrl: input.homepageUrl,
      loginUrl: input.loginUrl,
      signupUrl: input.signupUrl,
      supportsOauth: input.supportsOauth ?? existing.supports_oauth,
      supportsPasswordLogin: input.supportsPasswordLogin ?? existing.supports_password_login,
      supportsApiKey: input.supportsApiKey ?? existing.supports_api_key,
      defaultEnabled: input.defaultEnabled ?? existing.default_enabled,
    });
  }

  return upsertCatalogTool({
    key: input.toolKey,
    displayName: input.displayName,
    category: input.category,
    iconName: input.iconName,
    homepageUrl: input.homepageUrl,
    loginUrl: input.loginUrl,
    signupUrl: input.signupUrl,
    supportsOauth: input.supportsOauth,
    supportsPasswordLogin: input.supportsPasswordLogin,
    supportsApiKey: input.supportsApiKey,
    defaultEnabled: input.defaultEnabled,
  });
}

async function loadUserToolJoinedById(userId: string, userToolId: string): Promise<UserToolJoinedRow | null> {
  const result = await query<UserToolJoinedRow>(
    `
      SELECT
        ut.id,
        ut.user_id,
        ut.tool_id,
        ut.status,
        ut.enabled,
        ut.connection_type,
        ut.label,
        ut.login_identifier_masked,
        ut.last_used_at,
        ut.last_verified_at,
        ut.created_by,
        ut.created_at,
        ut.updated_at,
        EXISTS (
          SELECT 1
          FROM vault_entries ve
          WHERE ve.user_tool_id = ut.id
        ) AS has_secret,
        tc.key AS tool_key,
        tc.display_name AS tool_display_name,
        tc.category AS tool_category,
        tc.icon_name AS tool_icon_name,
        tc.homepage_url AS tool_homepage_url,
        tc.login_url AS tool_login_url,
        tc.signup_url AS tool_signup_url,
        tc.supports_oauth AS tool_supports_oauth,
        tc.supports_password_login AS tool_supports_password_login,
        tc.supports_api_key AS tool_supports_api_key,
        tc.default_enabled AS tool_default_enabled
      FROM user_tools ut
      INNER JOIN tools_catalog tc ON tc.id = ut.tool_id
      WHERE ut.user_id = $1
        AND ut.id = $2
      LIMIT 1
    `,
    [userId, userToolId],
  );

  return result.rows[0] || null;
}

async function loadUserToolJoinedByKey(userId: string, toolKeyOrDisplay: string): Promise<UserToolJoinedRow | null> {
  const normalizedKey = normalizeToolKey(toolKeyOrDisplay);
  const result = await query<UserToolJoinedRow>(
    `
      SELECT
        ut.id,
        ut.user_id,
        ut.tool_id,
        ut.status,
        ut.enabled,
        ut.connection_type,
        ut.label,
        ut.login_identifier_masked,
        ut.last_used_at,
        ut.last_verified_at,
        ut.created_by,
        ut.created_at,
        ut.updated_at,
        EXISTS (
          SELECT 1
          FROM vault_entries ve
          WHERE ve.user_tool_id = ut.id
        ) AS has_secret,
        tc.key AS tool_key,
        tc.display_name AS tool_display_name,
        tc.category AS tool_category,
        tc.icon_name AS tool_icon_name,
        tc.homepage_url AS tool_homepage_url,
        tc.login_url AS tool_login_url,
        tc.signup_url AS tool_signup_url,
        tc.supports_oauth AS tool_supports_oauth,
        tc.supports_password_login AS tool_supports_password_login,
        tc.supports_api_key AS tool_supports_api_key,
        tc.default_enabled AS tool_default_enabled
      FROM user_tools ut
      INNER JOIN tools_catalog tc ON tc.id = ut.tool_id
      WHERE ut.user_id = $1
        AND (
          tc.key = $2
          OR lower(tc.display_name) = lower($3)
        )
      ORDER BY ut.updated_at DESC
      LIMIT 1
    `,
    [userId, normalizedKey, toolKeyOrDisplay.trim()],
  );

  return result.rows[0] || null;
}

export async function ensureStripeToolForUser(userId: string): Promise<ReturnType<typeof mapUserToolRow>> {
  const catalog = await ensureCatalogTool({
    toolKey: 'stripe',
    displayName: 'Stripe',
    category: 'payments',
    iconName: 'stripe',
    homepageUrl: 'https://stripe.com',
    loginUrl: 'https://dashboard.stripe.com/login',
    signupUrl: 'https://dashboard.stripe.com/register',
    supportsOauth: true,
    supportsPasswordLogin: true,
    supportsApiKey: true,
    defaultEnabled: true,
  });

  const existing = await loadUserToolJoinedByKey(userId, 'stripe');
  if (existing) return mapUserToolRow(existing);

  const inserted = await query<UserToolRow>(
    `
      INSERT INTO user_tools (
        id,
        user_id,
        tool_id,
        status,
        enabled,
        connection_type,
        label,
        login_identifier_masked,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'disconnected', FALSE, 'oauth', 'Payment setup', NULL, 'manual', NOW(), NOW())
      ON CONFLICT (user_id, tool_id) DO NOTHING
      RETURNING
        id,
        user_id,
        tool_id,
        status,
        enabled,
        connection_type,
        label,
        login_identifier_masked,
        last_used_at,
        last_verified_at,
        created_by,
        created_at,
        updated_at
    `,
    [randomUUID(), userId, catalog.id],
  );

  if (inserted.rows[0]) {
    const insertedJoined = await loadUserToolJoinedById(userId, inserted.rows[0].id);
    if (insertedJoined) return mapUserToolRow(insertedJoined);
  }

  const resolved = await loadUserToolJoinedByKey(userId, 'stripe');
  if (!resolved) {
    throw new Error('Failed to ensure Stripe tool for user');
  }
  return mapUserToolRow(resolved);
}

async function loadVaultEntry(userToolId: string): Promise<VaultEntryRow | null> {
  const result = await query<VaultEntryRow>(
    `
      SELECT
        id,
        user_tool_id,
        secret_type,
        encrypted_secret,
        encrypted_metadata,
        key_version,
        created_at,
        updated_at
      FROM vault_entries
      WHERE user_tool_id = $1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [userToolId],
  );

  return result.rows[0] || null;
}

async function upsertVaultEntry(input: {
  userToolId: string;
  secretType: ToolSecretType;
  secret: unknown;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const encryptedSecret = encryptVaultValue(input.secret);
  const encryptedMetadata = input.metadata ? encryptVaultValue(input.metadata) : null;

  await query(
    `
      INSERT INTO vault_entries (
        id,
        user_tool_id,
        secret_type,
        encrypted_secret,
        encrypted_metadata,
        key_version,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (user_tool_id, secret_type) DO UPDATE SET
        encrypted_secret = EXCLUDED.encrypted_secret,
        encrypted_metadata = EXCLUDED.encrypted_metadata,
        key_version = EXCLUDED.key_version,
        updated_at = NOW()
    `,
    [
      randomUUID(),
      input.userToolId,
      input.secretType,
      encryptedSecret.encrypted,
      encryptedMetadata?.encrypted || null,
      encryptedSecret.keyVersion,
    ],
  );
}

export async function recordToolEvent(input: {
  userToolId: string;
  eventType: UserToolEventType;
  message?: string | null;
}): Promise<void> {
  const safeMessage = sanitizeToolEventMessage(input.message);
  await query(
    `
      INSERT INTO user_tool_events (id, user_tool_id, event_type, message, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `,
    [randomUUID(), input.userToolId, input.eventType, safeMessage],
  );
}

export async function listToolEvents(input: {
  userId: string;
  userToolId: string;
  limit?: number;
}): Promise<Array<ReturnType<typeof mapEventRow>>> {
  const owned = await loadUserToolJoinedById(input.userId, input.userToolId);
  if (!owned) return [];

  const limit = Number.isFinite(input.limit) && (input.limit || 0) > 0
    ? Math.min(Math.trunc(input.limit || 20), 200)
    : 20;

  const result = await query<EventRow>(
    `
      SELECT
        id,
        user_tool_id,
        event_type,
        message,
        created_at
      FROM user_tool_events
      WHERE user_tool_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [input.userToolId, limit],
  );

  return result.rows.map(mapEventRow);
}

export async function listToolsCatalog() {
  await seedDefaultToolsCatalogIfNeeded();
  const result = await query<ToolCatalogRow>(
    `
      SELECT
        id,
        key,
        display_name,
        category,
        icon_name,
        homepage_url,
        login_url,
        signup_url,
        supports_oauth,
        supports_password_login,
        supports_api_key,
        default_enabled,
        created_at,
        updated_at
      FROM tools_catalog
      ORDER BY display_name ASC
    `,
  );

  return result.rows.map(mapCatalogRow);
}

export async function listUserTools(userId: string) {
  await ensureStripeToolForUser(userId);

  const result = await query<UserToolJoinedRow>(
    `
      SELECT
        ut.id,
        ut.user_id,
        ut.tool_id,
        ut.status,
        ut.enabled,
        ut.connection_type,
        ut.label,
        ut.login_identifier_masked,
        ut.last_used_at,
        ut.last_verified_at,
        ut.created_by,
        ut.created_at,
        ut.updated_at,
        EXISTS (
          SELECT 1
          FROM vault_entries ve
          WHERE ve.user_tool_id = ut.id
        ) AS has_secret,
        tc.key AS tool_key,
        tc.display_name AS tool_display_name,
        tc.category AS tool_category,
        tc.icon_name AS tool_icon_name,
        tc.homepage_url AS tool_homepage_url,
        tc.login_url AS tool_login_url,
        tc.signup_url AS tool_signup_url,
        tc.supports_oauth AS tool_supports_oauth,
        tc.supports_password_login AS tool_supports_password_login,
        tc.supports_api_key AS tool_supports_api_key,
        tc.default_enabled AS tool_default_enabled
      FROM user_tools ut
      INNER JOIN tools_catalog tc ON tc.id = ut.tool_id
      WHERE ut.user_id = $1
      ORDER BY COALESCE(ut.last_used_at, ut.updated_at) DESC, ut.created_at DESC
    `,
    [userId],
  );

  return result.rows.map(mapUserToolRow);
}

export async function connectToolForUser(input: {
  userId: string;
  toolKey: string;
  displayName?: string;
  category?: string | null;
  iconName?: string | null;
  homepageUrl?: string | null;
  loginUrl?: string | null;
  signupUrl?: string | null;
  supportsOauth?: boolean;
  supportsPasswordLogin?: boolean;
  supportsApiKey?: boolean;
  connectionType: ToolConnectionType;
  secretType?: ToolSecretType;
  secret: unknown;
  metadata?: Record<string, unknown> | null;
  label?: string;
  loginIdentifier?: string;
  status?: UserToolStatus;
  enabled?: boolean;
  createdBy?: UserToolCreatedBy;
}): Promise<ReturnType<typeof mapUserToolRow>> {
  const toolKey = normalizeToolKey(input.toolKey);
  if (!toolKey) {
    throw new Error('toolKey is required');
  }

  const displayName = normalizeDisplayName(input.displayName || '', toolKey);
  const category = input.category?.trim() || null;
  const iconName = input.iconName?.trim() || null;
  const homepageUrl = normalizeUrl(input.homepageUrl);
  const loginUrl = normalizeUrl(input.loginUrl);
  const signupUrl = normalizeUrl(input.signupUrl);
  const connectionType = toToolConnectionType(input.connectionType);
  const secretType = toToolSecretType(input.secretType, connectionType);
  const status = normalizeStatus(input.status || 'connected');
  const createdBy = normalizeCreatedBy(input.createdBy || 'manual');
  const maskedIdentifier = input.loginIdentifier ? maskLoginIdentifier(input.loginIdentifier) : null;

  const catalog = await ensureCatalogTool({
    toolKey,
    displayName,
    category,
    iconName,
    homepageUrl,
    loginUrl,
    signupUrl,
    supportsOauth: input.supportsOauth,
    supportsPasswordLogin: input.supportsPasswordLogin,
    supportsApiKey: input.supportsApiKey,
    defaultEnabled: input.enabled,
  });

  const upserted = await query<UserToolRow>(
    `
      INSERT INTO user_tools (
        id,
        user_id,
        tool_id,
        status,
        enabled,
        connection_type,
        label,
        login_identifier_masked,
        created_by,
        created_at,
        updated_at,
        last_verified_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), NOW())
      ON CONFLICT (user_id, tool_id) DO UPDATE SET
        status = EXCLUDED.status,
        enabled = EXCLUDED.enabled,
        connection_type = EXCLUDED.connection_type,
        label = COALESCE(EXCLUDED.label, user_tools.label),
        login_identifier_masked = COALESCE(EXCLUDED.login_identifier_masked, user_tools.login_identifier_masked),
        created_by = EXCLUDED.created_by,
        updated_at = NOW(),
        last_verified_at = NOW()
      RETURNING
        id,
        user_id,
        tool_id,
        status,
        enabled,
        connection_type,
        label,
        login_identifier_masked,
        last_used_at,
        last_verified_at,
        created_by,
        created_at,
        updated_at
    `,
    [
      randomUUID(),
      input.userId,
      catalog.id,
      status,
      input.enabled !== false,
      connectionType,
      input.label?.trim() || null,
      maskedIdentifier,
      createdBy,
    ],
  );

  const row = upserted.rows[0];
  if (!row) {
    throw new Error(`Failed to connect tool ${toolKey}`);
  }

  await upsertVaultEntry({
    userToolId: row.id,
    secretType,
    secret: input.secret,
    metadata: input.metadata || null,
  });

  await recordToolEvent({
    userToolId: row.id,
    eventType: 'connected',
    message: `Connected ${catalog.display_name}`,
  });

  const joined = await loadUserToolJoinedById(input.userId, row.id);
  if (!joined) {
    throw new Error(`Failed to load connected tool ${toolKey}`);
  }

  return mapUserToolRow(joined);
}

export async function reconnectToolForUser(input: {
  userId: string;
  userToolId: string;
  secret: unknown;
  secretType?: ToolSecretType;
  connectionType?: ToolConnectionType;
  metadata?: Record<string, unknown> | null;
  loginIdentifier?: string;
  label?: string;
}): Promise<ReturnType<typeof mapUserToolRow>> {
  const current = await loadUserToolJoinedById(input.userId, input.userToolId);
  if (!current) {
    throw new Error('Tool not found');
  }

  const connectionType = toToolConnectionType(input.connectionType || current.connection_type);
  const secretType = toToolSecretType(input.secretType, connectionType);
  const maskedIdentifier = input.loginIdentifier
    ? maskLoginIdentifier(input.loginIdentifier)
    : current.login_identifier_masked;

  await query(
    `
      UPDATE user_tools
      SET
        status = 'connected',
        enabled = TRUE,
        connection_type = $1,
        label = COALESCE($2, label),
        login_identifier_masked = COALESCE($3, login_identifier_masked),
        updated_at = NOW(),
        last_verified_at = NOW()
      WHERE id = $4
        AND user_id = $5
    `,
    [connectionType, input.label?.trim() || null, maskedIdentifier, input.userToolId, input.userId],
  );

  await upsertVaultEntry({
    userToolId: input.userToolId,
    secretType,
    secret: input.secret,
    metadata: input.metadata || null,
  });

  await recordToolEvent({
    userToolId: input.userToolId,
    eventType: 'updated',
    message: `Updated credentials for ${current.tool_display_name}`,
  });

  const next = await loadUserToolJoinedById(input.userId, input.userToolId);
  if (!next) {
    throw new Error('Tool not found after reconnect');
  }

  return mapUserToolRow(next);
}

export async function setToolEnabled(input: {
  userId: string;
  userToolId: string;
  enabled: boolean;
}): Promise<ReturnType<typeof mapUserToolRow>> {
  const update = await query<UserToolRow>(
    `
      UPDATE user_tools
      SET
        enabled = $1,
        status = CASE
          WHEN $1 = FALSE THEN 'disconnected'
          WHEN status = 'disconnected' THEN 'connected'
          ELSE status
        END,
        updated_at = NOW()
      WHERE id = $2
        AND user_id = $3
      RETURNING
        id,
        user_id,
        tool_id,
        status,
        enabled,
        connection_type,
        label,
        login_identifier_masked,
        last_used_at,
        last_verified_at,
        created_by,
        created_at,
        updated_at
    `,
    [input.enabled, input.userToolId, input.userId],
  );

  if (!update.rows[0]) {
    throw new Error('Tool not found');
  }

  await recordToolEvent({
    userToolId: input.userToolId,
    eventType: input.enabled ? 'enabled' : 'disabled',
    message: input.enabled ? 'Tool enabled' : 'Tool disabled',
  });

  const joined = await loadUserToolJoinedById(input.userId, input.userToolId);
  if (!joined) {
    throw new Error('Tool not found after update');
  }

  return mapUserToolRow(joined);
}

export async function removeTool(input: {
  userId: string;
  userToolId: string;
  deleteSecrets?: boolean;
}): Promise<void> {
  const current = await loadUserToolJoinedById(input.userId, input.userToolId);
  if (!current) {
    throw new Error('Tool not found');
  }

  await query(
    `
      UPDATE user_tools
      SET
        enabled = FALSE,
        status = 'disconnected',
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
    `,
    [input.userToolId, input.userId],
  );

  if (input.deleteSecrets !== false) {
    await query(
      `
        DELETE FROM vault_entries
        WHERE user_tool_id = $1
      `,
      [input.userToolId],
    );
  }

  await recordToolEvent({
    userToolId: input.userToolId,
    eventType: 'removed',
    message: `Removed ${current.tool_display_name}`,
  });
}

export async function resolveToolForAction(input: {
  userId: string;
  toolKey: string;
}): Promise<ReturnType<typeof mapUserToolRow> | null> {
  if (normalizeToolKey(input.toolKey) === 'stripe') {
    await ensureStripeToolForUser(input.userId);
  }
  const row = await loadUserToolJoinedByKey(input.userId, input.toolKey);
  return row ? mapUserToolRow(row) : null;
}

export async function registerToolFromSignup(input: {
  userId: string;
  toolKey: string;
  displayName?: string;
  category?: string | null;
  homepageUrl?: string | null;
  loginUrl?: string | null;
  signupUrl?: string | null;
  loginIdentifier?: string;
  secret: unknown;
  secretType?: ToolSecretType;
  connectionType?: ToolConnectionType;
  metadata?: Record<string, unknown> | null;
}): Promise<ReturnType<typeof mapUserToolRow>> {
  const connected = await connectToolForUser({
    userId: input.userId,
    toolKey: input.toolKey,
    displayName: input.displayName,
    category: input.category,
    homepageUrl: input.homepageUrl,
    loginUrl: input.loginUrl,
    signupUrl: input.signupUrl,
    connectionType: toToolConnectionType(input.connectionType || 'password'),
    secretType: toToolSecretType(input.secretType, toToolConnectionType(input.connectionType || 'password')),
    secret: input.secret,
    metadata: input.metadata,
    loginIdentifier: input.loginIdentifier,
    status: 'connected',
    enabled: true,
    createdBy: 'signup_flow',
  });

  await recordToolEvent({
    userToolId: connected.id,
    eventType: 'signup_created',
    message: `Created from signup flow for ${connected.tool.displayName}`,
  });

  return connected;
}

export async function markToolLoginFailure(input: {
  userId: string;
  toolKey: string;
  message: string;
}): Promise<void> {
  const resolved = await loadUserToolJoinedByKey(input.userId, input.toolKey);
  if (!resolved) return;

  await query(
    `
      UPDATE user_tools
      SET
        status = 'failed',
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
    `,
    [resolved.id, input.userId],
  );

  await recordToolEvent({
    userToolId: resolved.id,
    eventType: 'login_failed',
    message: input.message,
  });
}

export async function linkRunToTool(input: {
  runId: string;
  userToolId: string;
  actionType: string;
}): Promise<void> {
  const runId = input.runId.trim();
  if (!runId) return;

  await query(
    `
      INSERT INTO tool_run_links (id, run_id, user_tool_id, action_type, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `,
    [randomUUID(), runId, input.userToolId, input.actionType],
  );
}

export async function getRuntimeCredential(input: {
  userId: string;
  toolKey: string;
  actionType?: string;
  runId?: string;
}): Promise<{
  userToolId: string;
  toolKey: string;
  toolDisplayName: string;
  connectionType: ToolConnectionType;
  secretType: ToolSecretType;
  credential: unknown;
  credentialText: string | null;
  metadata: Record<string, unknown> | null;
} | null> {
  const tool = await loadUserToolJoinedByKey(input.userId, input.toolKey);
  if (!tool) return null;
  if (!tool.enabled || tool.status !== 'connected') return null;

  const vault = await loadVaultEntry(tool.id);
  if (!vault) return null;

  let credential: unknown;
  let metadata: Record<string, unknown> | null = null;

  try {
    credential = decryptVaultValue(vault.encrypted_secret, vault.key_version);
    if (vault.encrypted_metadata) {
      const parsedMeta = decryptVaultValue(vault.encrypted_metadata, vault.key_version);
      if (parsedMeta && typeof parsedMeta === 'object' && !Array.isArray(parsedMeta)) {
        metadata = parsedMeta as Record<string, unknown>;
      }
    }
  } catch {
    await markToolLoginFailure({
      userId: input.userId,
      toolKey: tool.tool_key,
      message: 'Stored credential could not be decrypted. Reconnect this tool.',
    });
    throw new Error('Stored credential could not be decrypted');
  }

  await query(
    `
      UPDATE user_tools
      SET
        last_used_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
    `,
    [tool.id, input.userId],
  );

  await recordToolEvent({
    userToolId: tool.id,
    eventType: 'login_used',
    message: `Credential used for ${input.actionType || 'automation action'}`,
  });

  if (input.runId && input.actionType) {
    await linkRunToTool({
      runId: input.runId,
      userToolId: tool.id,
      actionType: input.actionType,
    });
  }

  return {
    userToolId: tool.id,
    toolKey: tool.tool_key,
    toolDisplayName: tool.tool_display_name,
    connectionType: tool.connection_type,
    secretType: vault.secret_type,
    credential,
    credentialText: typeof credential === 'string' ? credential : null,
    metadata,
  };
}

export async function resolveRuntimeCredentialReference(input: {
  userId: string;
  toolKey: string;
}) {
  const tool = await loadUserToolJoinedByKey(input.userId, input.toolKey);
  if (!tool) {
    return {
      resolved: false,
      reason: 'not_found',
    } as const;
  }

  const hasConnectionSignal = tool.has_secret || Boolean(tool.login_identifier_masked);

  if (!tool.enabled) {
    return {
      resolved: false,
      reason: tool.status === 'disconnected' && !hasConnectionSignal ? 'not_connected' : 'not_enabled',
      tool: mapUserToolRow(tool),
    } as const;
  }

  if (tool.status === 'failed') {
    return {
      resolved: false,
      reason: 'needs_reconnect',
      tool: mapUserToolRow(tool),
    } as const;
  }

  if (tool.status !== 'connected') {
    return {
      resolved: false,
      reason: hasConnectionSignal ? 'needs_reconnect' : 'not_connected',
      tool: mapUserToolRow(tool),
    } as const;
  }

  const vault = await loadVaultEntry(tool.id);
  if (!vault) {
    return {
      resolved: false,
      reason: 'missing_secret',
      tool: mapUserToolRow(tool),
    } as const;
  }

  return {
    resolved: true,
    tool: mapUserToolRow(tool),
    secretType: vault.secret_type,
    keyVersion: vault.key_version,
    hasMetadata: Boolean(vault.encrypted_metadata),
  } as const;
}

export async function setStripeToolConnectedFromFunding(input: {
  userId: string;
  loginIdentifierMasked?: string | null;
  label?: string | null;
}): Promise<ReturnType<typeof mapUserToolRow>> {
  const ensured = await ensureStripeToolForUser(input.userId);
  const nextLabel = input.label?.trim() || ensured.label || 'Payment setup';
  const nextIdentifier = input.loginIdentifierMasked?.trim() || ensured.loginIdentifierMasked;

  await query(
    `
      UPDATE user_tools
      SET
        status = 'connected',
        enabled = TRUE,
        connection_type = 'session',
        label = $1,
        login_identifier_masked = $2,
        updated_at = NOW(),
        last_verified_at = NOW()
      WHERE id = $3
        AND user_id = $4
    `,
    [nextLabel, nextIdentifier || null, ensured.id, input.userId],
  );

  await recordToolEvent({
    userToolId: ensured.id,
    eventType: 'connected',
    message: 'Stripe payment setup completed',
  });

  const row = await loadUserToolJoinedById(input.userId, ensured.id);
  if (!row) {
    throw new Error('Failed to update Stripe tool after payment setup');
  }

  return mapUserToolRow(row);
}

export async function setStripeToolDisconnected(input: {
  userId: string;
  reason?: string;
}): Promise<void> {
  const stripeTool = await ensureStripeToolForUser(input.userId);

  await query(
    `
      UPDATE user_tools
      SET
        status = 'disconnected',
        enabled = FALSE,
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
    `,
    [stripeTool.id, input.userId],
  );

  await recordToolEvent({
    userToolId: stripeTool.id,
    eventType: 'disabled',
    message: input.reason || 'Stripe disconnected',
  });
}

export async function setStripeToolNeedsReconnect(input: {
  userId: string;
  reason?: string;
}): Promise<void> {
  const stripeTool = await ensureStripeToolForUser(input.userId);

  await query(
    `
      UPDATE user_tools
      SET
        status = 'failed',
        enabled = TRUE,
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
    `,
    [stripeTool.id, input.userId],
  );

  await recordToolEvent({
    userToolId: stripeTool.id,
    eventType: 'login_failed',
    message: input.reason || 'Stripe needs reconnect',
  });
}
