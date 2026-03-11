export type ActivationStatus = 'PENDING' | 'ACTIVE' | 'FAILED' | 'UNKNOWN';

export type VerificationMethod =
  | 'webhook_confirmation'
  | 'email_receipt_parsing'
  | 'merchant_api_check'
  | 'post_purchase_account_state_check'
  | 'timeout_classification';

export type SettlementRecommendation =
  | 'CAPTURE_SETTLEMENT'
  | 'HOLD_SETTLEMENT'
  | 'VOID_OR_REFUND'
  | 'MANUAL_REVIEW';

export type NextAction =
  | 'CAPTURE_FUNDS'
  | 'WAIT_FOR_SIGNAL'
  | 'VOID_OR_REFUND'
  | 'REQUEST_HUMAN_REVIEW'
  | 'DO_NOT_MARK_TASK_COMPLETE';

export interface ActivationEvidence {
  provider: string;
  method: VerificationMethod;
  status: ActivationStatus;
  observedAt: string;
  summary: string;
  referenceId?: string | null;
  confidence?: number;
  raw?: Record<string, unknown> | null;
}

export interface ActivationVerificationContext {
  paymentId: string;
  userId: string;
  merchant: string;
  taskId?: string | null;
  authorizedAt: string;
  now?: string;
  metadata?: Record<string, unknown> | null;
}

export interface ActivationProbeResult {
  status: ActivationStatus;
  evidence: ActivationEvidence;
}

export interface ActivationVerificationProvider {
  id: string;
  method: VerificationMethod;
  priority?: number;
  supports(context: ActivationVerificationContext): boolean | Promise<boolean>;
  verify(context: ActivationVerificationContext): Promise<ActivationProbeResult>;
}

export interface AccountStateCheckAdapter {
  id: string;
  check(context: ActivationVerificationContext): Promise<{
    status: ActivationStatus;
    observedAt?: string;
    summary: string;
    referenceId?: string | null;
    confidence?: number;
    raw?: Record<string, unknown> | null;
  }>;
}
