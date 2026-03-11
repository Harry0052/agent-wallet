import { z } from 'zod';

export type SupportEmailTemplateType =
  | 'REFUND_REQUEST'
  | 'FOLLOW_UP'
  | 'PRE_DISPUTE_NOTICE';

export interface SupportEmail {
  template: SupportEmailTemplateType;
  subject: string;
  body: string;
}

export const SupportEmailInputSchema = z.object({
  merchantName: z.string().min(1),
  transactionAmount: z.number().positive(),
  currency: z.string().trim().min(3).max(3).default('USD'),
  dateTime: z.union([z.string().min(1), z.date()]),
  orderOrPaymentReference: z.string().min(1),
  activationFailureReason: z.string().min(1),
  logsSummary: z.string().min(1),
});

export type SupportEmailInput = z.infer<typeof SupportEmailInputSchema>;

const PLACEHOLDER_EXAMPLE = {
  merchantName: '{{merchantName}}',
  transactionAmount: '{{transactionAmount}}',
  currency: '{{currency}}',
  dateTime: '{{dateTime}}',
  orderOrPaymentReference: '{{orderOrPaymentReference}}',
  activationFailureReason: '{{activationFailureReason}}',
  logsSummary: '{{logsSummary}}',
};

export const SUPPORT_EMAIL_PLACEHOLDERS = Object.freeze(PLACEHOLDER_EXAMPLE);

export const REFUND_REQUEST_TEMPLATE = Object.freeze({
  subject: 'Refund request - {{merchantName}} - {{orderOrPaymentReference}}',
  body: [
    'Hello Support Team,',
    '',
    'I am requesting a refund for an undelivered digital service purchase.',
    `Merchant: ${PLACEHOLDER_EXAMPLE.merchantName}`,
    `Amount: ${PLACEHOLDER_EXAMPLE.transactionAmount} ${PLACEHOLDER_EXAMPLE.currency}`,
    `Date/time: ${PLACEHOLDER_EXAMPLE.dateTime}`,
    `Order/payment reference: ${PLACEHOLDER_EXAMPLE.orderOrPaymentReference}`,
    `Activation failure reason: ${PLACEHOLDER_EXAMPLE.activationFailureReason}`,
    `Logs summary: ${PLACEHOLDER_EXAMPLE.logsSummary}`,
    '',
    'Please confirm refund processing and expected settlement timing.',
    '',
    'Thank you.',
  ].join('\n'),
});

export const FOLLOW_UP_TEMPLATE = Object.freeze({
  subject: 'Follow-up on unresolved refund request - {{merchantName}} - {{orderOrPaymentReference}}',
  body: [
    'Hello Support Team,',
    '',
    'Following up on my prior refund request for an undelivered digital service.',
    `Merchant: ${PLACEHOLDER_EXAMPLE.merchantName}`,
    `Amount: ${PLACEHOLDER_EXAMPLE.transactionAmount} ${PLACEHOLDER_EXAMPLE.currency}`,
    `Date/time: ${PLACEHOLDER_EXAMPLE.dateTime}`,
    `Order/payment reference: ${PLACEHOLDER_EXAMPLE.orderOrPaymentReference}`,
    `Activation failure reason: ${PLACEHOLDER_EXAMPLE.activationFailureReason}`,
    `Logs summary: ${PLACEHOLDER_EXAMPLE.logsSummary}`,
    '',
    'Please provide a status update and resolution ETA. If more documentation is required, I can provide it promptly.',
    '',
    'Thank you.',
  ].join('\n'),
});

export const PRE_DISPUTE_NOTICE_TEMPLATE = Object.freeze({
  subject: 'Final notice before dispute filing - {{merchantName}} - {{orderOrPaymentReference}}',
  body: [
    'Hello Support Team,',
    '',
    'This is a final pre-dispute notice regarding an undelivered digital service charge.',
    `Merchant: ${PLACEHOLDER_EXAMPLE.merchantName}`,
    `Amount: ${PLACEHOLDER_EXAMPLE.transactionAmount} ${PLACEHOLDER_EXAMPLE.currency}`,
    `Date/time: ${PLACEHOLDER_EXAMPLE.dateTime}`,
    `Order/payment reference: ${PLACEHOLDER_EXAMPLE.orderOrPaymentReference}`,
    `Activation failure reason: ${PLACEHOLDER_EXAMPLE.activationFailureReason}`,
    `Logs summary: ${PLACEHOLDER_EXAMPLE.logsSummary}`,
    '',
    'If this cannot be resolved immediately through refund confirmation, the charge will be escalated through the payment processor dispute channel with supporting evidence.',
    '',
    'Please advise as soon as possible.',
  ].join('\n'),
});

type TemplateParts = {
  subject: string;
  body: string;
};

function formatDateTime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function inputToPlaceholderValues(raw: SupportEmailInput): Record<string, string> {
  const input = SupportEmailInputSchema.parse(raw);
  return {
    merchantName: input.merchantName,
    transactionAmount: input.transactionAmount.toFixed(2),
    currency: input.currency.toUpperCase(),
    dateTime: formatDateTime(input.dateTime),
    orderOrPaymentReference: input.orderOrPaymentReference,
    activationFailureReason: input.activationFailureReason,
    logsSummary: input.logsSummary,
  };
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
    const value = values[key];
    return value ?? '';
  });
}

function buildEmail(
  template: SupportEmailTemplateType,
  parts: TemplateParts,
  input: SupportEmailInput,
): SupportEmail {
  const values = inputToPlaceholderValues(input);
  return {
    template,
    subject: renderTemplate(parts.subject, values),
    body: renderTemplate(parts.body, values),
  };
}

export function buildRefundRequestEmail(input: SupportEmailInput): SupportEmail {
  return buildEmail('REFUND_REQUEST', REFUND_REQUEST_TEMPLATE, input);
}

export function buildFollowUpEmail(input: SupportEmailInput): SupportEmail {
  return buildEmail('FOLLOW_UP', FOLLOW_UP_TEMPLATE, input);
}

export function buildFinalPreDisputeNoticeEmail(input: SupportEmailInput): SupportEmail {
  return buildEmail('PRE_DISPUTE_NOTICE', PRE_DISPUTE_NOTICE_TEMPLATE, input);
}

export function buildSupportEmailSet(input: SupportEmailInput): {
  refundRequest: SupportEmail;
  followUp: SupportEmail;
  finalPreDisputeNotice: SupportEmail;
} {
  return {
    refundRequest: buildRefundRequestEmail(input),
    followUp: buildFollowUpEmail(input),
    finalPreDisputeNotice: buildFinalPreDisputeNoticeEmail(input),
  };
}

