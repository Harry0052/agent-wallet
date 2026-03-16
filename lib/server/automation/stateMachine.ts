import type { AutomationActionStatus } from '../../types';

const ALLOWED_TRANSITIONS: Record<AutomationActionStatus, ReadonlySet<AutomationActionStatus>> = {
  detected: new Set(['suggested', 'dismissed', 'snoozed']),
  suggested: new Set(['pending_confirm', 'attempted', 'dismissed', 'snoozed']),
  pending_confirm: new Set(['attempted', 'dismissed', 'snoozed']),
  attempted: new Set(['completed', 'failed', 'pending_confirm']),
  completed: new Set([]),
  failed: new Set(['suggested', 'pending_confirm', 'dismissed', 'snoozed']),
  dismissed: new Set([]),
  snoozed: new Set(['suggested', 'dismissed']),
};

export function canTransitionAutomationStatus(input: {
  from: AutomationActionStatus;
  to: AutomationActionStatus;
}): boolean {
  if (input.from === input.to) return true;
  return ALLOWED_TRANSITIONS[input.from].has(input.to);
}

export function assertTransitionAutomationStatus(input: {
  from: AutomationActionStatus;
  to: AutomationActionStatus;
}): void {
  if (!canTransitionAutomationStatus(input)) {
    throw new Error(`Invalid automation action status transition: ${input.from} -> ${input.to}`);
  }
}

export function isTerminalAutomationStatus(status: AutomationActionStatus): boolean {
  return status === 'completed' || status === 'dismissed';
}

export function automationStatusSortOrder(status: AutomationActionStatus): number {
  if (status === 'pending_confirm') return 1;
  if (status === 'suggested') return 2;
  if (status === 'attempted') return 3;
  if (status === 'failed') return 4;
  if (status === 'snoozed') return 5;
  if (status === 'detected') return 6;
  if (status === 'completed') return 7;
  return 8;
}
