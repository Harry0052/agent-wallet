import type { Recipient, Transaction, Wallet, WalletSettings } from '@/lib/types';
import { safeJson } from '@/services/safeFetch';

const DEFAULT_SETTINGS: WalletSettings = {
  maxTransaction: 50,
  dailyLimit: 100,
  monthlyBudget: 500,
  approvalThreshold: 10,
  requireLocation: true,
  allowedMerchants: [],
  blockedMerchants: [],
};

export interface SendMoneyPayload {
  amount: number;
  recipientId?: string;
  recipientName?: string;
  merchant?: string;
  sourceUrl?: string;
  description?: string;
  approved?: boolean;
  idempotencyKey?: string;
}

export interface SendMoneyResult {
  wallet: Wallet;
  transaction: Transaction;
  payoutStatus: 'succeeded' | 'pending' | 'failed';
}

import { toUserFriendlyError } from './apiErrorMessage';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await safeJson<T & { error?: string; errorCode?: string }>(res);
  if (!res.ok) {
    const parsed = body as { error?: string; errorCode?: string };
    throw toUserFriendlyError(parsed);
  }
  return body as T;
}

export function getDefaultWallet(): Wallet {
  return {
    balance: 0,
    currency: 'USD',
    transactions: [],
    settings: { ...DEFAULT_SETTINGS },
    recipients: [],
  };
}

export async function fetchWallet(): Promise<Wallet> {
  const res = await fetch('/api/wallet', { cache: 'no-store' });
  return jsonOrThrow<Wallet>(res);
}

export async function updateSettings(updates: Partial<WalletSettings>): Promise<Wallet> {
  const res = await fetch('/api/wallet/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return jsonOrThrow<Wallet>(res);
}

export async function createRecipient(name: string, stripeAccountId: string): Promise<Recipient> {
  const res = await fetch('/api/wallet/recipients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stripeAccountId, status: 'approved' }),
  });
  const body = await jsonOrThrow<{ recipient: Recipient }>(res);
  return body.recipient;
}

