import type { AgentStep, EvidenceRecord, VendorOption } from '@/lib/types';

interface TinyFishApiResponse<T> {
  ok: boolean;
  data?: T;
  steps?: AgentStep[];
  error?: string;
}

interface VendorResearchResult {
  options: VendorOption[];
  pricing: EvidenceRecord[];
}

async function callTinyFish<T>(action: string, payload: unknown): Promise<TinyFishApiResponse<T>> {
  const res = await fetch('/api/tinyfish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });

  const body = (await res.json()) as TinyFishApiResponse<T>;

  if (!res.ok) {
    throw new Error(body.error || `TinyFish request failed (${res.status})`);
  }

  if (!body.ok) {
    throw new Error(body.error || 'TinyFish returned a failed response');
  }

  return body;
}

export async function runVendorResearchTask(input: {
  query: string;
  location?: string;
  budgetMax?: number;
}): Promise<{ result: VendorResearchResult; steps: AgentStep[] }> {
  const response = await callTinyFish<VendorResearchResult>('vendor-research', input);
  if (!response.data || !Array.isArray(response.data.options) || response.data.options.length === 0) {
    throw new Error('TinyFish returned no live vendor options');
  }

  if (!Array.isArray(response.data.pricing) || response.data.pricing.length === 0) {
    throw new Error('TinyFish returned no live pricing evidence');
  }

  return {
    result: response.data,
    steps: response.steps || [],
  };
}

export async function searchOptions(
  intent: string,
  location?: string,
  maxBudget?: number,
) : Promise<{ options: VendorOption[]; pricing: EvidenceRecord[]; steps: AgentStep[] }> {
  const { result, steps } = await runVendorResearchTask({
    query: intent,
    location,
    budgetMax: maxBudget,
  });

  return {
    options: result.options,
    pricing: result.pricing,
    steps,
  };
}

export async function preparePurchaseFlow(
  option: VendorOption,
): Promise<{ checkoutUrl?: string; steps: AgentStep[] }> {
  const response = await callTinyFish<{ checkoutUrl?: string }>('purchase-prepare', { option });
  return {
    checkoutUrl: response.data?.checkoutUrl,
    steps: response.steps || [],
  };
}

export async function executeSubscriptionOperation(input: {
  service: string;
  operation: 'renewal-check' | 'downgrade' | 'cancel' | 'switch';
  context?: string;
}): Promise<{ steps: AgentStep[]; success: boolean; evidenceUrl?: string }> {
  const response = await callTinyFish<{ success: boolean; evidenceUrl?: string }>('subscription-operation', input);
  return {
    steps: response.steps || [],
    success: Boolean(response.data?.success),
    evidenceUrl: response.data?.evidenceUrl,
  };
}

export async function prepareCheckout(
  option: VendorOption,
): Promise<{ steps: AgentStep[]; checkoutUrl: string }> {
  const { steps, checkoutUrl } = await preparePurchaseFlow(option);
  return {
    steps,
    checkoutUrl: checkoutUrl || option.url || '',
  };
}

export async function confirmPurchase(
  option: VendorOption,
): Promise<{ steps: AgentStep[]; success: boolean }> {
  const response = await callTinyFish<{ success: boolean }>('purchase-confirm', { option });
  return {
    steps: response.steps || [],
    success: Boolean(response.data?.success),
  };
}
