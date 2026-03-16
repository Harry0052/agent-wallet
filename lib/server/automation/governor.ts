import type { AutomationActionType } from '../../types';

export type AutomationSuppressionReason = 'ok' | 'low_confidence' | 'duplicate' | 'cooldown';

export const AUTOMATION_COOLDOWN_DAYS: Record<AutomationActionType, number> = {
  subscription_cancel: 14,
  subscription_negotiate: 14,
  bill_pay: 3,
  savings_transfer: 3,
  debt_optimize: 7,
  expense_categorization: 2,
  refund_budget: 7,
  recurring_review: 14,
  trial_conversion_review: 14,
  bill_split: 7,
};

export function cooldownUntilForActionType(input: {
  actionType: AutomationActionType;
  nowIso: string;
}): string {
  const days = AUTOMATION_COOLDOWN_DAYS[input.actionType] || 7;
  return new Date(Date.parse(input.nowIso) + days * 24 * 60 * 60 * 1000).toISOString();
}

export function evaluateAutomationCandidateSuppression(input: {
  confidence: number;
  minConfidence: number;
  hasActiveDuplicate: boolean;
  cooldownUntil: string | null;
  nowIso: string;
}): AutomationSuppressionReason {
  if (input.confidence < input.minConfidence) return 'low_confidence';
  if (input.hasActiveDuplicate) return 'duplicate';

  if (input.cooldownUntil) {
    const cooldownMs = Date.parse(input.cooldownUntil);
    const nowMs = Date.parse(input.nowIso);
    if (Number.isFinite(cooldownMs) && Number.isFinite(nowMs) && cooldownMs > nowMs) {
      return 'cooldown';
    }
  }

  return 'ok';
}
