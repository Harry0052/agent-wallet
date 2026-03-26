import 'server-only';

import type { AutomationActionType, AutomationPolicyMode } from '../../types.ts';
import {
  DESTRUCTIVE_ACTIONS,
  DEFAULT_AUTOMATION_POLICY_CONFIG,
  MONEY_MOVEMENT_ACTIONS,
  type AutomationExecutionPolicyDecision,
  type AutomationPolicyConfig,
} from './types.ts';

function normalizeMode(value: unknown): AutomationPolicyMode | null {
  if (value === 'suggest_only' || value === 'user_confirm_required' || value === 'autopilot_allowed') {
    return value;
  }
  return null;
}

function toBoolRecord(value: unknown): Partial<Record<AutomationActionType, boolean>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<AutomationActionType, boolean>> = {};
  for (const [key, recordValue] of Object.entries(value)) {
    if (typeof recordValue !== 'boolean') continue;
    if (isAutomationActionType(key)) {
      out[key] = recordValue;
    }
  }
  return out;
}

function toModeRecord(value: unknown): Partial<Record<AutomationActionType, AutomationPolicyMode>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<AutomationActionType, AutomationPolicyMode>> = {};
  for (const [key, recordValue] of Object.entries(value)) {
    if (!isAutomationActionType(key)) continue;
    const normalized = normalizeMode(recordValue);
    if (!normalized) continue;
    out[key] = normalized;
  }
  return out;
}

function isAutomationActionType(value: string): value is AutomationActionType {
  return value === 'subscription_cancel'
    || value === 'subscription_negotiate'
    || value === 'bill_pay'
    || value === 'savings_transfer'
    || value === 'debt_optimize'
    || value === 'expense_categorization'
    || value === 'refund_budget'
    || value === 'recurring_review'
    || value === 'trial_conversion_review'
    || value === 'bill_split';
}

export function parseAutomationPolicyConfig(value: unknown): AutomationPolicyConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_AUTOMATION_POLICY_CONFIG;
  }

  const record = value as Record<string, unknown>;
  const defaultMode = normalizeMode(record.defaultMode) || DEFAULT_AUTOMATION_POLICY_CONFIG.defaultMode;

  return {
    defaultMode,
    perActionMode: toModeRecord(record.perActionMode),
    autopilotEnabledActions: toBoolRecord(record.autopilotEnabledActions),
    explicitConfirmEnabledActions: toBoolRecord(record.explicitConfirmEnabledActions),
  };
}

export function requiresExplicitPermissionControls(actionType: AutomationActionType): boolean {
  return MONEY_MOVEMENT_ACTIONS.has(actionType) || DESTRUCTIVE_ACTIONS.has(actionType);
}

export function evaluateExecutionPolicy(input: {
  actionType: AutomationActionType;
  policyConfig: AutomationPolicyConfig;
}): AutomationExecutionPolicyDecision {
  const selectedMode = input.policyConfig.perActionMode[input.actionType] || input.policyConfig.defaultMode;
  const requiresPermission = requiresExplicitPermissionControls(input.actionType);

  if (selectedMode === 'suggest_only') {
    return {
      mode: selectedMode,
      requiresConfirmation: true,
      autopilotAllowed: false,
      reason: 'Policy is suggest-only; execution is suppressed until user changes policy.',
    };
  }

  if (selectedMode === 'user_confirm_required') {
    return {
      mode: selectedMode,
      requiresConfirmation: true,
      autopilotAllowed: false,
      reason: 'Policy requires per-action user confirmation before execution.',
    };
  }

  const autopilotEnabled = Boolean(input.policyConfig.autopilotEnabledActions[input.actionType]);
  const explicitConfirmEnabled = Boolean(input.policyConfig.explicitConfirmEnabledActions[input.actionType]);

  if (!autopilotEnabled) {
    return {
      mode: selectedMode,
      requiresConfirmation: true,
      autopilotAllowed: false,
      reason: 'Autopilot is disabled for this action type.',
    };
  }

  if (requiresPermission && !explicitConfirmEnabled) {
    return {
      mode: selectedMode,
      requiresConfirmation: true,
      autopilotAllowed: false,
      reason: 'Explicit permission control is not enabled for this sensitive action.',
    };
  }

  return {
    mode: selectedMode,
    requiresConfirmation: requiresPermission,
    autopilotAllowed: true,
    reason: 'Autopilot policy is enabled with required permission controls.',
  };
}

export function mergePolicyPatch(input: {
  current: AutomationPolicyConfig;
  patch: Partial<AutomationPolicyConfig>;
}): AutomationPolicyConfig {
  const nextDefault = input.patch.defaultMode || input.current.defaultMode;
  return {
    defaultMode: nextDefault,
    perActionMode: {
      ...input.current.perActionMode,
      ...(input.patch.perActionMode || {}),
    },
    autopilotEnabledActions: {
      ...input.current.autopilotEnabledActions,
      ...(input.patch.autopilotEnabledActions || {}),
    },
    explicitConfirmEnabledActions: {
      ...input.current.explicitConfirmEnabledActions,
      ...(input.patch.explicitConfirmEnabledActions || {}),
    },
  };
}
