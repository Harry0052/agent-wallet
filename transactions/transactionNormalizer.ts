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
  category_detailed: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  payment_channel: string | null;
  authorized_date: string | null;
  original_description: string | null;
  logo_url: string | null;
  merchant_entity_id: string | null;
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
    category_detailed: input.raw.personal_finance_category?.detailed?.toLowerCase() ?? null,
    pending: Boolean(input.raw.pending),
    pending_transaction_id: input.raw.pending_transaction_id ?? null,
    payment_channel: input.raw.payment_channel ?? null,
    authorized_date: input.raw.authorized_date ?? null,
    original_description: input.raw.name ?? null,
    logo_url: input.raw.logo_url ?? null,
    merchant_entity_id: input.raw.merchant_entity_id ?? null,
    occurred_at: normalizeOccurredAt(input.raw),
  };
}
