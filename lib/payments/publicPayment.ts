import type { PaymentFlow } from './twoPhasePayment';

export type PublicPaymentFlow = Pick<
  PaymentFlow,
  | 'id'
  | 'taskId'
  | 'merchant'
  | 'amount'
  | 'currency'
  | 'fundingMode'
  | 'status'
  | 'requiresActivationVerification'
  | 'activationVerifiedAt'
  | 'authorizedAt'
  | 'capturedAt'
  | 'refundedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export function sanitizePaymentForClient(payment: PaymentFlow): PublicPaymentFlow {
  return {
    id: payment.id,
    taskId: payment.taskId,
    merchant: payment.merchant,
    amount: payment.amount,
    currency: payment.currency,
    fundingMode: payment.fundingMode,
    status: payment.status,
    requiresActivationVerification: payment.requiresActivationVerification,
    activationVerifiedAt: payment.activationVerifiedAt,
    authorizedAt: payment.authorizedAt,
    capturedAt: payment.capturedAt,
    refundedAt: payment.refundedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}
