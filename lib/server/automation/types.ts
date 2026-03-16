import type {
  AutomationActionRecord,
  AutomationActionStatus,
  AutomationActionSummary,
  AutomationActionType,
  AutomationPolicyMode,
} from '../../types';

export type {
  AutomationActionRecord,
  AutomationActionStatus,
  AutomationActionSummary,
  AutomationActionType,
  AutomationPolicyMode,
};

export interface AutomationPolicyConfig {
  defaultMode: AutomationPolicyMode;
  perActionMode: Partial<Record<AutomationActionType, AutomationPolicyMode>>;
  autopilotEnabledActions: Partial<Record<AutomationActionType, boolean>>;
  explicitConfirmEnabledActions: Partial<Record<AutomationActionType, boolean>>;
}

export interface AutomationExplainabilityPayload {
  summary: string;
  factors: string[];
  confidence: number;
  coverageConfidence: number;
}

export interface AutomationDetectionCandidate {
  actionType: AutomationActionType;
  title: string;
  summary: string;
  dedupKey: string;
  confidence: number;
  coverageConfidence: number;
  explainability: AutomationExplainabilityPayload;
  payload: Record<string, unknown>;
  amount: number | null;
  currency: string | null;
  suggestedPolicy?: AutomationPolicyMode;
  detectedAt: string;
}

export interface AutomationTransitionInput {
  actionId: string;
  userId: string;
  toStatus: AutomationActionStatus;
  reason?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationTransitionResult {
  action: AutomationActionRecord;
  idempotentReplay: boolean;
}

export interface AutomationActionAttemptResult {
  action: AutomationActionRecord;
  status: 'attempted' | 'completed' | 'failed' | 'blocked';
  message: string;
  provider: string;
}

export interface AutomationActionEvent {
  id: string;
  userId: string;
  actionId: string;
  eventType:
    | 'detected'
    | 'suggested'
    | 'pending_confirm'
    | 'attempted'
    | 'completed'
    | 'failed'
    | 'dismissed'
    | 'snoozed'
    | 'suppressed'
    | 'policy_changed'
    | 'permission_blocked'
    | 'confirmation_recorded';
  fromStatus: AutomationActionStatus | null;
  toStatus: AutomationActionStatus | null;
  reason: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AutomationDetectionInput {
  userId: string;
  nowIso?: string;
}

export interface AutomationDetectionResult {
  detected: number;
  suppressed: number;
  candidates: AutomationDetectionCandidate[];
  actions: AutomationActionRecord[];
  suppressionReasons: Array<{ dedupKey: string; reason: string }>;
}

export interface AutomationDetectionContext {
  nowIso: string;
  transactionCoverageDays: number;
  connectedAccountCount: number;
  staleAccountCount: number;
  lowData: boolean;
  currency: string;
}

export interface AutomationExecutionPolicyDecision {
  mode: AutomationPolicyMode;
  requiresConfirmation: boolean;
  autopilotAllowed: boolean;
  reason: string;
}

export interface AutomationStoreActionRow {
  id: string;
  user_id: string;
  task_id: string;
  action_type: AutomationActionType;
  policy_mode: AutomationPolicyMode;
  status: AutomationActionStatus;
  title: string;
  summary: string;
  dedup_key: string;
  confidence: string;
  coverage_confidence: string;
  explainability: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  amount: string | null;
  currency: string | null;
  requires_explicit_confirmation: boolean;
  cooldown_until: string | null;
  snoozed_until: string | null;
  last_error: string | null;
  attempted_at: string | null;
  completed_at: string | null;
  dismissed_at: string | null;
  detected_at: string;
  created_at: string;
  updated_at: string;
}

export const MONEY_MOVEMENT_ACTIONS: ReadonlySet<AutomationActionType> = new Set([
  'bill_pay',
  'savings_transfer',
  'debt_optimize',
  'refund_budget',
]);

export const DESTRUCTIVE_ACTIONS: ReadonlySet<AutomationActionType> = new Set([
  'subscription_cancel',
  'subscription_negotiate',
  'bill_pay',
  'debt_optimize',
]);

export const AUTOMATION_ENGINE_VERSION = '1.0.0';
export const AUTOMATION_RULES_VERSION = '1.0.0';

export const DEFAULT_AUTOMATION_POLICY_CONFIG: AutomationPolicyConfig = {
  defaultMode: 'user_confirm_required',
  perActionMode: {},
  autopilotEnabledActions: {},
  explicitConfirmEnabledActions: {},
};
