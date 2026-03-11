export type DisputePaymentStatus =
  | 'succeeded'
  | 'captured'
  | 'refunded'
  | 'failed'
  | 'unknown';

export type DisputeActivationStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'FAILED'
  | 'UNKNOWN';

export interface DisputeOrchestrationLog {
  at: string;
  stage: string;
  status: 'info' | 'warning' | 'error';
  message: string;
  metadata?: Record<string, unknown> | null;
}

export interface DisputeScreenshot {
  label: string;
  capturedAt: string;
  url?: string;
  path?: string;
  note?: string;
}

export interface DisputeReturnedError {
  source: string;
  message: string;
  at?: string;
  code?: string;
}

export interface DisputeRetryAttempt {
  attempt: number;
  at: string;
  outcome: 'retrying' | 'failed' | 'succeeded';
  reason?: string;
}

export interface DisputeProvisioningCheck {
  check: string;
  result: 'not_provisioned' | 'provisioned' | 'unknown';
  observedAt: string;
  details?: string;
}

export interface DisputeBenefitCheck {
  check: string;
  result: 'no_benefit' | 'benefit_detected' | 'unknown';
  observedAt: string;
  details?: string;
}

export interface DisputeEvidenceInput {
  transactionId: string;
  merchantName: string;
  amount: number;
  currency: string;
  paymentStatus: DisputePaymentStatus;
  activationStatus: DisputeActivationStatus;
  timestamps: {
    authorizedAt?: string | null;
    capturedAt?: string | null;
    activationCheckedAt?: string | null;
    disputePreparedAt?: string | null;
  };
  orchestrationLogs: DisputeOrchestrationLog[];
  screenshots: DisputeScreenshot[];
  returnedErrors: DisputeReturnedError[];
  retryAttempts: DisputeRetryAttempt[];
  provisioningChecks: DisputeProvisioningCheck[];
  benefitChecks: DisputeBenefitCheck[];
  userStatement?: string;
}

export interface DisputeEvidenceObject {
  evidenceVersion: 'dispute-evidence-v1';
  generatedAt: string;
  transaction: {
    id: string;
    merchantName: string;
    amount: number;
    currency: string;
    paymentStatus: DisputePaymentStatus;
    activationStatus: DisputeActivationStatus;
    timestamps: DisputeEvidenceInput['timestamps'];
  };
  orchestrationLogs: DisputeOrchestrationLog[];
  screenshots: DisputeScreenshot[];
  returnedErrors: DisputeReturnedError[];
  retryAttempts: DisputeRetryAttempt[];
  proofs: {
    serviceNeverProvisioned: {
      satisfied: boolean;
      supportingChecks: DisputeProvisioningCheck[];
      contradictoryChecks: DisputeProvisioningCheck[];
      statement: string;
    };
    userDidNotReceiveBenefit: {
      satisfied: boolean;
      supportingChecks: DisputeBenefitCheck[];
      contradictoryChecks: DisputeBenefitCheck[];
      statement: string;
    };
  };
  complianceSummary: {
    recommendation: 'submit_dispute' | 'needs_manual_review' | 'do_not_submit';
    confidence: 'high' | 'medium' | 'low';
    rationale: string;
  };
  userStatement: string;
}

function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase() || 'USD';
}

