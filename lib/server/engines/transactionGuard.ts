import 'server-only';

import {
  listNormalizedTransactions,
  type StatementTransaction,
} from '@/transactions/transactionRepository';

export interface ExclusionSummary {
  pending: number;
  transfers: number;
  refunds: number;
  reimbursements: number;
  creditCardPayments: number;
  zeroAmount: number;
  duplicates: number;
  total: number;
}

const TRANSFER_CATEGORIES = new Set([
  'transfer',
  'bank transfer',
  'wire transfer',
  'ach transfer',
  'internal transfer',
]);

const CREDIT_CARD_PAYMENT_CATEGORIES = new Set([
  'credit card payment',
  'credit card',
  'card payment',
]);

const BANK_FEE_CATEGORIES = new Set([
  'bank fee',
  'bank fees',
  'fee',
  'service charge',
]);

function categoryMatches(category: string, targetSet: Set<string>): boolean {
  return targetSet.has(category.toLowerCase().trim());
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs(Date.parse(a) - Date.parse(b)) / msPerDay;
}

export async function listAnalyzableTransactions(input: {
  userId: string;
  lookbackDays?: number;
  limit?: number;
}): Promise<{ transactions: StatementTransaction[]; excluded: ExclusionSummary }> {
  const lookbackDays = input.lookbackDays ?? 90;
  const limit = input.limit ?? 500;

  const all = await listNormalizedTransactions({
    userId: input.userId,
    limit,
  });

  const excluded: ExclusionSummary = {
    pending: 0,
    transfers: 0,
    refunds: 0,
    reimbursements: 0,
    creditCardPayments: 0,
    zeroAmount: 0,
    duplicates: 0,
    total: 0,
  };

  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  let remaining: StatementTransaction[] = [];

  for (const tx of all) {
    const occurredMs = Date.parse(tx.occurred_at);
    if (!Number.isFinite(occurredMs) || occurredMs < cutoffMs) {
      continue;
    }

    if (tx.pending) {
      excluded.pending += 1;
      continue;
    }

    if (categoryMatches(tx.category, TRANSFER_CATEGORIES)) {
      excluded.transfers += 1;
      continue;
    }

    if (categoryMatches(tx.category, CREDIT_CARD_PAYMENT_CATEGORIES)) {
      excluded.creditCardPayments += 1;
      continue;
    }

    if (categoryMatches(tx.category, BANK_FEE_CATEGORIES)) {
      excluded.transfers += 1;
      continue;
    }

    if (tx.amount === 0) {
      excluded.zeroAmount += 1;
      continue;
    }

    remaining.push(tx);
  }

  // Detect refunds: negative amounts matching a positive charge to same merchant within 7 days
  const refundIds = new Set<string>();
  const positives = remaining.filter((tx) => tx.amount > 0);
  const negatives = remaining.filter((tx) => tx.amount < 0);

  for (const neg of negatives) {
    const matchingPositive = positives.find(
      (pos) =>
        !refundIds.has(pos.id) &&
        pos.normalized_merchant === neg.normalized_merchant &&
        Math.abs(pos.amount + neg.amount) < 0.01 &&
        daysBetween(pos.occurred_at, neg.occurred_at) <= 7,
    );

    if (matchingPositive) {
      refundIds.add(neg.id);
      refundIds.add(matchingPositive.id);
    }
  }

  if (refundIds.size > 0) {
    excluded.refunds = refundIds.size;
    remaining = remaining.filter((tx) => !refundIds.has(tx.id));
  }

  // Detect reimbursements: credits matching prior debit to same merchant within 14 days
  const reimbursementIds = new Set<string>();
  const debits = remaining.filter((tx) => tx.amount > 0);
  const credits = remaining.filter((tx) => tx.amount < 0);

  for (const credit of credits) {
    const matchingDebit = debits.find(
      (debit) =>
        !reimbursementIds.has(debit.id) &&
        debit.normalized_merchant === credit.normalized_merchant &&
        daysBetween(debit.occurred_at, credit.occurred_at) <= 14 &&
        Date.parse(debit.occurred_at) < Date.parse(credit.occurred_at),
    );

    if (matchingDebit) {
      reimbursementIds.add(credit.id);
      reimbursementIds.add(matchingDebit.id);
    }
  }

  if (reimbursementIds.size > 0) {
    excluded.reimbursements = reimbursementIds.size;
    remaining = remaining.filter((tx) => !reimbursementIds.has(tx.id));
  }

  // Detect duplicates: same (normalized_merchant, amount, occurred_at within 24h)
  const duplicateIds = new Set<string>();
  const seen: StatementTransaction[] = [];

  for (const tx of remaining) {
    const isDuplicate = seen.some(
      (s) =>
        s.normalized_merchant === tx.normalized_merchant &&
        Math.abs(s.amount - tx.amount) < 0.01 &&
        daysBetween(s.occurred_at, tx.occurred_at) <= 1,
    );

    if (isDuplicate) {
      duplicateIds.add(tx.id);
    } else {
      seen.push(tx);
    }
  }

  if (duplicateIds.size > 0) {
    excluded.duplicates = duplicateIds.size;
    remaining = remaining.filter((tx) => !duplicateIds.has(tx.id));
  }

  excluded.total =
    excluded.pending +
    excluded.transfers +
    excluded.refunds +
    excluded.reimbursements +
    excluded.creditCardPayments +
    excluded.zeroAmount +
    excluded.duplicates;

  return { transactions: remaining, excluded };
}
