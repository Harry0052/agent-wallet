import assert from 'node:assert/strict';
import test from 'node:test';
import { FailureSource } from '../lib/failures/codes.ts';
import {
  buildProcessorDisputeEmailPreview,
  createSupportWorkflowEngine,
} from '../lib/support/workflowEngine.ts';

function makeBaseInput() {
  return {
    userId: 'user_1',
    paymentFlowId: 'flow_1',
    taskId: 'task_1',
    transactionId: 'txn_1',
    merchantName: 'Netflix',
    amount: 7.99,
    currency: 'USD',
    message: 'Payment captured but service not provisioned',
    stage: 'activation',
    source: FailureSource.ORCHESTRATION as const,
    paymentStatus: 'captured' as const,
    activationStatus: 'FAILED' as const,
    metadata: {
      capturedAt: '2026-03-10T19:00:00.000Z',
      authorizedAt: '2026-03-10T18:58:00.000Z',
    },
    executeActions: false,
  };
}

function makeDeps(overrides?: Partial<Parameters<typeof createSupportWorkflowEngine>[0]>) {
  return {
    async fetchLogs() {
      return [
        {
          at: '2026-03-10T19:01:00.000Z',
          stage: 'activation_check',
          status: 'error' as const,
          message: 'Activation check returned no entitlement.',
        },
      ];
    },
    async fetchEvidence() {
      return {
        returnedErrors: [
          {
            source: 'merchant',
            message: 'No subscription entitlement found',
            at: '2026-03-10T19:01:00.000Z',
          },
        ],
        retryAttempts: [
          {
            attempt: 1,
            at: '2026-03-10T19:00:30.000Z',
            outcome: 'failed' as const,
            reason: 'entitlement not found',
          },
        ],
        provisioningChecks: [
          {
            check: 'subscription_entitlement',
            result: 'not_provisioned' as const,
            observedAt: '2026-03-10T19:01:00.000Z',
            details: 'No active plan on account',
          },
        ],
        benefitChecks: [
          {
            check: 'account_feature_access',
            result: 'no_benefit' as const,
            observedAt: '2026-03-10T19:01:10.000Z',
            details: 'Premium features unavailable',
          },
        ],
        merchantRefundSupported: true,
      };
    },
    ...overrides,
  };
}

test('classifies captured-not-delivered case and recommends refund', async () => {
  const engine = createSupportWorkflowEngine(makeDeps());
  const result = await engine.run(makeBaseInput());

  assert.equal(result.classification.code, 'payment_captured_activation_failed');
  assert.equal(result.actionDecision.nextAction, 'REFUND');
  assert.equal(result.workflow.state, 'COMPLETED');
  assert.equal(result.executedAction.executed, false);
  assert.match(result.userFacingExplanation, /identified an issue/i);
  assert.match(result.merchantSupportMessage, /does not request bypassing verification controls/i);
  assert.equal(result.processorDisputeEvidence, null);
});

test('falls back to dispute when merchant refund path is unavailable', async () => {
  const engine = createSupportWorkflowEngine(makeDeps({
    async fetchEvidence() {
      return {
        returnedErrors: [
          {
            source: 'merchant',
            message: 'No entitlement found',
          },
        ],
        retryAttempts: [],
        provisioningChecks: [
          {
            check: 'entitlement',
            result: 'not_provisioned' as const,
            observedAt: '2026-03-10T19:05:00.000Z',
          },
        ],
        benefitChecks: [
          {
            check: 'benefit',
            result: 'no_benefit' as const,
            observedAt: '2026-03-10T19:05:10.000Z',
          },
        ],
        merchantRefundSupported: false,
      };
    },
  }));

  const result = await engine.run(makeBaseInput());

  assert.equal(result.actionDecision.nextAction, 'DISPUTE');
  assert.ok(result.processorDisputeEvidence);
  assert.equal(result.processorDisputeEvidence?.complianceSummary.recommendation, 'submit_dispute');
  assert.match(result.processorDisputeSummary, /recommendation: submit_dispute/i);

  const preview = buildProcessorDisputeEmailPreview(result.processorDisputeEvidence!);
  assert.match(preview.subject, /Dispute Request/i);
  assert.match(preview.body, /payment succeeded but service activation failed/i);
});

test('recommends retry for merchant site errors before capture', async () => {
  const engine = createSupportWorkflowEngine(makeDeps({
    async fetchEvidence() {
      return {
        merchantRefundSupported: null,
        retryAttempts: [],
        provisioningChecks: [],
        benefitChecks: [],
        returnedErrors: [
          {
            source: 'merchant',
            message: '503 Service Unavailable',
          },
        ],
      };
    },
  }));

  const result = await engine.run({
    ...makeBaseInput(),
    paymentFlowId: 'flow_2',
    transactionId: 'txn_2',
    merchantName: 'Adobe',
    message: 'Merchant site error 503 during signup',
    stage: 'signup',
    httpStatus: 503,
    paymentStatus: 'unknown',
    activationStatus: 'UNKNOWN',
  });

  assert.equal(result.classification.code, 'merchant_site_error');
  assert.equal(result.actionDecision.nextAction, 'RETRY');
  assert.equal(result.processorDisputeEvidence, null);
});

test('executes configured refund action handler when enabled', async () => {
  let refundCalls = 0;

  const engine = createSupportWorkflowEngine(makeDeps({
    async executeRefund() {
      refundCalls += 1;
      return {
        executed: true,
        action: 'REFUND',
        referenceId: 'refund_123',
        message: 'Refund initiated',
      };
    },
  }));

  const result = await engine.run({
    ...makeBaseInput(),
    executeActions: true,
  });

  assert.equal(refundCalls, 1);
  assert.equal(result.executedAction.executed, true);
  assert.equal(result.executedAction.referenceId, 'refund_123');
  assert.equal(result.workflow.state, 'COMPLETED');
  assert.ok(result.workflow.history.some((entry) => entry.to === 'ACTION_EXECUTED'));
});

