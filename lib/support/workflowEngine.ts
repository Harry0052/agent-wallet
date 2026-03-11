import { z } from 'zod';
import {
  FailureSource,
  WalletFailureCode,
  type FailureRecord,
} from '../failures/codes.ts';
import { mapErrorToFailure, type MappedFailure } from '../failures/mapError.ts';
import { getFailurePolicy, RefundAction, RetryStrategy } from '../failures/policies.ts';
import {
  generateDisputeEvidenceObject,
  type DisputeBenefitCheck,
  type DisputeEvidenceObject,
  type DisputeOrchestrationLog,
  type DisputePaymentStatus,
  type DisputeProvisioningCheck,
  type DisputeReturnedError,
  type DisputeRetryAttempt,
  type DisputeScreenshot,
} from '../disputes/evidence.ts';
import { buildDisputeSupportEmailTemplate } from '../disputes/emailTemplate.ts';
import {
  applySupportWorkflowTransition,
  createSupportWorkflowSnapshot,
  type SupportWorkflowSnapshot,
} from './stateMachine.ts';
import { renderSupportPromptTemplate } from './promptTemplates.ts';

export type SupportNextAction = 'RETRY' | 'REFUND' | 'DISPUTE' | 'MANUAL_REVIEW' | 'WAIT';

export interface SupportWorkflowLogger {
  info(event: string, payload: Record<string, unknown>): void;
  warn(event: string, payload: Record<string, unknown>): void;
  error(event: string, payload: Record<string, unknown>): void;
}

export interface SupportExecutionResult {
  executed: boolean;
  action: SupportNextAction;
  referenceId?: string;
  message?: string;
}

export interface SupportEvidenceBundle {
  logs: DisputeOrchestrationLog[];
  screenshots: DisputeScreenshot[];
  returnedErrors: DisputeReturnedError[];
  retryAttempts: DisputeRetryAttempt[];
  provisioningChecks: DisputeProvisioningCheck[];
  benefitChecks: DisputeBenefitCheck[];
  merchantRefundSupported: boolean | null;
  userStatement?: string;
}

export interface SupportWorkflowDeps {
  fetchLogs(input: {
    userId: string;
    paymentFlowId: string;
    taskId?: string | null;
  }): Promise<DisputeOrchestrationLog[]>;
  fetchEvidence(input: {
    userId: string;
    paymentFlowId: string;
    taskId?: string | null;
  }): Promise<Partial<SupportEvidenceBundle>>;
  executeRetry?(input: {
    userId: string;
    paymentFlowId: string;
    failure: MappedFailure;
  }): Promise<SupportExecutionResult>;
  executeRefund?(input: {
    userId: string;
    paymentFlowId: string;
    failure: MappedFailure;
  }): Promise<SupportExecutionResult>;
  executeDispute?(input: {
    userId: string;
    paymentFlowId: string;
    failure: MappedFailure;
    evidence: DisputeEvidenceObject;
  }): Promise<SupportExecutionResult>;
  logger?: SupportWorkflowLogger;
}

export const SupportWorkflowInputSchema = z.object({
  userId: z.string().min(1),
  paymentFlowId: z.string().min(1),
  taskId: z.string().trim().optional(),
  transactionId: z.string().min(1),
  merchantName: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().trim().min(3).max(3),
  message: z.string().trim().optional(),
  stage: z.string().trim().optional(),
  httpStatus: z.number().int().optional(),
  source: z.nativeEnum(FailureSource).default(FailureSource.ORCHESTRATION),
  paymentStatus: z.enum(['succeeded', 'captured', 'refunded', 'failed', 'unknown']),
  activationStatus: z.enum(['PENDING', 'ACTIVE', 'FAILED', 'UNKNOWN']),
  metadata: z.record(z.unknown()).optional(),
  executeActions: z.boolean().default(false),
});

export type SupportWorkflowInput = z.infer<typeof SupportWorkflowInputSchema>;

export interface SupportActionDecision {
  nextAction: SupportNextAction;
  reasoning: string[];
  requiresHumanReview: boolean;
}

export interface SupportWorkflowResult {
  workflow: SupportWorkflowSnapshot;
  classification: MappedFailure;
  policy: ReturnType<typeof getFailurePolicy>;
  evidence: SupportEvidenceBundle;
  actionDecision: SupportActionDecision;
  userFacingExplanation: string;
  merchantSupportMessage: string;
  processorDisputeSummary: string;
  processorDisputeEvidence: DisputeEvidenceObject | null;
  executedAction: SupportExecutionResult;
}

function nowIso(): string {
  return new Date().toISOString();
}

function fallbackLogger(): SupportWorkflowLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function toDisputePaymentStatus(input: SupportWorkflowInput['paymentStatus']): DisputePaymentStatus {
  return input;
}

