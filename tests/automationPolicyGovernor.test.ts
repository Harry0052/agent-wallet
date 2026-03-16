import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExecutionPolicy } from '../lib/server/automation/policy.ts';
import {
  cooldownUntilForActionType,
  evaluateAutomationCandidateSuppression,
} from '../lib/server/automation/governor.ts';
import type { AutomationPolicyConfig } from '../lib/server/automation/types.ts';

const BASE_POLICY: AutomationPolicyConfig = {
  defaultMode: 'user_confirm_required',
  perActionMode: {},
  autopilotEnabledActions: {},
  explicitConfirmEnabledActions: {},
};

test('permission enforcement blocks sensitive autopilot without explicit permission controls', () => {
  const decision = evaluateExecutionPolicy({
    actionType: 'bill_pay',
    policyConfig: {
      ...BASE_POLICY,
      defaultMode: 'autopilot_allowed',
      autopilotEnabledActions: { bill_pay: true },
      explicitConfirmEnabledActions: { bill_pay: false },
    },
  });

  assert.equal(decision.mode, 'autopilot_allowed');
  assert.equal(decision.autopilotAllowed, false);
  assert.equal(decision.requiresConfirmation, true);
  assert.match(decision.reason, /explicit permission/i);
});

test('autopilot allows low-risk action when enabled', () => {
  const decision = evaluateExecutionPolicy({
    actionType: 'expense_categorization',
    policyConfig: {
      ...BASE_POLICY,
      defaultMode: 'autopilot_allowed',
      autopilotEnabledActions: { expense_categorization: true },
    },
  });

  assert.equal(decision.autopilotAllowed, true);
  assert.equal(decision.requiresConfirmation, false);
});

test('cooldown and dedup suppressions are deterministic', () => {
  const nowIso = '2026-03-15T12:00:00.000Z';

  const lowConfidence = evaluateAutomationCandidateSuppression({
    confidence: 0.4,
    minConfidence: 0.55,
    hasActiveDuplicate: false,
    cooldownUntil: null,
    nowIso,
  });
  assert.equal(lowConfidence, 'low_confidence');

  const duplicate = evaluateAutomationCandidateSuppression({
    confidence: 0.7,
    minConfidence: 0.55,
    hasActiveDuplicate: true,
    cooldownUntil: null,
    nowIso,
  });
  assert.equal(duplicate, 'duplicate');

  const cooldown = evaluateAutomationCandidateSuppression({
    confidence: 0.7,
    minConfidence: 0.55,
    hasActiveDuplicate: false,
    cooldownUntil: '2026-03-20T00:00:00.000Z',
    nowIso,
  });
  assert.equal(cooldown, 'cooldown');

  const ok = evaluateAutomationCandidateSuppression({
    confidence: 0.7,
    minConfidence: 0.55,
    hasActiveDuplicate: false,
    cooldownUntil: '2026-03-10T00:00:00.000Z',
    nowIso,
  });
  assert.equal(ok, 'ok');
});

test('cooldown helper returns future timestamp by action type', () => {
  const nowIso = '2026-03-15T12:00:00.000Z';
  const next = cooldownUntilForActionType({
    actionType: 'subscription_cancel',
    nowIso,
  });

  assert.ok(Date.parse(next) > Date.parse(nowIso));
  const deltaDays = Math.round((Date.parse(next) - Date.parse(nowIso)) / (24 * 60 * 60 * 1000));
  assert.equal(deltaDays, 14);
});
