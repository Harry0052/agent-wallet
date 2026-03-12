import 'server-only';

export interface SanitizedAiTransaction {
  merchant: string;
  amount: number;
  date: string;
  category: string;
  pending: boolean;
  merchant_group: string;
}

export interface AggregatedSpendCategory {
  category: string;
  total_spend: number;
  transaction_count: number;
}

export interface SafeAiSpendingDataset {
  normalizedTransactions: SanitizedAiTransaction[];
  merchantNames: string[];
  aggregatedSpendCategories: AggregatedSpendCategory[];
}

const SENSITIVE_VALUE_PATTERNS: Array<{ pattern: RegExp; replacement?: string }> = [
  // Bank routing numbers (9 digits).
  { pattern: /\b\d{9}\b/g },
  // Bank account numbers (typical 10-17 digits).
  { pattern: /\b\d{10,17}\b/g },
  // Plaid tokens and public tokens.
  { pattern: /\b(?:access|public|link|processor)-(?:sandbox|development|production)-[a-z0-9_-]+\b/gi },
  { pattern: /\bplaid[a-z0-9_-]*token[a-z0-9_-]*\b/gi },
  // Internal IDs.
  { pattern: /\b(?:usr|sess|evt|prt|wallet|task|tool|acct|txn|pay|rfd)_[a-z0-9]{6,}\b/gi },
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi },
  // Common API key formats.
  { pattern: /\bsk-(?:live|test)-[a-z0-9]{12,}\b/gi },
  { pattern: /\bpk_(?:live|test)_[a-z0-9]{12,}\b/gi },
  { pattern: /\bBearer\s+[A-Za-z0-9\-._~+/=]+\b/gi, replacement: 'Bearer [REDACTED]' },
];

const SENSITIVE_KEY_PATTERN = /(account|routing|token|secret|api[_-]?key|authorization|internal[_-]?id|provider[_-]?transaction[_-]?id|linked[_-]?account[_-]?id)/i;
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function normalizeAmount(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(String(value ?? 0));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function normalizeDate(value: unknown): string {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

function normalizeCategory(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'uncategorized';
  return sanitizeAiText(value).trim().toLowerCase() || 'uncategorized';
}

function normalizeMerchant(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Unknown Merchant';
  const sanitized = sanitizeAiText(value).trim();
  return sanitized || 'Unknown Merchant';
}

function normalizeMerchantGroup(raw: unknown, merchant: string): string {
  if (typeof raw === 'string' && raw.trim()) {
    const sanitized = sanitizeAiText(raw).trim().toLowerCase();
    if (sanitized) return sanitized;
  }

  const fallback = merchant
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return fallback || 'unknown-merchant';
}

function normalizePending(value: unknown): boolean {
  return Boolean(value);
}

export function sanitizeAiText(input: string): string {
  if (!input) return input;

  let output = input;
  for (const matcher of SENSITIVE_VALUE_PATTERNS) {
    output = output.replace(matcher.pattern, matcher.replacement ?? '[REDACTED]');
  }

  return output;
}

export function sanitizeAiPayload<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeAiText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAiPayload(entry)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    sanitized[key] = sanitizeAiPayload(entry);
  }

  return sanitized as T;
}

export function sanitizeTransactionsForAi(
  rows: Array<Record<string, unknown>>,
): SanitizedAiTransaction[] {
  return rows.map((row) => {
    const merchant = normalizeMerchant(row.merchant ?? row.merchant_name);
    return {
      merchant,
      amount: normalizeAmount(row.amount),
      date: normalizeDate(row.date ?? row.occurred_at),
      category: normalizeCategory(row.category),
      pending: normalizePending(row.pending),
      merchant_group: normalizeMerchantGroup(
        row.merchant_group ?? row.normalized_merchant,
        merchant,
      ),
    };
  });
}

function aggregateSpendCategories(
  transactions: SanitizedAiTransaction[],
): AggregatedSpendCategory[] {
  const bucket = new Map<string, { total: number; count: number }>();

  for (const tx of transactions) {
    if (tx.pending) continue;
    const category = tx.category || 'uncategorized';
    const current = bucket.get(category) || { total: 0, count: 0 };
    current.total += Math.abs(tx.amount);
    current.count += 1;
    bucket.set(category, current);
  }

  return [...bucket.entries()]
    .map(([category, value]) => ({
      category,
      total_spend: Math.round(value.total * 100) / 100,
      transaction_count: value.count,
    }))
    .sort((a, b) => b.total_spend - a.total_spend);
}

export function buildSafeSpendingDataset(
  rows: Array<Record<string, unknown>>,
): SafeAiSpendingDataset {
  const normalizedTransactions = sanitizeTransactionsForAi(rows);
  const merchantNames = Array.from(
    new Set(
      normalizedTransactions
        .map((tx) => tx.merchant)
        .filter((merchant) => merchant && merchant !== 'Unknown Merchant'),
    ),
  ).slice(0, 500);

  return {
    normalizedTransactions,
    merchantNames,
    aggregatedSpendCategories: aggregateSpendCategories(normalizedTransactions),
  };
}

