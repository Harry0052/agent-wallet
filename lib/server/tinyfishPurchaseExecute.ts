import { randomUUID } from 'node:crypto';
import type { AgentStep } from '@/lib/types';
import { getRequiredSecret } from '@/security/secretsManager';

interface TinyFishPurchaseConfirmResponse {
  steps?: unknown;
  success?: unknown;
  data?: Record<string, unknown>;
  error?: string;
}

function normalizeSteps(raw: unknown): AgentStep[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item): AgentStep | null => {
      if (!item || typeof item !== 'object') return null;
      const value = item as Partial<AgentStep>;
      if (!value.type || !value.description) return null;

      return {
        id: typeof value.id === 'string' ? value.id : randomUUID(),
        type: value.type,
        description: value.description,
        status: value.status || 'done',
        url: value.url,
        timestamp: value.timestamp || new Date().toISOString(),
      };
    })
    .filter((step): step is AgentStep => Boolean(step));
}

function normalizeProviderReference(payload: TinyFishPurchaseConfirmResponse): string | null {
  const value = payload.data?.providerReferenceId
    || payload.data?.paymentIntentId
    || payload.data?.chargeId
    || payload.data?.orderId;

  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

export async function runTinyFishPurchaseExecution(params: {
  taskId: string;
  vendorName: string;
  checkoutUrl: string;
  amount: number | null;
  currency: string;
}): Promise<{
  success: boolean;
  steps: AgentStep[];
  providerReferenceId: string | null;
}> {
  const apiKey = getRequiredSecret('TINYFISH_API_KEY');

  const base = process.env.TINYFISH_API_BASE_URL || 'https://api.tinyfish.ai/v1';
  const path = process.env.TINYFISH_PURCHASE_CONFIRM_PATH || '/purchase/confirm';

  const upstream = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      taskId: params.taskId,
      vendor: params.vendorName,
      checkoutUrl: params.checkoutUrl,
      targetAmount: params.amount,
      currency: params.currency,
      objective: `Confirm payment for ${params.vendorName} only after wallet policy-approved execution.`,
    }),
    cache: 'no-store',
  });

  const rawText = await upstream.text();
  let payload: TinyFishPurchaseConfirmResponse;
  try {
    payload = JSON.parse(rawText) as TinyFishPurchaseConfirmResponse;
  } catch {
    throw new Error(`TinyFish returned non-JSON purchase-confirm response: ${rawText.slice(0, 240)}`);
  }

  if (!upstream.ok) {
    throw new Error(payload.error || `TinyFish purchase-confirm failed (${upstream.status})`);
  }

  return {
    success: Boolean(payload.success ?? payload.data?.success),
    steps: normalizeSteps(payload.steps ?? payload.data?.steps),
    providerReferenceId: normalizeProviderReference(payload),
  };
}
