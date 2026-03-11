import type { DisputeEvidenceObject } from './evidence.ts';

export interface DisputeSupportEmailTemplate {
  subject: string;
  body: string;
}

export function buildDisputeSupportEmailTemplate(evidence: DisputeEvidenceObject): DisputeSupportEmailTemplate {
  const tx = evidence.transaction;
  const statusLine = `Payment status: ${tx.paymentStatus}. Activation status: ${tx.activationStatus}.`;
  const proofLine = [
    `Service never provisioned: ${evidence.proofs.serviceNeverProvisioned.satisfied ? 'yes' : 'no'}.`,
    `User received no benefit: ${evidence.proofs.userDidNotReceiveBenefit.satisfied ? 'yes' : 'no'}.`,
  ].join(' ');

  const body = [
    'Hello Support Team,',
    '',
    'I am requesting assistance for a charge where payment succeeded but service activation failed.',
    '',
    `Transaction ID: ${tx.id}`,
    `Merchant: ${tx.merchantName}`,
    `Amount: ${tx.amount.toFixed(2)} ${tx.currency}`,
    `Captured at: ${tx.timestamps.capturedAt || 'N/A'}`,
    statusLine,
    proofLine,
    '',
    `Compliance recommendation: ${evidence.complianceSummary.recommendation} (${evidence.complianceSummary.confidence} confidence).`,
    `Reason: ${evidence.complianceSummary.rationale}`,
    '',
    `Retry attempts recorded: ${evidence.retryAttempts.length}`,
    `Errors recorded: ${evidence.returnedErrors.length}`,
    `Screenshots attached: ${evidence.screenshots.length}`,
    '',
    'Please review the attached evidence pack and process the appropriate refund/dispute resolution.',
    '',
    'Thank you.',
  ].join('\n');

  return {
    subject: `Dispute Request - ${tx.merchantName} - ${tx.id}`,
    body,
  };
}