export async function sendMoney(payload: SendMoneyPayload): Promise<SendMoneyResult> {
  const res = await fetch('/api/wallet/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return jsonOrThrow<SendMoneyResult>(res);
}

export interface SubscriptionDebitPayload {
  amount: number;
  merchant: string;
  description?: string;
  approved?: boolean;
  idempotencyKey?: string;
}

export interface SubscriptionDebitResult {
  wallet: Wallet;
  transaction: Transaction;
}

export async function subscriptionDebit(payload: SubscriptionDebitPayload): Promise<SubscriptionDebitResult> {
  const res = await fetch('/api/wallet/subscription-debit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return jsonOrThrow<SubscriptionDebitResult>(res);
}

export async function refundSubscriptionDebit(payload: {
  amount: number;
  merchant: string;
  reason?: string;
  idempotencyKey?: string;
}): Promise<{ wallet: Wallet; transaction: Transaction }> {
  const res = await fetch('/api/wallet/subscription-debit', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return jsonOrThrow<{ wallet: Wallet; transaction: Transaction }>(res);
}

function startOfDayMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function startOfMonthMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function sumSucceededDebitsSince(transactions: Transaction[], sinceMs: number): number {
  return transactions.reduce((acc, tx) => {
    if (tx.status !== 'succeeded' || tx.direction !== 'debit') return acc;
    const createdAt = Date.parse(tx.createdAt);
    if (Number.isNaN(createdAt) || createdAt < sinceMs) return acc;
    return acc + tx.amount;
  }, 0);
}

export function getDailySpent(wallet: Wallet): number {
  return Math.round(sumSucceededDebitsSince(wallet.transactions, startOfDayMs()) * 100) / 100;
}

export function getMonthlySpent(wallet: Wallet): number {
  return Math.round(sumSucceededDebitsSince(wallet.transactions, startOfMonthMs()) * 100) / 100;
}

function merchantMatches(name: string | undefined, list: string[]): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  return list.some((item) => normalized.includes(item.toLowerCase()));
}

export function canSpendSnapshot(
  wallet: Wallet,
  amount: number,
  merchant?: string,
  options?: { ignoreBalance?: boolean },
): { allowed: boolean; reason?: string } {
  if (amount <= 0) return { allowed: false, reason: 'Invalid amount' };
  if (!options?.ignoreBalance && amount > wallet.balance) {
    return { allowed: false, reason: 'Insufficient balance' };
  }
  if (amount > wallet.settings.maxTransaction) {
    return { allowed: false, reason: `Exceeds max transaction of $${wallet.settings.maxTransaction.toFixed(2)}` };
  }

  const dailySpent = getDailySpent(wallet);
  if (dailySpent + amount > wallet.settings.dailyLimit) {
    return { allowed: false, reason: `Would exceed daily limit of $${wallet.settings.dailyLimit.toFixed(2)}` };
  }

  const monthlySpent = getMonthlySpent(wallet);
  if (monthlySpent + amount > wallet.settings.monthlyBudget) {
    return { allowed: false, reason: `Would exceed monthly budget of $${wallet.settings.monthlyBudget.toFixed(2)}` };
  }

  if (merchantMatches(merchant, wallet.settings.blockedMerchants)) {
    return { allowed: false, reason: 'Merchant is blocked by guardrails' };
  }

  if (wallet.settings.allowedMerchants.length > 0 && !merchantMatches(merchant, wallet.settings.allowedMerchants)) {
    return { allowed: false, reason: 'Merchant is not in allowed merchants list' };
  }

  return { allowed: true };
}

export interface TwoPhasePaymentFlow {
  id: string;
  taskId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  fundingMode: 'STRIPE_AUTH_CAPTURE' | 'PREPAID_BALANCE';
  status:
    | 'authorization_pending'
    | 'activation_pending'
    | 'activated'
    | 'activation_failed'
    | 'capture_pending'
    | 'captured'
    | 'refund_pending'
    | 'refunded'
    | 'failed';
  requiresActivationVerification: boolean;
  stripePaymentIntentId: string | null;
  activationVerifiedAt: string | null;
  authorizedAt: string | null;
  capturedAt: string | null;
  refundedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizePaymentPayload {
  merchant: string;
  amount: number;
  currency?: string;
  taskId?: string;
  idempotencyKey: string;
  fundingMode?: 'STRIPE_AUTH_CAPTURE' | 'PREPAID_BALANCE';
  allowPrepaidFallback?: boolean;
  requiresActivationVerification?: boolean;
  preferredPaymentMethodId?: string;
  metadata?: Record<string, unknown>;
}

export interface CapturePaymentPayload {
  paymentId: string;
  idempotencyKey: string;
  activationVerified: boolean;
  activationEvidence?: Record<string, unknown>;
  activationFailureReason?: string;
  preferredPaymentMethodId?: string;
}

export interface VoidPaymentPayload {
  paymentId: string;
  idempotencyKey: string;
  reason: string;
}

export interface RefundInitiatePayload {
  paymentFlowId: string;
  idempotencyKey: string;
  activationFailureReason?: string;
  activationEvidence?: Record<string, unknown>;
  allowWithoutActivationFailure?: boolean;
}

export interface RefundCaseRecord {
  id: string;
  paymentFlowId: string;
  status: string;
  merchant: string;
  amount: number;
  currency: string;
  activationFailureReason: string | null;
  userExplanation?: string | null;
}

export async function authorizeSubscriptionPayment(payload: AuthorizePaymentPayload): Promise<{
  payment: TwoPhasePaymentFlow;
  idempotentReplay: boolean;
}> {
  const res = await fetch('/api/payments/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return jsonOrThrow<{
    payment: TwoPhasePaymentFlow;
    idempotentReplay: boolean;
  }>(res);
}

export async function captureSubscriptionPayment(payload: CapturePaymentPayload): Promise<{
  payment: TwoPhasePaymentFlow;
  idempotentReplay: boolean;
  retryScheduled: boolean;
  nextRetryAt: string | null;
}> {
  const res = await fetch('/api/payments/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return jsonOrThrow<{
    payment: TwoPhasePaymentFlow;
    idempotentReplay: boolean;
    retryScheduled: boolean;
    nextRetryAt: string | null;
  }>(res);
}

export async function voidSubscriptionPayment(payload: VoidPaymentPayload): Promise<{
  payment: TwoPhasePaymentFlow;
  idempotentReplay: boolean;
}> {
  const res = await fetch('/api/payments/void', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return jsonOrThrow<{
    payment: TwoPhasePaymentFlow;
    idempotentReplay: boolean;
  }>(res);
}

export async function initiateRefundWorkflow(payload: RefundInitiatePayload): Promise<{
  refundCase: RefundCaseRecord;
  auditLogs: Array<Record<string, unknown>>;
  userExplanation: string;
}> {
  const res = await fetch('/api/refunds/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return jsonOrThrow<{
    refundCase: RefundCaseRecord;
    auditLogs: Array<Record<string, unknown>>;
    userExplanation: string;
  }>(res);
}
