import 'server-only';

import type { AppUserSettings } from '@/lib/types';
import { query } from '@/lib/server/db';

type UserSettingsRow = {
  user_id: string;
  locale: string;
  timezone: string;
  dashboard_default_view: string;
  security: Record<string, unknown> | null;
  agent_defaults: Record<string, unknown> | null;
  notifications: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_SETTINGS = {
  locale: 'en-US',
  timezone: 'UTC',
  dashboardDefaultView: 'operator',
  security: {},
  agentDefaults: {},
  notifications: {},
} as const;

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toModel(row: UserSettingsRow): AppUserSettings {
  return {
    userId: row.user_id,
    locale: row.locale,
    timezone: row.timezone,
    dashboardDefaultView: row.dashboard_default_view,
    security: normalizeJsonObject(row.security),
    agentDefaults: normalizeJsonObject(row.agent_defaults),
    notifications: normalizeJsonObject(row.notifications),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureUserSettingsRow(appUserId: string): Promise<void> {
  await query(
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
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [
      appUserId,
      DEFAULT_SETTINGS.locale,
      DEFAULT_SETTINGS.timezone,
      DEFAULT_SETTINGS.dashboardDefaultView,
      JSON.stringify(DEFAULT_SETTINGS.security),
      JSON.stringify(DEFAULT_SETTINGS.agentDefaults),
      JSON.stringify(DEFAULT_SETTINGS.notifications),
    ],
  );
}

export async function getUserSettings(appUserId: string): Promise<AppUserSettings> {
  await ensureUserSettingsRow(appUserId);

  const result = await query<UserSettingsRow>(
    `
      SELECT
        user_id,
        locale,
        timezone,
        dashboard_default_view,
        security,
        agent_defaults,
        notifications,
        created_at::text,
        updated_at::text
      FROM app_user_settings
      WHERE user_id = $1
      LIMIT 1
    `,
    [appUserId],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      userId: appUserId,
      locale: DEFAULT_SETTINGS.locale,
      timezone: DEFAULT_SETTINGS.timezone,
      dashboardDefaultView: DEFAULT_SETTINGS.dashboardDefaultView,
      security: {},
      agentDefaults: {},
      notifications: {},
    };
  }

  return toModel(row);
}

export async function upsertUserSettings(input: {
  appUserId: string;
  locale?: string;
  timezone?: string;
  dashboardDefaultView?: string;
  securityPatch?: Record<string, unknown>;
  agentDefaultsPatch?: Record<string, unknown>;
  notificationsPatch?: Record<string, unknown>;
}): Promise<AppUserSettings> {
  const current = await getUserSettings(input.appUserId);

  const next = {
    locale: input.locale?.trim() || current.locale || DEFAULT_SETTINGS.locale,
    timezone: input.timezone?.trim() || current.timezone || DEFAULT_SETTINGS.timezone,
    dashboardDefaultView: input.dashboardDefaultView?.trim() || current.dashboardDefaultView || DEFAULT_SETTINGS.dashboardDefaultView,
    security: { ...current.security, ...(input.securityPatch || {}) },
    agentDefaults: { ...current.agentDefaults, ...(input.agentDefaultsPatch || {}) },
    notifications: { ...current.notifications, ...(input.notificationsPatch || {}) },
  };

  await query(
    `
      UPDATE app_user_settings
      SET
        locale = $2,
        timezone = $3,
        dashboard_default_view = $4,
        security = $5::jsonb,
        agent_defaults = $6::jsonb,
        notifications = $7::jsonb,
        updated_at = NOW()
      WHERE user_id = $1
    `,
    [
      input.appUserId,
      next.locale,
      next.timezone,
      next.dashboardDefaultView,
      JSON.stringify(next.security),
      JSON.stringify(next.agentDefaults),
      JSON.stringify(next.notifications),
    ],
  );

  return getUserSettings(input.appUserId);
}
