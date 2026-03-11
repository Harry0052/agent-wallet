import 'server-only';

import { query } from '@/lib/server/db';

export type OnboardingStep = 'welcome' | 'wallet' | 'profile' | 'tools' | 'complete';

type OnboardingRow = {
  user_id: string;
  onboarding_step: OnboardingStep;
  onboarding_completed_at: string | null;
  skipped_tool_setup: boolean;
  preferences: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export interface OnboardingState {
  appUserId: string;
  step: OnboardingStep;
  completedAt: string | null;
  skippedToolSetup: boolean;
  preferences: Record<string, unknown>;
}

const ONBOARDING_STEPS: OnboardingStep[] = ['welcome', 'wallet', 'profile', 'tools', 'complete'];

function isKnownStep(step: string): step is OnboardingStep {
  return ONBOARDING_STEPS.includes(step as OnboardingStep);
}

function sanitizeStep(step: string | null | undefined): OnboardingStep {
  if (!step) return 'welcome';
  return isKnownStep(step) ? step : 'welcome';
}

function normalizePreferences(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toState(row: OnboardingRow, appUserId: string): OnboardingState {
  return {
    appUserId,
    step: sanitizeStep(row.onboarding_step),
    completedAt: row.onboarding_completed_at,
    skippedToolSetup: Boolean(row.skipped_tool_setup),
    preferences: normalizePreferences(row.preferences),
  };
}

export async function ensureOnboardingState(appUserId: string): Promise<void> {
  await query(
    `
      INSERT INTO app_user_onboarding_states (user_id, onboarding_step, skipped_tool_setup, preferences)
      VALUES ($1, 'welcome', FALSE, '{}'::jsonb)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [appUserId],
  );
}

export async function getOnboardingState(appUserId: string): Promise<OnboardingState> {
  await ensureOnboardingState(appUserId);

  const result = await query<OnboardingRow>(
    `
      SELECT
        user_id,
        onboarding_step,
        onboarding_completed_at::text,
        skipped_tool_setup,
        preferences,
        created_at::text,
        updated_at::text
      FROM app_user_onboarding_states
      WHERE user_id = $1
      LIMIT 1
    `,
    [appUserId],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      appUserId,
      step: 'welcome',
      completedAt: null,
      skippedToolSetup: false,
      preferences: {},
    };
  }

  return toState(row, appUserId);
}

export async function updateOnboardingState(input: {
  appUserId: string;
  step?: Exclude<OnboardingStep, 'complete'>;
  skippedToolSetup?: boolean;
  preferencesPatch?: Record<string, unknown>;
}): Promise<OnboardingState> {
  await ensureOnboardingState(input.appUserId);

  const existing = await getOnboardingState(input.appUserId);
  const nextStep = input.step || existing.step;
  const nextPreferences = {
    ...existing.preferences,
    ...(input.preferencesPatch || {}),
  };

  await query(
    `
      UPDATE app_user_onboarding_states
      SET
        onboarding_step = $2,
        skipped_tool_setup = COALESCE($3, skipped_tool_setup),
        preferences = $4::jsonb,
        updated_at = NOW()
      WHERE user_id = $1
    `,
    [
      input.appUserId,
      nextStep,
      typeof input.skippedToolSetup === 'boolean' ? input.skippedToolSetup : null,
      JSON.stringify(nextPreferences),
    ],
  );

  return getOnboardingState(input.appUserId);
}

export async function completeOnboarding(input: {
  appUserId: string;
  skippedToolSetup?: boolean;
  preferencesPatch?: Record<string, unknown>;
}): Promise<OnboardingState> {
  await ensureOnboardingState(input.appUserId);
  const existing = await getOnboardingState(input.appUserId);
  const nextPreferences = {
    ...existing.preferences,
    ...(input.preferencesPatch || {}),
  };

  await query(
    `
      UPDATE app_user_onboarding_states
      SET
        onboarding_step = 'complete',
        onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()),
        skipped_tool_setup = COALESCE($2, skipped_tool_setup),
        preferences = $3::jsonb,
        updated_at = NOW()
      WHERE user_id = $1
    `,
    [
      input.appUserId,
      typeof input.skippedToolSetup === 'boolean' ? input.skippedToolSetup : null,
      JSON.stringify(nextPreferences),
    ],
  );

  return getOnboardingState(input.appUserId);
}

export async function isOnboardingComplete(appUserId: string): Promise<boolean> {
  const state = await getOnboardingState(appUserId);
  return state.step === 'complete' || Boolean(state.completedAt);
}

export async function getPostAuthRedirectPath(appUserId: string): Promise<string> {
  const complete = await isOnboardingComplete(appUserId);
  return complete ? '/operator' : '/onboarding';
}
