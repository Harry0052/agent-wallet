import type { AutomationActionType } from '@/lib/types';

// ── Provider-Agnostic Execution Types ───────────────────────────────────────
// These types decouple Agent Wallet's automation system from any specific
// execution provider (Tiny Fish, browser automation, RPA, etc.).

export type ExecutionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ExecutionStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'waiting_input'       // login, OTP, 2FA, CAPTCHA
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unsupported';

export type FailureReason =
  | 'unsupported_action'
  | 'unsupported_service'
  | 'login_failed'
  | 'otp_expired'
  | 'otp_required'
  | 'captcha_required'
  | 'site_changed'
  | 'action_blocked'
  | 'partial_success'
  | 'timeout'
  | 'rate_limited'
  | 'credentials_missing'
  | 'provider_error'
  | 'unknown';

export interface ExecutionStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ExecutionEvidence {
  type: 'screenshot' | 'confirmation_number' | 'email_reference' | 'text_summary';
  label: string;
  value: string;
  capturedAt: string;
}

/** Provider-agnostic task payload sent to any execution provider */
export interface ExecutionTaskPayload {
  taskId: string;
  userId: string;
  actionType: AutomationActionType;
  targetService: string;
  intent: string;
  originalPrompt: string;
  parameters: Record<string, unknown>;
  riskLevel: ExecutionRiskLevel;
  requiresApproval: boolean;
  idempotencyKey: string;
  createdAt: string;
}

/** Provider-agnostic result returned from any execution provider */
export interface ExecutionTaskResult {
  taskId: string;
  providerTaskId: string | null;
  provider: string;
  status: ExecutionStatus;
  failureReason?: FailureReason;
  steps: ExecutionStep[];
  outcome: string;
  evidence: ExecutionEvidence[];
  nextSteps: string[];
  metadata: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
}

/** What the provider needs from the user to continue */
export interface ExecutionInputRequest {
  taskId: string;
  inputType: 'otp' | '2fa' | 'password' | 'captcha' | 'confirmation' | 'selection';
  prompt: string;
  expiresAt?: string;
}

// ── Supported Action Registry ───────────────────────────────────────────────

export interface SupportedActionDefinition {
  actionType: AutomationActionType;
  label: string;
  description: string;
  riskLevel: ExecutionRiskLevel;
  requiresCredentials: boolean;
  supportedServices: string[] | 'all';
  /** Whether this action is currently wired to a real provider */
  live: boolean;
}

export const SUPPORTED_ACTIONS: SupportedActionDefinition[] = [
  {
    actionType: 'subscription_cancel',
    label: 'Cancel subscription',
    description: 'Cancel an active subscription or recurring charge',
    riskLevel: 'high',
    requiresCredentials: true,
    supportedServices: 'all',
    live: true,
  },
  {
    actionType: 'subscription_negotiate',
    label: 'Lower bill / negotiate',
    description: 'Contact the service to negotiate a lower rate or apply a retention offer',
    riskLevel: 'medium',
    requiresCredentials: true,
    supportedServices: 'all',
    live: true,
  },
  {
    actionType: 'recurring_review',
    label: 'Review recurring charge',
    description: 'Investigate a recurring charge and surface options (cancel, downgrade, keep)',
    riskLevel: 'low',
    requiresCredentials: false,
    supportedServices: 'all',
    live: true,
  },
  {
    actionType: 'expense_categorization',
    label: 'Fix transaction category',
    description: 'Correct the category of a miscategorized transaction',
    riskLevel: 'low',
    requiresCredentials: false,
    supportedServices: 'all',
    live: true,
  },
  {
    actionType: 'trial_conversion_review',
    label: 'Free trial review',
    description: 'Check if a free trial is about to convert and suggest cancellation if unwanted',
    riskLevel: 'medium',
    requiresCredentials: true,
    supportedServices: 'all',
    live: true,
  },
  {
    actionType: 'savings_transfer',
    label: 'Move to savings',
    description: 'Transfer a safe amount to savings based on current affordability',
    riskLevel: 'high',
    requiresCredentials: true,
    supportedServices: 'all',
    live: true,
  },
  {
    actionType: 'bill_pay',
    label: 'Pay bill',
    description: 'Pay an upcoming or overdue bill',
    riskLevel: 'critical',
    requiresCredentials: true,
    supportedServices: 'all',
    live: true,
  },
  {
    actionType: 'debt_optimize',
    label: 'Optimize debt payment',
    description: 'Reallocate debt payments for faster payoff (avalanche/snowball)',
    riskLevel: 'high',
    requiresCredentials: true,
    supportedServices: 'all',
    live: true,
  },
  {
    actionType: 'bill_split',
    label: 'Split expense',
    description: 'Split a shared expense with another person',
    riskLevel: 'medium',
    requiresCredentials: false,
    supportedServices: 'all',
    live: false, // stub: requires payment rail
  },
  {
    actionType: 'refund_budget',
    label: 'Budget refund',
    description: 'Reallocate a refund back into budget categories',
    riskLevel: 'low',
    requiresCredentials: false,
    supportedServices: 'all',
    live: true,
  },
];

export function getSupportedAction(actionType: AutomationActionType): SupportedActionDefinition | undefined {
  return SUPPORTED_ACTIONS.find((a) => a.actionType === actionType);
}

export function isActionLive(actionType: AutomationActionType): boolean {
  return getSupportedAction(actionType)?.live ?? false;
}
