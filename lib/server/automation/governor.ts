import type { AutomationActionType } from '../../types';

export type AutomationSuppressionReason = 'ok' | 'low_confidence' | 'duplicate' | 'cooldown';

export interface DuplicateRiskResult {
  isDuplicate: boolean;
  existingActionId: string | null;
  reason: string;
}

const DEFAULT_DUPLICATE_WINDOW_MINUTES = 30;

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

/**
 * Check whether dispatching this action would be a duplicate of a recent
 * action with the same type, similar amount, and target service.
 *
 * "Similar amount" means within 5% of each other.
 */
export async function checkDuplicateRisk(input: {
  userId: string;
  actionType: AutomationActionType;
  amount: number | null;
  targetService: string | null;
  windowMinutes?: number;
}): Promise<DuplicateRiskResult> {
  const { query } = await import('@/lib/server/db');
  const { logServerEvent } = await import('@/lib/server/observability');
  const windowMinutes = input.windowMinutes ?? DEFAULT_DUPLICATE_WINDOW_MINUTES;
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  // Build the base query — always filter on user, action type, status, and time window
  const conditions: string[] = [
    'user_id = $1',
    'action_type = $2',
    'status IN (\'attempted\', \'completed\')',
    'created_at >= $3',
  ];
  const params: (string | number)[] = [input.userId, input.actionType, cutoff];
  let paramIdx = 4;

  // If a target service is provided, also match on it via the payload JSONB
  if (input.targetService) {
    conditions.push(`(payload->>'merchant' = $${paramIdx} OR payload->>'targetService' = $${paramIdx})`);
    params.push(input.targetService);
    paramIdx += 1;
  }

  const sql = `
    SELECT id, amount::numeric AS amount
    FROM automation_actions
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT 10
  `;

  try {
    const result = await query<{ id: string; amount: string | null }>(sql, params);

    for (const row of result.rows) {
      // If no amounts to compare, any match on type+service+window is a duplicate
      if (input.amount === null || row.amount === null) {
        logServerEvent('info', 'governor.duplicate_risk.matched', {
          userId: input.userId,
          actionType: input.actionType,
          existingActionId: row.id,
          reason: 'same_type_no_amount',
        });
        return {
          isDuplicate: true,
          existingActionId: row.id,
          reason: `Duplicate detected: same action type within ${windowMinutes} minute window (no amount comparison available).`,
        };
      }

      const existingAmount = Number(row.amount);
      if (!Number.isFinite(existingAmount) || existingAmount === 0) continue;

      const diff = Math.abs(input.amount - existingAmount);
      const threshold = Math.max(existingAmount, input.amount) * 0.05;

      if (diff <= threshold) {
        logServerEvent('info', 'governor.duplicate_risk.matched', {
          userId: input.userId,
          actionType: input.actionType,
          existingActionId: row.id,
          existingAmount,
          newAmount: input.amount,
          diffPercent: Math.round((diff / Math.max(existingAmount, 1)) * 100),
        });
        return {
          isDuplicate: true,
          existingActionId: row.id,
          reason: `Duplicate detected: ${input.actionType} for similar amount (${existingAmount.toFixed(2)} vs ${input.amount.toFixed(2)}) within ${windowMinutes} minute window.`,
        };
      }
    }

    return {
      isDuplicate: false,
      existingActionId: null,
      reason: 'No duplicate found.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logServerEvent('error', 'governor.duplicate_risk.error', {
      userId: input.userId,
      actionType: input.actionType,
      error: message,
    });

    // Fail open: if the check itself fails, don't block the action
    return {
      isDuplicate: false,
      existingActionId: null,
      reason: `Duplicate check failed: ${message}. Proceeding.`,
    };
  }
}
