import type { Wallet } from '@/lib/types';

export type PaymentWorkflowRoute =
  | 'fund_wallet'
  | 'send_money'
  | 'prepare_checkout'
  | 'execute_purchase';

export interface PaymentRoutingDecision {
  route: PaymentWorkflowRoute;
  amountRequired: number | null;
  shortfall: number | null;
  approvalRequired: boolean;
  reason: string;
}

function normalizeAmount(amount: number | null): number | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

export function routeSendMoneyWorkflow(): PaymentRoutingDecision {
  return {
    route: 'send_money',
    amountRequired: null,
    shortfall: null,
    approvalRequired: false,
    reason: 'Direct recipient transfer path selected.',
  };
}

export function routeFundWalletWorkflow(amount: number | null): PaymentRoutingDecision {
  return {
    route: 'fund_wallet',
    amountRequired: normalizeAmount(amount),
    shortfall: normalizeAmount(amount),
    approvalRequired: false,
    reason: 'Wallet funding path selected explicitly.',
  };
}

export function routePrepareCheckoutWorkflow(): PaymentRoutingDecision {
  return {
    route: 'prepare_checkout',
    amountRequired: null,
    shortfall: null,
    approvalRequired: false,
    reason: 'Checkout preparation path selected.',
  };
}

export function routePurchaseExecutionWorkflow(input: {
  wallet: Wallet;
  amount: number | null;
}): PaymentRoutingDecision {
  const required = normalizeAmount(input.amount);
  if (required === null) {
    return {
      route: 'execute_purchase',
      amountRequired: null,
      shortfall: null,
      approvalRequired: true,
      reason: 'Amount could not be normalized; manual approval checkpoint required.',
    };
  }

  const balance = Math.round(input.wallet.balance * 100) / 100;
  if (balance < required) {
    return {
      route: 'fund_wallet',
      amountRequired: required,
      shortfall: Math.round((required - balance) * 100) / 100,
      approvalRequired: false,
      reason: 'Insufficient wallet balance for direct purchase execution.',
    };
  }

  return {
    route: 'execute_purchase',
    amountRequired: required,
    shortfall: 0,
    approvalRequired: required >= input.wallet.settings.approvalThreshold,
    reason: 'Wallet balance is sufficient; execute purchase using wallet funds first.',
  };
}

