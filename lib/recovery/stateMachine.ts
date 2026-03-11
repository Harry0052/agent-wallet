export const RecoveryStates = [
  'wallet_debited',
  'wallet_reserved',
  'external_authorized',
  'external_captured',
  'activation_pending',
  'activation_failed',
  'activation_unverified',
  'reversal_available',
  'refund_available',
  'reversal_completed',
  'refund_requested',
  'refund_in_progress',
  'refund_completed',
  'refund_failed',
  'manual_review_required',
] as const;

export type RecoveryState = typeof RecoveryStates[number];

export const RecoveryTerminalStates: RecoveryState[] = [
  'reversal_completed',
  'refund_completed',
];

const TransitionMap: Record<RecoveryState, RecoveryState[]> = {
  wallet_debited: ['reversal_available', 'reversal_completed', 'manual_review_required'],
  wallet_reserved: ['external_authorized', 'reversal_available', 'reversal_completed', 'manual_review_required'],
  external_authorized: [
    'activation_pending',
    'activation_failed',
    'external_captured',
    'reversal_available',
    'reversal_completed',
    'manual_review_required',
  ],
  external_captured: ['refund_available', 'refund_requested', 'manual_review_required'],
  activation_pending: [
    'activation_failed',
    'activation_unverified',
    'external_captured',
    'reversal_available',
    'manual_review_required',
  ],
  activation_failed: ['reversal_available', 'refund_available', 'reversal_completed', 'refund_requested', 'manual_review_required'],
  activation_unverified: ['reversal_available', 'refund_available', 'reversal_completed', 'refund_requested', 'manual_review_required'],
  reversal_available: ['reversal_completed', 'manual_review_required'],
  refund_available: ['refund_requested', 'refund_in_progress', 'refund_completed', 'manual_review_required'],
  reversal_completed: [],
  refund_requested: ['refund_in_progress', 'refund_completed', 'refund_failed', 'manual_review_required'],
  refund_in_progress: ['refund_completed', 'refund_failed', 'manual_review_required'],
  refund_completed: [],
  refund_failed: ['refund_requested', 'manual_review_required'],
  manual_review_required: [
    'reversal_available',
    'refund_available',
    'refund_requested',
    'refund_in_progress',
    'reversal_completed',
    'refund_completed',
  ],
};

export function isRecoveryState(input: unknown): input is RecoveryState {
  return typeof input === 'string' && (RecoveryStates as readonly string[]).includes(input);
}

export function normalizeRecoveryState(input: unknown): RecoveryState {
  if (isRecoveryState(input)) return input;
  return 'manual_review_required';
}

export function isTerminalRecoveryState(state: RecoveryState): boolean {
  return RecoveryTerminalStates.includes(state);
}

export function canTransitionRecoveryState(from: RecoveryState, to: RecoveryState): boolean {
  if (from === to) return true;
  return TransitionMap[from].includes(to);
}

export function assertValidRecoveryTransition(from: RecoveryState, to: RecoveryState): void {
  if (!canTransitionRecoveryState(from, to)) {
    throw new Error(`INVALID_RECOVERY_TRANSITION: ${from} -> ${to}`);
  }
}
