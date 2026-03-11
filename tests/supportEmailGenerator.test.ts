import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPORT_EMAIL_PLACEHOLDERS,
  buildFinalPreDisputeNoticeEmail,
  buildFollowUpEmail,
  buildRefundRequestEmail,
  buildSupportEmailSet,
} from '../lib/support/emailGenerator.ts';

const sampleInput = {
  merchantName: 'Example SaaS',
  transactionAmount: 19.99,
  currency: 'usd',
  dateTime: '2026-03-10T12:05:00.000Z',
  orderOrPaymentReference: 'pi_abc123',
  activationFailureReason: 'Account remained in trial after payment capture.',
  logsSummary: 'Capture succeeded, provisioning check failed, retries exhausted.',
};

test('exposes placeholder tokens for UI/editor usage', () => {
  assert.equal(SUPPORT_EMAIL_PLACEHOLDERS.merchantName, '{{merchantName}}');
  assert.equal(SUPPORT_EMAIL_PLACEHOLDERS.orderOrPaymentReference, '{{orderOrPaymentReference}}');
});

test('buildRefundRequestEmail renders concise factual email', () => {
  const email = buildRefundRequestEmail(sampleInput);
  assert.equal(email.template, 'REFUND_REQUEST');
  assert.match(email.subject, /Refund request - Example SaaS - pi_abc123/);
  assert.match(email.body, /undelivered digital service purchase/i);
  assert.match(email.body, /Amount: 19.99 USD/);
  assert.match(email.body, /Activation failure reason:/);
});

test('buildFollowUpEmail renders firmer follow-up tone without accusations', () => {
  const email = buildFollowUpEmail(sampleInput);
  assert.equal(email.template, 'FOLLOW_UP');
  assert.match(email.subject, /Follow-up on unresolved refund request/);
  assert.match(email.body, /status update and resolution ETA/i);
  assert.doesNotMatch(email.body, /fraud|scam|illegal/i);
});

test('buildFinalPreDisputeNoticeEmail renders final escalation notice', () => {
  const email = buildFinalPreDisputeNoticeEmail(sampleInput);
  assert.equal(email.template, 'PRE_DISPUTE_NOTICE');
  assert.match(email.subject, /Final notice before dispute filing/);
  assert.match(email.body, /final pre-dispute notice/i);
  assert.match(email.body, /payment processor dispute channel/i);
});

test('buildSupportEmailSet returns all three generated outputs', () => {
  const set = buildSupportEmailSet(sampleInput);
  assert.equal(set.refundRequest.template, 'REFUND_REQUEST');
  assert.equal(set.followUp.template, 'FOLLOW_UP');
  assert.equal(set.finalPreDisputeNotice.template, 'PRE_DISPUTE_NOTICE');
});

