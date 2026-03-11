import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('schema includes app_user_settings and onboarding/auth token indexes', () => {
  const schema = read('db/schema.sql');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS app_user_settings/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_app_user_settings_updated/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_app_password_reset_tokens_user_expires/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_app_email_verification_tokens_user_expires/);
});

test('schema includes user-scoped tool connection tables and ownership constraints', () => {
  const schema = read('db/schema.sql');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS tools_catalog/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_tools/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS vault_entries/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_tool_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS tool_run_links/);
  assert.match(schema, /fk_user_tools_user_id/);
  assert.match(schema, /fk_user_tools_tool_id/);
  assert.match(schema, /fk_vault_entries_user_tool_id/);
  assert.match(schema, /fk_user_tool_events_user_tool_id/);
  assert.match(schema, /fk_tool_run_links_user_tool_id/);
});

test('foundation migration backfills existing users for onboarding and settings', () => {
  const migration = read('db/migrations/20260311_multitenant_data_foundation.sql');
  assert.match(migration, /INSERT INTO app_user_onboarding_states/);
  assert.match(migration, /SELECT id[\s\S]*FROM app_users[\s\S]*ON CONFLICT \(user_id\) DO NOTHING/);
  assert.match(migration, /INSERT INTO app_user_settings/);
});

test('user settings server model exists and is initialized during auth flows', () => {
  const settingsModel = read('lib/server/userSettings.ts');
  const authSource = read('lib/server/auth.ts');
  assert.match(settingsModel, /export async function ensureUserSettingsRow/);
  assert.match(settingsModel, /export async function getUserSettings/);
  assert.match(settingsModel, /export async function upsertUserSettings/);
  assert.match(authSource, /ensureUserSettingsRow\(appUserId\)/);
  assert.match(authSource, /ensureUserSettingsRow\(user\.id\)/);
});