function buildEvidenceSummary(bundle: SupportEvidenceBundle): string {
  const parts = [
    `${bundle.logs.length} orchestration logs`,
    `${bundle.returnedErrors.length} returned errors`,
    `${bundle.retryAttempts.length} retry attempts`,
    `${bundle.provisioningChecks.length} provisioning checks`,
    `${bundle.benefitChecks.length} benefit checks`,
  ];
  return parts.join(', ');
}

function classify(
  input: SupportWorkflowInput,
): MappedFailure {
  return mapErrorToFailure({
    message: input.message,
    source: input.source,
    merchant: input.merchantName,
    httpStatus: input.httpStatus,
    stage: input.stage,
    paymentStatus: input.paymentStatus,
    activationStatus: input.activationStatus,
    metadata: input.metadata,
  });
}

function normalizeEvidence(
  input: SupportWorkflowInput,
  partial: Partial<SupportEvidenceBundle>,
): SupportEvidenceBundle {
  return {
    logs: partial.logs || [],
    screenshots: partial.screenshots || [],
    returnedErrors: partial.returnedErrors || [],
    retryAttempts: partial.retryAttempts || [],
    provisioningChecks: partial.provisioningChecks || [],
    benefitChecks: partial.benefitChecks || [],
    merchantRefundSupported: typeof partial.merchantRefundSupported === 'boolean'
      ? partial.merchantRefundSupported
      : null,
    userStatement: partial.userStatement || `I was charged by ${input.merchantName} but did not receive the service.`,
  };
}

function decideNextAction(input: {
  workflowInput: SupportWorkflowInput;
  failure: MappedFailure;
  policy: ReturnType<typeof getFailurePolicy>;
  evidence: SupportEvidenceBundle;
}): SupportActionDecision {
  const { workflowInput, failure, policy, evidence } = input;

  const reasoning: string[] = [];
  const capturedButUndelivered = (
    (workflowInput.paymentStatus === 'captured' || workflowInput.paymentStatus === 'succeeded')
    && workflowInput.activationStatus !== 'ACTIVE'
  );

  if (capturedButUndelivered) {
    reasoning.push('Payment is captured/succeeded while activation is not active.');
  }

  if (capturedButUndelivered && failure.code === WalletFailureCode.PAYMENT_CAPTURED_ACTIVATION_FAILED) {
    if (evidence.merchantRefundSupported === false) {
      reasoning.push('Merchant-side refund path is unavailable; dispute preparation is safer.');
      return {
        nextAction: 'DISPUTE',
        reasoning,
        requiresHumanReview: false,
      };
    }

    reasoning.push('Automatic refund policy is enabled for captured activation failure.');
    return {
      nextAction: 'REFUND',
      reasoning,
      requiresHumanReview: false,
    };
  }

  if (capturedButUndelivered && failure.code === WalletFailureCode.ACTIVATION_UNVERIFIED) {
    if (policy.retry.strategy !== RetryStrategy.NONE && policy.retry.maxAttempts > evidence.retryAttempts.length) {
      reasoning.push('Activation is unverified and retry budget remains; perform controlled retry.');
      return {
        nextAction: 'RETRY',
        reasoning,
        requiresHumanReview: false,
      };
    }

    reasoning.push('Activation remains unverified after retry budget; escalate to manual review.');
    return {
      nextAction: 'MANUAL_REVIEW',
      reasoning,
      requiresHumanReview: true,
    };
  }

  if (policy.refund.action === RefundAction.AUTO_REFUND) {
    reasoning.push('Failure policy mandates automatic refund path.');
    return {
      nextAction: 'REFUND',
      reasoning,
      requiresHumanReview: false,
    };
  }

  if (policy.refund.action === RefundAction.PREPARE_DISPUTE_PACKET) {
    reasoning.push('Failure policy requires dispute packet preparation.');
    return {
      nextAction: 'DISPUTE',
      reasoning,
      requiresHumanReview: false,
    };
  }

  if (
    policy.retry.strategy !== RetryStrategy.NONE
    && policy.retry.strategy !== RetryStrategy.MANUAL_ONLY
    && policy.retry.maxAttempts > evidence.retryAttempts.length
  ) {
    reasoning.push('Retry policy allows additional automatic attempts.');
    return {
      nextAction: 'RETRY',
      reasoning,
      requiresHumanReview: false,
    };
  }

  if (policy.retry.strategy === RetryStrategy.MANUAL_ONLY || policy.retry.requiresHumanApprovalAfterExhaustion) {
    reasoning.push('Policy requires human-assisted handling for this failure type.');
    return {
      nextAction: 'MANUAL_REVIEW',
      reasoning,
      requiresHumanReview: true,
    };
  }

  reasoning.push('No safe automatic action available; hold and wait for additional evidence.');
  return {
    nextAction: 'WAIT',
    reasoning,
    requiresHumanReview: true,
  };
}

