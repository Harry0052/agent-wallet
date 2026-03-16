import 'server-only';

import { query } from '@/lib/server/db';
import { ensureUserSettingsRow } from '@/lib/server/userSettings';
import {
  mergePolicyPatch,
  parseAutomationPolicyConfig,
} from '@/lib/server/automation/policy';
import type { AutomationPolicyConfig } from '@/lib/server/automation/types';

interface AgentDefaultsRow {
  agent_defaults: Record<string, unknown> | null;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function getAutomationPolicyConfig(userId: string): Promise<AutomationPolicyConfig> {
  await ensureUserSettingsRow(userId);

  const result = await query<AgentDefaultsRow>(
    `
      SELECT agent_defaults
      FROM app_user_settings
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  const agentDefaults = toObject(result.rows[0]?.agent_defaults);
  return parseAutomationPolicyConfig(agentDefaults.automation_policy);
}

export async function updateAutomationPolicyConfig(input: {
  userId: string;
  patch: Partial<AutomationPolicyConfig>;
}): Promise<AutomationPolicyConfig> {
  await ensureUserSettingsRow(input.userId);

  const current = await getAutomationPolicyConfig(input.userId);
  const next = mergePolicyPatch({ current, patch: input.patch });

  const currentDefaultsResult = await query<AgentDefaultsRow>(
    `
      SELECT agent_defaults
      FROM app_user_settings
      WHERE user_id = $1
      LIMIT 1
    `,
    [input.userId],
  );

  const currentDefaults = toObject(currentDefaultsResult.rows[0]?.agent_defaults);
  const mergedDefaults = {
    ...currentDefaults,
    automation_policy: next,
  };

  await query(
    `
      UPDATE app_user_settings
      SET
        agent_defaults = $2::jsonb,
        updated_at = NOW()
      WHERE user_id = $1
    `,
    [input.userId, JSON.stringify(mergedDefaults)],
  );

  return next;
}
