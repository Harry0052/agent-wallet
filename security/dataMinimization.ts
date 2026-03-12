import 'server-only';

const TRANSACTION_METADATA_KEY_MAP: Record<string, string> = {
  payment_flow_id: 'payment_flow_id',
  payment_intent_id: 'payment_intent_id',
  idempotency_key: 'idempotency_key',
  error_code: 'error_code',
  error_message: 'error_message',
  refund_reason: 'refund_reason',
  subscription_merchant: 'subscription_merchant',
  subscription_category: 'subscription_category',
  transaction_category: 'transaction_category',
  category: 'category',
  recipient_id: 'recipient_id',
  recipient_name: 'recipient_name',
  authorization_reference: 'authorization_reference',
  capture_reference: 'capture_reference',
  refund_reference: 'refund_reference',
  wallet_action: 'wallet_action',
  procurement_task_id: 'procurement_task_id',
  tasktitle: 'taskTitle',
  plan_name: 'plan_name',
  amount_basis: 'amount_basis',
  payment_confirmed: 'payment_confirmed',
  provider_reference_id: 'provider_reference_id',
  operation: 'operation',
  projected_basis: 'projected_basis',
  recovery_case_id: 'recovery_case_id',
  original_ledger_entry_id: 'original_ledger_entry_id',
  reversal_reason: 'reversal_reason',
};

export const TRANSACTION_METADATA_ALLOWLIST = new Set(Object.keys(TRANSACTION_METADATA_KEY_MAP));

export const MAX_METADATA_VALUE_LENGTH = 160;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalMetadataKey(rawKey: string): string | null {
  const normalized = normalizeKey(rawKey);
  return TRANSACTION_METADATA_KEY_MAP[normalized] || null;
}

function normalizeScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, MAX_METADATA_VALUE_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).slice(0, MAX_METADATA_VALUE_LENGTH);
  }
  return null;
}

export function minimizeTransactionMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  const output: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    const canonicalKey = canonicalMetadataKey(rawKey);
    if (!canonicalKey) continue;
    const normalized = normalizeScalar(rawValue);
    if (!normalized) continue;
    output[canonicalKey] = normalized;
  }

  return Object.keys(output).length > 0 ? output : null;
}
