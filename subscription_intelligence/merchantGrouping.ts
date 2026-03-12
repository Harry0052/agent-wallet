import "server-only";

export interface TransactionSignal {
  merchant_name: string;
  normalized_merchant: string;
  amount: number;
  occurred_at: string;
  pending: boolean;
}

export interface MerchantTransactionGroup {
  merchant_key: string;
  merchant_display: string;
  transactions: TransactionSignal[];
}

function normalizeMerchantKey(input: TransactionSignal): string {
  const normalized = input.normalized_merchant.trim().toLowerCase();
  if (normalized) {
    return normalized;
  }

  return input.merchant_name.trim().toLowerCase();
}

function selectDisplayMerchant(transactions: TransactionSignal[]): string {
  const latestNamed = [...transactions]
    .reverse()
    .find((tx) => tx.merchant_name.trim().length > 0);
  if (latestNamed) return latestNamed.merchant_name.trim();
  return "Unknown Merchant";
}

export function groupTransactionsByMerchant(
  transactions: TransactionSignal[],
): MerchantTransactionGroup[] {
  const grouped = new Map<string, TransactionSignal[]>();

  for (const tx of transactions) {
    const key = normalizeMerchantKey(tx);
    if (!key) continue;
    const list = grouped.get(key) || [];
    list.push(tx);
    grouped.set(key, list);
  }

  return [...grouped.entries()].map(([merchantKey, merchantTransactions]) => {
    const sorted = [...merchantTransactions].sort(
      (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
    );
    return {
      merchant_key: merchantKey,
      merchant_display: selectDisplayMerchant(sorted),
      transactions: sorted,
    };
  });
}
