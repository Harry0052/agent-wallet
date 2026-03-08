import type { Recipient, Transaction, Wallet, WalletSettings } from '@/lib/types';

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

function jsonOrThrow<T>(res: Response): Promise<T> {
  return res.json().then((body) => {
    if (!res.ok) {
      const parsed = body as { error?: string; errorCode?: string };
      if (parsed.errorCode && parsed.error) {
        throw new Error(`${parsed.errorCode}: ${parsed.error}`);
      }
      throw new Error(parsed.error || 'Request failed');
    }
    return body as T;
  });
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

export function canSpendSnapshot(wallet: Wallet, amount: number, merchant?: string): { allowed: boolean; reason?: string } {
  if (amount <= 0) return { allowed: false, reason: 'Invalid amount' };
  if (amount > wallet.balance) return { allowed: false, reason: 'Insufficient balance' };
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