function assertIso(label: string, value: string | null | undefined): void {
  if (!value) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid timestamp for ${label}: ${value}`);
  }
}

function assertInput(input: DisputeEvidenceInput): void {
  if (!input.transactionId.trim()) throw new Error('transactionId is required');
  if (!input.merchantName.trim()) throw new Error('merchantName is required');
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('amount must be a positive number');
  }
  assertIso('authorizedAt', input.timestamps.authorizedAt);
  assertIso('capturedAt', input.timestamps.capturedAt);
  assertIso('activationCheckedAt', input.timestamps.activationCheckedAt);
  assertIso('disputePreparedAt', input.timestamps.disputePreparedAt);
  input.orchestrationLogs.forEach((log, idx) => assertIso(`orchestrationLogs[${idx}].at`, log.at));
  input.screenshots.forEach((shot, idx) => assertIso(`screenshots[${idx}].capturedAt`, shot.capturedAt));
  input.retryAttempts.forEach((retry, idx) => assertIso(`retryAttempts[${idx}].at`, retry.at));
  input.provisioningChecks.forEach((check, idx) => assertIso(`provisioningChecks[${idx}].observedAt`, check.observedAt));
  input.benefitChecks.forEach((check, idx) => assertIso(`benefitChecks[${idx}].observedAt`, check.observedAt));
}

function evaluateProvisioningProof(checks: DisputeProvisioningCheck[]): {
  satisfied: boolean;
  supportingChecks: DisputeProvisioningCheck[];
  contradictoryChecks: DisputeProvisioningCheck[];
  statement: string;
} {
  const supportingChecks = checks.filter((item) => item.result === 'not_provisioned');
  const contradictoryChecks = checks.filter((item) => item.result === 'provisioned');
  const satisfied = supportingChecks.length > 0 && contradictoryChecks.length === 0;

  return {
    satisfied,
    supportingChecks,
    contradictoryChecks,
    statement: satisfied
      ? 'All observed provisioning checks indicate the service was never provisioned.'
      : 'Provisioning evidence is mixed or insufficient; manual review is required.',
  };
}

function evaluateBenefitProof(checks: DisputeBenefitCheck[]): {
  satisfied: boolean;
  supportingChecks: DisputeBenefitCheck[];
  contradictoryChecks: DisputeBenefitCheck[];
  statement: string;
} {
  const supportingChecks = checks.filter((item) => item.result === 'no_benefit');
  const contradictoryChecks = checks.filter((item) => item.result === 'benefit_detected');
  const satisfied = supportingChecks.length > 0 && contradictoryChecks.length === 0;

  return {
    satisfied,
    supportingChecks,
    contradictoryChecks,
    statement: satisfied
      ? 'All benefit checks indicate the user did not receive service value.'
      : 'Benefit evidence is mixed or insufficient; manual review is required.',
  };
}

function summarizeCompliance(input: {
  paymentStatus: DisputePaymentStatus;
  activationStatus: DisputeActivationStatus;
  provisioningSatisfied: boolean;
  benefitSatisfied: boolean;
}): DisputeEvidenceObject['complianceSummary'] {
  const chargeSucceeded = input.paymentStatus === 'succeeded' || input.paymentStatus === 'captured';
  const activationFailed = input.activationStatus === 'FAILED';
  const strongProof = input.provisioningSatisfied && input.benefitSatisfied;

  if (chargeSucceeded && activationFailed && strongProof) {
    return {
      recommendation: 'submit_dispute',
      confidence: 'high',
      rationale: 'Payment succeeded, activation failed, and both non-provisioning and no-benefit proofs are satisfied.',
    };
  }

  if (!chargeSucceeded) {
    return {
      recommendation: 'do_not_submit',
      confidence: 'high',
      rationale: 'Charge was not captured/succeeded; dispute packet is unnecessary.',
    };
  }

  if (input.activationStatus === 'ACTIVE') {
    return {
      recommendation: 'do_not_submit',
      confidence: 'high',
      rationale: 'Activation evidence indicates service is active.',
    };
  }

  return {
    recommendation: 'needs_manual_review',
    confidence: 'medium',
    rationale: 'Charge succeeded but evidence is incomplete or contradictory for automated dispute submission.',
  };
}

export function generateDisputeEvidenceObject(input: DisputeEvidenceInput): DisputeEvidenceObject {
  assertInput(input);
  const now = new Date().toISOString();
  const provisioningProof = evaluateProvisioningProof(input.provisioningChecks);
  const benefitProof = evaluateBenefitProof(input.benefitChecks);
  const complianceSummary = summarizeCompliance({
    paymentStatus: input.paymentStatus,
    activationStatus: input.activationStatus,
    provisioningSatisfied: provisioningProof.satisfied,
    benefitSatisfied: benefitProof.satisfied,
  });

  return {
    evidenceVersion: 'dispute-evidence-v1',
    generatedAt: now,
    transaction: {
      id: input.transactionId.trim(),
      merchantName: input.merchantName.trim(),
      amount: Math.round(input.amount * 100) / 100,
      currency: normalizeCurrency(input.currency),
      paymentStatus: input.paymentStatus,
      activationStatus: input.activationStatus,
      timestamps: input.timestamps,
    },
    orchestrationLogs: [...input.orchestrationLogs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    screenshots: [...input.screenshots].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)),
    returnedErrors: input.returnedErrors,
    retryAttempts: [...input.retryAttempts].sort((a, b) => a.attempt - b.attempt),
    proofs: {
      serviceNeverProvisioned: provisioningProof,
      userDidNotReceiveBenefit: benefitProof,
    },
    complianceSummary,
    userStatement: (input.userStatement || '').trim()
      || `I was charged by ${input.merchantName.trim()} but never received the purchased service.`,
  };
}
