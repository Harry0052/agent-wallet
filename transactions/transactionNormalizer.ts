import "server-only";

import type { PlaidSyncTransaction } from "@/financial_connectors/plaidClient";

export interface NormalizedTransactionInput {
  user_id: string;
  linked_account_id: string;
  raw: PlaidSyncTransaction;
}

export interface NormalizedTransactionRecord {
  user_id: string;
  linked_account_id: string;
  provider_transaction_id: string;
  merchant_name: string;
  normalized_merchant: string;
  amount: number;
  currency: string;
  category: string;
  pending: boolean;
  occurred_at: string;
}

function normalizeMerchantName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCurrency(
  isoCurrencyCode: string | null,
  unofficialCurrencyCode: string | null,
): string {
  const preferred = (isoCurrencyCode || unofficialCurrencyCode || "USD").trim();
  const upper = preferred.toUpperCase();
  return upper.length >= 3 ? upper.slice(0, 3) : "USD";
}

function normalizeCategory(raw: PlaidSyncTransaction): string {
  if (raw.personal_finance_category?.primary) {
    return raw.personal_finance_category.primary.toLowerCase();
  }
  if (raw.category && raw.category.length > 0) {
    return raw.category[0].toLowerCase();
  }
  return "uncategorized";
}

function normalizeOccurredAt(raw: PlaidSyncTransaction): string {
  const source = raw.authorized_date || raw.date;
  if (!source) {
    return new Date().toISOString();
  }
  const parsed = Date.parse(source);
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

export function normalizePlaidTransaction(
  input: NormalizedTransactionInput,
): NormalizedTransactionRecord {
  const merchantName = (input.raw.merchant_name || input.raw.name || "Unknown Merchant").trim();

  return {
    user_id: input.user_id,
    linked_account_id: input.linked_account_id,
    provider_transaction_id: input.raw.transaction_id,
    merchant_name: merchantName,
    normalized_merchant: normalizeMerchantName(merchantName),
    amount: Number(input.raw.amount),
    currency: normalizeCurrency(
      input.raw.iso_currency_code,
      input.raw.unofficial_currency_code,
    ),
    category: normalizeCategory(input.raw),
    pending: Boolean(input.raw.pending),
    occurred_at: normalizeOccurredAt(input.raw),
  };
}
