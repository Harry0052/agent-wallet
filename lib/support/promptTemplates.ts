import { z } from 'zod';

export const SupportPromptTemplateKeySchema = z.enum([
  'USER_EXPLANATION',
  'MERCHANT_SUPPORT_MESSAGE',
  'PROCESSOR_DISPUTE_SUMMARY',
]);

export type SupportPromptTemplateKey = z.infer<typeof SupportPromptTemplateKeySchema>;

export type SupportTemplateVariables = Record<string, string | number | null | undefined>;

export const SUPPORT_PROMPT_TEMPLATES: Record<SupportPromptTemplateKey, string> = {
  USER_EXPLANATION: [
    'We identified an issue with your {{merchantName}} purchase.',
    'Status: payment={{paymentStatus}}, activation={{activationStatus}}.',
    'What happened: {{failureTitle}}.',
    'Next step: {{nextAction}}.',
    '{{additionalContext}}',
  ].join('\n'),

  MERCHANT_SUPPORT_MESSAGE: [
    'Hello {{merchantName}} Support Team,',
    '',
    'We are contacting you regarding transaction {{transactionId}} for {{amount}} {{currency}}.',
    'Observed issue: {{failureTitle}}.',
    'Payment status: {{paymentStatus}}. Activation status: {{activationStatus}}.',
    'Requested action: {{nextAction}}.',
    'Evidence summary: {{evidenceSummary}}.',
    '',
    'Please confirm entitlement provisioning status and provide resolution steps or refund confirmation.',
    'This request follows normal merchant support channels and does not request bypassing verification controls.',
    '',
    'Thank you.',
  ].join('\n'),

  PROCESSOR_DISPUTE_SUMMARY: [
    'Processor dispute preparation summary',
    'Transaction: {{transactionId}}',
    'Merchant: {{merchantName}}',
    'Amount: {{amount}} {{currency}}',
    'Payment status: {{paymentStatus}}',
    'Activation status: {{activationStatus}}',
    'Failure classification: {{failureCode}}',
    'Recommendation: {{recommendation}}',
    'Proof of non-provisioning: {{nonProvisioningProof}}',
    'Proof of no user benefit: {{noBenefitProof}}',
    'Evidence references: {{evidenceSummary}}',
  ].join('\n'),
};

export function renderSupportPromptTemplate(
  key: SupportPromptTemplateKey,
  variables: SupportTemplateVariables,
): string {
  const template = SUPPORT_PROMPT_TEMPLATES[key];
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, token: string) => {
    const value = variables[token];
    if (value === null || value === undefined) return '';
    return String(value);
  }).replace(/\n{3,}/g, '\n\n').trim();
}
