import { randomUUID } from 'node:crypto';
import type { AgentStep } from '@/lib/types';

interface TinyFishPurchasePrepResponse {
  steps?: unknown;
  checkoutUrl?: unknown;
  proofUrls?: unknown;
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

function collectStringUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item).trim())
    .filter((value) => /^https?:\/\//i.test(value));
}

function normalizeProofUrls(payload: TinyFishPurchasePrepResponse): string[] {
  const direct = collectStringUrls(payload.proofUrls);
  const fromData = collectStringUrls(payload.data?.proofUrls);
  const screenshots = collectStringUrls(payload.data?.screenshots);
  const evidence = collectStringUrls(payload.data?.evidenceUrls);
  const captures = collectStringUrls(payload.data?.captures);
  const trace = typeof payload.data?.traceUrl === 'string' && /^https?:\/\//i.test(payload.data.traceUrl)
    ? [payload.data.traceUrl]
    : [];

  return Array.from(new Set([...direct, ...fromData, ...screenshots, ...evidence, ...captures, ...trace]));
}

function normalizeCheckoutUrl(payload: TinyFishPurchasePrepResponse): string | undefined {
  const candidate = typeof payload.checkoutUrl === 'string'
    ? payload.checkoutUrl
    : typeof payload.data?.checkoutUrl === 'string'
      ? payload.data.checkoutUrl
      : typeof payload.data?.currentUrl === 'string'
        ? payload.data.currentUrl
        : undefined;

  if (!candidate) return undefined;
  return /^https?:\/\//i.test(candidate) ? candidate : undefined;
}

export async function runTinyFishPurchasePreparation(params: {
  taskId: string;
  vendorName: string;
  planName: string;
  pricingPageUrl: string;
  amount: number | null;
  amountBasis: 'monthly' | 'annual' | 'unknown';
}): Promise<{
  steps: AgentStep[];
  checkoutUrl?: string;
  proofUrls: string[];
}> {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    throw new Error('TINYFISH_API_KEY is not configured');
  }

  const base = process.env.TINYFISH_API_BASE_URL || 'https://api.tinyfish.ai/v1';
  const path = process.env.TINYFISH_PURCHASE_PREPARE_PATH || '/purchase/prepare';

  const upstream = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      taskId: params.taskId,
      vendor: params.vendorName,
      plan: params.planName,
      sourceUrl: params.pricingPageUrl,
      targetAmount: params.amount,
      amountBasis: params.amountBasis,
      mode: 'prepare_only',
      stopBeforePayment: true,
      objective: `Prepare ${params.vendorName} ${params.planName} purchase flow and stop before payment confirmation.`,
    }),
    cache: 'no-store',
  });

  const rawText = await upstream.text();
  let payload: TinyFishPurchasePrepResponse;
  try {
    payload = JSON.parse(rawText) as TinyFishPurchasePrepResponse;
  } catch {
    throw new Error(`TinyFish returned non-JSON purchase-prep response: ${rawText.slice(0, 240)}`);
  }

  if (!upstream.ok) {
    throw new Error(payload.error || `TinyFish purchase-prep failed (${upstream.status})`);
  }

  const steps = normalizeSteps(payload.steps ?? payload.data?.steps);
  const checkoutUrl = normalizeCheckoutUrl(payload);
  const proofUrls = normalizeProofUrls(payload);

  if (steps.length === 0 && !checkoutUrl && proofUrls.length === 0) {
    throw new Error('TinyFish purchase-prep returned no executable steps or proof artifacts');
  }

  return {
    steps,
    checkoutUrl,
    proofUrls,
  };
}