function buildUserFacingExplanation(input: {
  workflowInput: SupportWorkflowInput;
  failure: FailureRecord;
  action: SupportActionDecision;
}): string {
  return renderSupportPromptTemplate('USER_EXPLANATION', {
    merchantName: input.workflowInput.merchantName,
    paymentStatus: input.workflowInput.paymentStatus,
    activationStatus: input.workflowInput.activationStatus,
    failureTitle: input.failure.userMessage,
    nextAction: input.action.nextAction.replace('_', ' ').toLowerCase(),
    additionalContext: input.action.requiresHumanReview
      ? 'A support specialist may review this case before final resolution.'
      : 'We are handling this automatically using approved support and payment workflows.',
  });
}

function buildMerchantSupportMessage(input: {
  workflowInput: SupportWorkflowInput;
  failure: FailureRecord;
  action: SupportActionDecision;
  evidenceSummary: string;
}): string {
  return renderSupportPromptTemplate('MERCHANT_SUPPORT_MESSAGE', {
    merchantName: input.workflowInput.merchantName,
    transactionId: input.workflowInput.transactionId,
    amount: input.workflowInput.amount.toFixed(2),
    currency: input.workflowInput.currency.toUpperCase(),
    paymentStatus: input.workflowInput.paymentStatus,
    activationStatus: input.workflowInput.activationStatus,
    failureTitle: input.failure.message,
    nextAction: input.action.nextAction,
    evidenceSummary: input.evidenceSummary,
  });
}

function buildProcessorDisputeSummary(input: {
  workflowInput: SupportWorkflowInput;
  failure: MappedFailure;
  disputeEvidence: DisputeEvidenceObject | null;
  evidenceSummary: string;
}): string {
  const recommendation = input.disputeEvidence
    ? input.disputeEvidence.complianceSummary.recommendation
    : 'needs_manual_review';

  const nonProvisioningProof = input.disputeEvidence
    ? (input.disputeEvidence.proofs.serviceNeverProvisioned.satisfied ? 'satisfied' : 'not_satisfied')
    : 'unknown';
  const noBenefitProof = input.disputeEvidence
    ? (input.disputeEvidence.proofs.userDidNotReceiveBenefit.satisfied ? 'satisfied' : 'not_satisfied')
    : 'unknown';

  return renderSupportPromptTemplate('PROCESSOR_DISPUTE_SUMMARY', {
    transactionId: input.workflowInput.transactionId,
    merchantName: input.workflowInput.merchantName,
    amount: input.workflowInput.amount.toFixed(2),
    currency: input.workflowInput.currency.toUpperCase(),
    paymentStatus: input.workflowInput.paymentStatus,
    activationStatus: input.workflowInput.activationStatus,
    failureCode: input.failure.code,
    recommendation,
    nonProvisioningProof,
    noBenefitProof,
    evidenceSummary: input.evidenceSummary,
  });
}

function buildDisputeEvidence(
  input: SupportWorkflowInput,
  evidence: SupportEvidenceBundle,
): DisputeEvidenceObject {
  return generateDisputeEvidenceObject({
    transactionId: input.transactionId,
    merchantName: input.merchantName,
    amount: input.amount,
    currency: input.currency,
    paymentStatus: toDisputePaymentStatus(input.paymentStatus),
    activationStatus: input.activationStatus,
    timestamps: {
      capturedAt: typeof input.metadata?.capturedAt === 'string' ? input.metadata.capturedAt : null,
      authorizedAt: typeof input.metadata?.authorizedAt === 'string' ? input.metadata.authorizedAt : null,
      activationCheckedAt: nowIso(),
      disputePreparedAt: nowIso(),
    },
    orchestrationLogs: evidence.logs,
    screenshots: evidence.screenshots,
    returnedErrors: evidence.returnedErrors,
    retryAttempts: evidence.retryAttempts,
    provisioningChecks: evidence.provisioningChecks,
    benefitChecks: evidence.benefitChecks,
    userStatement: evidence.userStatement,
  });
}

async function runAction(
  action: SupportActionDecision,
  deps: SupportWorkflowDeps,
  input: SupportWorkflowInput,
  failure: MappedFailure,
  disputeEvidence: DisputeEvidenceObject | null,
): Promise<SupportExecutionResult> {
  if (!input.executeActions) {
    return {
      executed: false,
      action: action.nextAction,
      message: 'Prepared next action without executing side effects.',
    };
  }

  if (action.nextAction === 'RETRY' && deps.executeRetry) {
    return deps.executeRetry({
      userId: input.userId,
      paymentFlowId: input.paymentFlowId,
      failure,
    });
  }

  if (action.nextAction === 'REFUND' && deps.executeRefund) {
    return deps.executeRefund({
      userId: input.userId,
      paymentFlowId: input.paymentFlowId,
      failure,
    });
  }

  if (action.nextAction === 'DISPUTE' && deps.executeDispute && disputeEvidence) {
    return deps.executeDispute({
      userId: input.userId,
      paymentFlowId: input.paymentFlowId,
      failure,
      evidence: disputeEvidence,
    });
  }

  return {
    executed: false,
    action: action.nextAction,
    message: `No execution handler configured for ${action.nextAction}.`,
  };
}

