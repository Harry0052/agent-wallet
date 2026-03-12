import 'server-only';

import type { Wallet } from '@/lib/types';
import { logServerEvent } from '@/lib/server/observability';

export type TransactionGuardViolationCode =
  | 'invalid_amount'
  | 'max_transaction_amount'
  | 'daily_spending_limit'
  | 'allowed_merchants'
  | 'allowed_categories'
  | 'user_confirmation_required';

export interface TransactionGuardViolation {
  code: TransactionGuardViolationCode;
  message: string;
}

export interface TransactionGuardPolicy {
  maxTransactionAmount: number;
  dailySpendingLimit: number;
  allowedMerchants: string[];
  allowedCategories: string[];
  confirmationThreshold: number;
}

export interface TransactionGuardInput {
  userId: string;
  context: string;
  amount: number;
  wallet: Pick<Wallet, 'settings' | 'transactions'>;
  merchant?: string | null;
  category?: string | null;
  approved?: boolean;
  enforceConfirmation?: boolean;
  policyOverrides?: Partial<TransactionGuardPolicy>;
}

export interface TransactionGuardDecision {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
  violations: TransactionGuardViolation[];
  dailySpent: number;
  projectedDailySpend: number;
  policy: TransactionGuardPolicy;
}

const LIST_SEPARATOR_PATTERN = /[,\n;]+/;

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function normalizeList(values: ReadonlyArray<string>): string[] {
  return Array.from(
    new Set(
      values
        .map((entry) => normalizeText(entry))
        .filter(Boolean),
    ),
  );
}

function parseEnvList(name: string): string[] {
  const raw = process.env[name]?.trim() || '';
  if (!raw) return [];
  return normalizeList(raw.split(LIST_SEPARATOR_PATTERN));
}

function parsePositiveNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function matchesAllowlist(value: string | null | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return false;
  return allowlist.some((item) => normalizedValue.includes(item));
}

function startOfDayMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function sumSucceededDebitsSince(
  transactions: Wallet['transactions'],
  sinceMs: number,
): number {
  return Math.round(
    transactions.reduce((acc, tx) => {
      if (tx.status !== 'succeeded' || tx.direction !== 'debit') return acc;
      const createdAt = Date.parse(tx.createdAt);
      if (Number.isNaN(createdAt) || createdAt < sinceMs) return acc;
      return acc + tx.amount;
    }, 0) * 100,
  ) / 100;
}

function resolvePolicy(input: TransactionGuardInput): TransactionGuardPolicy {
  const settings = input.wallet.settings;
  const envMax = parsePositiveNumber(process.env.TRANSACTION_MAX_AMOUNT);
  const envDaily = parsePositiveNumber(process.env.TRANSACTION_DAILY_SPENDING_LIMIT);
  const envThreshold = parsePositiveNumber(process.env.TRANSACTION_CONFIRMATION_THRESHOLD);
  const envAllowedMerchants = parseEnvList('TRANSACTION_ALLOWED_MERCHANTS');
  const envAllowedCategories = parseEnvList('TRANSACTION_ALLOWED_CATEGORIES');

  const maxTransactionAmount = input.policyOverrides?.maxTransactionAmount
    ?? envMax
    ?? settings.maxTransaction;
  const dailySpendingLimit = input.policyOverrides?.dailySpendingLimit
    ?? envDaily
    ?? settings.dailyLimit;
  const confirmationThreshold = input.policyOverrides?.confirmationThreshold
    ?? envThreshold
    ?? settings.approvalThreshold;

  const allowedMerchants = normalizeList(
    input.policyOverrides?.allowedMerchants
      ?? (envAllowedMerchants.length > 0 ? envAllowedMerchants : settings.allowedMerchants),
  );

  const allowedCategories = normalizeList(
    input.policyOverrides?.allowedCategories
      ?? envAllowedCategories,
  );

  return {
    maxTransactionAmount,
    dailySpendingLimit,
    allowedMerchants,
    allowedCategories,
    confirmationThreshold,
  };
}

export function evaluateTransactionGuardrails(input: TransactionGuardInput): TransactionGuardDecision {
  const policy = resolvePolicy(input);
  const violations: TransactionGuardViolation[] = [];

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    violations.push({
      code: 'invalid_amount',
      message: 'Transaction amount must be greater than zero.',
    });
  }

  if (input.amount > policy.maxTransactionAmount) {
    violations.push({
      code: 'max_transaction_amount',
      message: `Exceeds max transaction amount of $${policy.maxTransactionAmount.toFixed(2)}.`,
    });
  }

  const dailySpent = sumSucceededDebitsSince(input.wallet.transactions, startOfDayMs());
  const projectedDailySpend = Math.round((dailySpent + Math.max(0, input.amount)) * 100) / 100;
  if (projectedDailySpend > policy.dailySpendingLimit) {
    violations.push({
      code: 'daily_spending_limit',
      message: `Would exceed daily spending limit of $${policy.dailySpendingLimit.toFixed(2)}.`,
    });
  }

  if (policy.allowedMerchants.length > 0 && !matchesAllowlist(input.merchant, policy.allowedMerchants)) {
    violations.push({
      code: 'allowed_merchants',
      message: 'Merchant is not allowed by policy.',
    });
  }

  if (policy.allowedCategories.length > 0) {
    const normalizedCategory = normalizeText(input.category);
    if (!normalizedCategory) {
      violations.push({
        code: 'allowed_categories',
        message: 'Transaction category is required by policy.',
      });
    } else if (!matchesAllowlist(normalizedCategory, policy.allowedCategories)) {
      violations.push({
        code: 'allowed_categories',
        message: 'Category is not allowed by policy.',
      });
    }
  }

  const requiresConfirmation = Boolean(input.enforceConfirmation)
    && input.amount >= policy.confirmationThreshold
    && input.approved !== true;

  if (requiresConfirmation) {
    violations.push({
      code: 'user_confirmation_required',
      message: `User confirmation required for transactions at or above $${policy.confirmationThreshold.toFixed(2)}.`,
    });
  }

  return {
    allowed: violations.length === 0,
    reason: violations[0]?.message,
    requiresConfirmation,
    violations,
    dailySpent,
    projectedDailySpend,
    policy,
  };
}

export function enforceTransactionGuardrails(input: TransactionGuardInput): TransactionGuardDecision {
  const decision = evaluateTransactionGuardrails(input);
  if (decision.allowed) {
    return decision;
  }

  logServerEvent('warn', 'security.transaction_guard.blocked', {
    userId: input.userId,
    context: input.context,
    amount: input.amount,
    merchant: input.merchant || null,
    category: input.category || null,
    approved: input.approved === true,
    enforceConfirmation: Boolean(input.enforceConfirmation),
    requiresConfirmation: decision.requiresConfirmation,
    reason: decision.reason || 'transaction_guard_violation',
    violations: decision.violations.map((entry) => entry.code),
    confirmationThreshold: decision.policy.confirmationThreshold,
    maxTransactionAmount: decision.policy.maxTransactionAmount,
    dailySpendingLimit: decision.policy.dailySpendingLimit,
    dailySpent: decision.dailySpent,
    projectedDailySpend: decision.projectedDailySpend,
  });

  return decision;
}
