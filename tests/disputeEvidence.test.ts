import assert from 'node:assert/strict';
import test from 'node:test';
import type { DisputeEvidenceInput } from '../lib/disputes/evidence.ts';
import { generateDisputeEvidenceObject } from '../lib/disputes/evidence.ts';
import { generateDisputeEvidencePdf } from '../lib/disputes/pdf.ts';
import { buildDisputeSupportEmailTemplate } from '../lib/disputes/emailTemplate.ts';

function sampleEvidenceInput(): DisputeEvidenceInput {
  return {
    transactionId: 'tx_12345',
    merchantName: 'Netflix',
    amount: 7.99,
    currency: 'usd',
    paymentStatus: 'captured' as const,
    activationStatus: 'FAILED' as const,
    timestamps: {
      authorizedAt: '2026-03-10T18:00:00.000Z',
      capturedAt: '2026-03-10T18:01:00.000Z',
      activationCheckedAt: '2026-03-10T18:10:00.000Z',
      disputePreparedAt: '2026-03-10T18:20:00.000Z',
    },
    orchestrationLogs: [
      {
        at: '2026-03-10T18:02:00.000Z',
        stage: 'activation_check',
        status: 'warning' as const,
        message: 'Service entitlement missing.',
      },
    ],
    screenshots: [
      {
        label: 'Account page after purchase',
        capturedAt: '2026-03-10T18:05:00.000Z',
        path: '/tmp/netflix-account.png',
        note: 'No active plan shown.',
      },
    ],
    returnedErrors: [
      {
        source: 'merchant_api',
        message: 'subscription_not_found',
        code: 'SUBSCRIPTION_NOT_FOUND',
        at: '2026-03-10T18:09:00.000Z',
      },
    ],
    retryAttempts: [
      { attempt: 1, at: '2026-03-10T18:06:00.000Z', outcome: 'failed' as const, reason: 'timeout' },
      { attempt: 2, at: '2026-03-10T18:08:00.000Z', outcome: 'failed' as const, reason: 'subscription_not_found' },
    ],
    provisioningChecks: [
      {
        check: 'merchant_api_subscription_lookup',
        result: 'not_provisioned' as const,
        observedAt: '2026-03-10T18:09:00.000Z',
        details: 'No subscription record returned.',
      },
    ],
    benefitChecks: [
      {
        check: 'entitlement_flag_check',
        result: 'no_benefit' as const,
        observedAt: '2026-03-10T18:09:30.000Z',
        details: 'User account has no premium entitlement.',
      },
    ],
    userStatement: 'I was charged but I still cannot access the paid plan.',
  };
}

test('generates structured dispute evidence with strong proof and submit recommendation', () => {
  const evidence = generateDisputeEvidenceObject(sampleEvidenceInput());

  assert.equal(evidence.transaction.id, 'tx_12345');
  assert.equal(evidence.transaction.merchantName, 'Netflix');
  assert.equal(evidence.transaction.amount, 7.99);
  assert.equal(evidence.transaction.paymentStatus, 'captured');
  assert.equal(evidence.transaction.activationStatus, 'FAILED');
  assert.equal(evidence.proofs.serviceNeverProvisioned.satisfied, true);
  assert.equal(evidence.proofs.userDidNotReceiveBenefit.satisfied, true);
  assert.equal(evidence.complianceSummary.recommendation, 'submit_dispute');
});

test('downgrades recommendation when provisioning proof is contradictory', () => {
  const input = sampleEvidenceInput();
  input.provisioningChecks.push({
    check: 'secondary_account_probe',
    result: 'provisioned',
    observedAt: '2026-03-10T18:11:00.000Z',
    details: 'Conflicting response from merchant.',
  });

  const evidence = generateDisputeEvidenceObject(input);
  assert.equal(evidence.proofs.serviceNeverProvisioned.satisfied, false);
  assert.equal(evidence.complianceSummary.recommendation, 'needs_manual_review');
});

test('produces downloadable PDF bytes with valid PDF header', () => {
  const evidence = generateDisputeEvidenceObject(sampleEvidenceInput());
  const pdf = generateDisputeEvidencePdf(evidence);

  assert.equal(pdf.mimeType, 'application/pdf');
  assert.match(pdf.fileName, /dispute-evidence-tx_12345\.pdf/);
  const text = pdf.bytes.toString('utf8');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('Agent Wallet Dispute Evidence Summary'));
  assert.ok(text.includes('Merchant: Netflix'));
});

test('builds plain-language support email template', () => {
  const evidence = generateDisputeEvidenceObject(sampleEvidenceInput());
  const email = buildDisputeSupportEmailTemplate(evidence);

  assert.match(email.subject, /Dispute Request - Netflix - tx_12345/);
  assert.match(email.body, /payment succeeded but service activation failed/i);
  assert.match(email.body, /Transaction ID: tx_12345/);
  assert.match(email.body, /Please review the attached evidence pack/i);
});