export function createSupportWorkflowEngine(deps: SupportWorkflowDeps) {
  const logger = deps.logger || fallbackLogger();

  async function run(inputRaw: SupportWorkflowInput): Promise<SupportWorkflowResult> {
    const input = SupportWorkflowInputSchema.parse(inputRaw);
    let workflow = createSupportWorkflowSnapshot();

    try {
      logger.info('support.workflow.received', {
        userId: input.userId,
        paymentFlowId: input.paymentFlowId,
        transactionId: input.transactionId,
      });

      const classification = classify(input);
      const policy = getFailurePolicy(classification.code);
      workflow = applySupportWorkflowTransition(
        workflow,
        'FAILURE_CLASSIFIED',
        'Failure classified using taxonomy engine',
        {
          code: classification.code,
          confidence: classification.confidence,
        },
      );

      const [logs, rawEvidence] = await Promise.all([
        deps.fetchLogs({
          userId: input.userId,
          paymentFlowId: input.paymentFlowId,
          taskId: input.taskId,
        }),
        deps.fetchEvidence({
          userId: input.userId,
          paymentFlowId: input.paymentFlowId,
          taskId: input.taskId,
        }),
      ]);

      const evidence = normalizeEvidence(input, {
        ...rawEvidence,
        logs,
      });

      workflow = applySupportWorkflowTransition(
        workflow,
        'EVIDENCE_COLLECTED',
        'Fetched logs and evidence artifacts',
        {
          logCount: evidence.logs.length,
          errorCount: evidence.returnedErrors.length,
        },
      );

      const actionDecision = decideNextAction({
        workflowInput: input,
        failure: classification,
        policy,
        evidence,
      });

      workflow = applySupportWorkflowTransition(
        workflow,
        'ACTION_DECIDED',
        'Selected next best support action',
        {
          nextAction: actionDecision.nextAction,
        },
      );

      const evidenceSummary = buildEvidenceSummary(evidence);
      const disputeEvidence = actionDecision.nextAction === 'DISPUTE'
        ? buildDisputeEvidence(input, evidence)
        : null;

      const userFacingExplanation = buildUserFacingExplanation({
        workflowInput: input,
        failure: classification,
        action: actionDecision,
      });

      const merchantSupportMessage = buildMerchantSupportMessage({
        workflowInput: input,
        failure: classification,
        action: actionDecision,
        evidenceSummary,
      });

      const processorDisputeSummary = buildProcessorDisputeSummary({
        workflowInput: input,
        failure: classification,
        disputeEvidence,
        evidenceSummary,
      });

      workflow = applySupportWorkflowTransition(
        workflow,
        'RESPONSES_GENERATED',
        'Generated user, merchant, and processor messages',
      );

      const executedAction = await runAction(
        actionDecision,
        deps,
        input,
        classification,
        disputeEvidence,
      );

      if (executedAction.executed) {
        workflow = applySupportWorkflowTransition(
          workflow,
          'ACTION_EXECUTED',
          `Executed ${executedAction.action} action`,
          {
            referenceId: executedAction.referenceId || null,
          },
        );
      }

      workflow = applySupportWorkflowTransition(
        workflow,
        'COMPLETED',
        'Support workflow completed successfully',
      );

      logger.info('support.workflow.completed', {
        userId: input.userId,
        paymentFlowId: input.paymentFlowId,
        code: classification.code,
        nextAction: actionDecision.nextAction,
        executed: executedAction.executed,
      });

      return {
        workflow,
        classification,
        policy,
        evidence,
        actionDecision,
        userFacingExplanation,
        merchantSupportMessage,
        processorDisputeSummary,
        processorDisputeEvidence: disputeEvidence,
        executedAction,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('support.workflow.failed', {
        userId: input.userId,
        paymentFlowId: input.paymentFlowId,
        message,
      });

      if (workflow.state !== 'FAILED') {
        try {
          workflow = applySupportWorkflowTransition(workflow, 'FAILED', message);
        } catch {
          workflow = {
            ...workflow,
            state: 'FAILED',
          };
        }
      }

      throw error;
    }
  }

  return {
    run,
  };
}

export function buildProcessorDisputeEmailPreview(
  evidence: DisputeEvidenceObject,
): { subject: string; body: string } {
  return buildDisputeSupportEmailTemplate(evidence);
}
