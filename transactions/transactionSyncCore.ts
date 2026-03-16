export function dedupeByProviderId<T extends { provider_transaction_id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    const key = row.provider_transaction_id.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

export function dedupeRemovedProviderTransactionIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
}

export function buildTransactionSyncIdempotencyKey(input: {
  plaidItemId: string;
  cursorStart: string | null;
}): string {
  return `${input.plaidItemId}:${input.cursorStart || "origin"}`;
}
