import 'server-only';

import type { AutomationActionRecord } from '@/lib/server/automation/types';
import type { AutomationPolicyConfig } from '@/lib/server/automation/types';
import type { ActionPlan } from './actionPlanner';

// ── Browser Profile Selection ────────────────────────────────────────────────

/**
 * Sites known to aggressively block automated browsers.
 * These require a stealth browser profile to avoid detection.
 */
const STEALTH_REQUIRED_DOMAINS = new Set([
  'netflix.com',
  'hulu.com',
  'amazon.com',
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'citi.com',
  'capitalone.com',
  'discover.com',
  'amex.com',
  'disneyplus.com',
  'hbomax.com',
  'max.com',
  'peacocktv.com',
  'paramountplus.com',
  'spotify.com',
]);

export type BrowserProfile = 'lite' | 'stealth';
export type TinyFishEndpoint = 'run-sse' | 'run-async';

/**
 * Select the browser profile based on the target service.
 * Returns "stealth" for known-blocking sites, "lite" otherwise.
 */
export function selectBrowserProfile(action: AutomationActionRecord): BrowserProfile {
  const merchant = (
    (action.payload?.merchant as string)
    || (action.payload?.targetService as string)
    || ''
  ).toLowerCase();

  for (const domain of STEALTH_REQUIRED_DOMAINS) {
    if (merchant.includes(domain.replace('.com', '')) || merchant.includes(domain)) {
      return 'stealth';
    }
  }

  return 'lite';
}

/**
 * Select the TinyFish endpoint based on whether the execution is user-facing.
 * - "run-sse" for user-facing (streamed progress updates)
 * - "run-async" for background execution (fire-and-forget with webhook)
 */
export function selectEndpoint(
  _action: AutomationActionRecord,
  userFacing: boolean,
): TinyFishEndpoint {
  return userFacing ? 'run-sse' : 'run-async';
}

// ── Goal Renderer ────────────────────────────────────────────────────────────

/**
 * Build the JSON return schema description for the goal prompt.
 * Defines the expected success and failure response shapes.
 */
function buildReturnSchema(): string {
  return [
    '',
    'RETURN FORMAT (JSON):',
    '',
    'On success:',
    '{',
    '  "success": true,',
    '  "status": "completed",',
    '  "action_type": "<the action type executed>",',
    '  "confirmation": {',
    '    "reference_number": "<confirmation or reference number if available>",',
    '    "effective_date": "<when the action takes effect>",',
    '    "summary": "<one-sentence human-readable summary>"',
    '  },',
    '  "evidence": [',
    '    { "type": "screenshot|confirmation_number|text_summary", "label": "<description>", "value": "<content>" }',
    '  ]',
    '}',
    '',
    'On failure:',
    '{',
    '  "success": false,',
    '  "status": "failed",',
    '  "action_type": "<the action type attempted>",',
    '  "failure_reason": "<login_failed|otp_required|captcha_required|site_changed|action_blocked|timeout|rate_limited|credentials_missing|unsupported_service>",',
    '  "detail": "<human-readable explanation of what happened>",',
    '  "steps_completed": <number of steps completed before failure>,',
    '  "evidence": []',
    '}',
  ].join('\n');
}

/**
 * Build duplicate protection language for the goal prompt.
 */
function buildDuplicateProtection(action: AutomationActionRecord): string {
  return [
    '',
    'DUPLICATE PROTECTION:',
    `- Idempotency: This action has ID "${action.id}". If you detect that this action has already been completed (e.g., subscription already canceled, bill already paid), report success with evidence rather than attempting again.`,
    '- Do NOT submit any form, click any confirmation button, or make any irreversible change more than once.',
    '- If you are unsure whether a previous attempt succeeded, report NEEDS_USER_REVIEW rather than retrying.',
  ].join('\n');
}

/**
 * Build the policy limits section for the goal prompt.
 */
function buildPolicyLimits(
  action: AutomationActionRecord,
  policySnapshot: AutomationPolicyConfig,
): string {
  const mode = policySnapshot.perActionMode[action.actionType] || policySnapshot.defaultMode;

  const lines = [
    '',
    'USER-APPROVED POLICY LIMITS:',
    `- Policy mode: ${mode}`,
    `- Action requires explicit confirmation: ${action.requiresExplicitConfirmation}`,
  ];

  if (action.amount !== null) {
    lines.push(`- Approved amount: ${action.amount} ${action.currency || 'USD'}`);
    lines.push('- Do NOT exceed this amount under any circumstances.');
  }

  lines.push('- Do NOT navigate away from the target service.');
  lines.push('- Do NOT agree to new charges, upsells, or plan upgrades.');
  lines.push('- Do NOT share, download, or exfiltrate any user data.');

  return lines.join('\n');
}

/**
 * Build the stop conditions for the goal prompt.
 */
function buildStopConditions(): string {
  return [
    '',
    'STOP CONDITIONS (halt immediately if any occur):',
    '- CAPTCHA that cannot be solved automatically',
    '- Two-factor authentication requiring physical device',
    '- Login credentials are rejected after one retry',
    '- The site requests payment information you do not have',
    '- Any page asks you to agree to new terms or charges',
    '- The target page layout does not match expected navigation',
    '- You are redirected to an unexpected domain',
    '- 90 seconds have elapsed since execution started',
  ].join('\n');
}

/**
 * Render a fully formed goal string for TinyFish execution.
 *
 * The goal includes:
 * - Clear objective description
 * - User-approved policy limits
 * - Numbered step-by-step plan
 * - Stop conditions
 * - Expected JSON return schema (success + failure shapes)
 * - Duplicate protection language
 */
export function renderTinyFishGoal(
  action: AutomationActionRecord,
  policySnapshot: AutomationPolicyConfig,
  plan: ActionPlan,
): string {
  const targetService =
    (action.payload?.merchant as string)
    || (action.payload?.targetService as string)
    || 'the target service';

  const sections: string[] = [];

  // Objective
  sections.push(`OBJECTIVE: ${plan.summary} for ${targetService}.`);
  sections.push(`Action type: ${action.actionType}`);
  sections.push(`Risk level: ${plan.riskLevel}`);

  if (action.amount !== null) {
    sections.push(`Amount: ${action.amount} ${action.currency || 'USD'}`);
  }

  // Policy limits
  sections.push(buildPolicyLimits(action, policySnapshot));

  // Numbered steps
  sections.push('');
  sections.push('EXECUTION STEPS:');
  plan.steps.forEach((step, index) => {
    sections.push(`${index + 1}. ${step.label}`);
  });

  // Estimated duration
  sections.push('');
  sections.push(`Estimated duration: ${plan.estimatedDuration}`);

  // Stop conditions
  sections.push(buildStopConditions());

  // Duplicate protection
  sections.push(buildDuplicateProtection(action));

  // Return schema
  sections.push(buildReturnSchema());

  return sections.join('\n');
}
