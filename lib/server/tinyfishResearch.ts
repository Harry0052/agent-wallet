import { randomUUID } from 'node:crypto';
import type { AgentStep } from '@/lib/types';

export interface TinyFishProcurementFinding {
  vendorName: string;
  pricingPageUrl: string;
  planName: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  billingFrequency: string;
  notableFeatures: string[];
  extractionTimestamp: string;
  raw: Record<string, unknown>;
}

interface TinyFishVendorResearchResponse {
  options?: unknown;
  pricing?: unknown;
  steps?: unknown;
  data?: Record<string, unknown>;
  error?: string;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function normalizeSteps(raw: unknown): AgentStep[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item): AgentStep | null => {
      if (!item || typeof item !== 'object') return null;
      const step = item as Partial<AgentStep>;
      if (!step.type || !step.description) return null;

      return {
        id: typeof step.id === 'string' ? step.id : randomUUID(),
        type: step.type,
        description: step.description,
        status: step.status || 'done',
        url: step.url,
        timestamp: step.timestamp || new Date().toISOString(),
      };
    })
    .filter((step): step is AgentStep => Boolean(step));
}

function normalizeFindings(raw: unknown, vendorFallback: string): TinyFishProcurementFinding[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item): TinyFishProcurementFinding | null => {
      if (!item || typeof item !== 'object') return null;

      const row = item as Record<string, unknown>;
      const vendorName = typeof row.vendorName === 'string'
        ? row.vendorName
        : typeof row.vendor === 'string'
          ? row.vendor
          : vendorFallback;

      const pricingPageUrl = typeof row.sourceUrl === 'string'
        ? row.sourceUrl
        : typeof row.pricingPageUrl === 'string'
          ? row.pricingPageUrl
          : typeof row.url === 'string'
            ? row.url
            : '';

      const planName = typeof row.planName === 'string'
        ? row.planName
        : typeof row.plan === 'string'
          ? row.plan
          : typeof row.name === 'string'
            ? row.name
            : '';

      const billingFrequency = typeof row.billingFrequency === 'string'
        ? row.billingFrequency
        : typeof row.interval === 'string'
          ? row.interval
          : 'unknown';

      const monthlyPriceDirect = toNumber(row.monthlyPrice);
      const annualPriceDirect = toNumber(row.annualPrice);
      const basePrice = toNumber(row.price);
      const lowerFreq = billingFrequency.toLowerCase();

      const monthlyPrice = monthlyPriceDirect ?? (lowerFreq.includes('month') ? basePrice : null);
      const annualPrice = annualPriceDirect ?? (lowerFreq.includes('year') || lowerFreq.includes('annual') ? basePrice : null);

      const notableFeatures = toStringList(
        row.keyFeatures ?? row.features ?? row.highlights,
      );

      const extractionTimestamp = typeof row.extractedAt === 'string'
        ? row.extractedAt
        : new Date().toISOString();

      if (!vendorName || !pricingPageUrl || !planName) {
        return null;
      }

      return {
        vendorName,
        pricingPageUrl,
        planName,
        monthlyPrice,
        annualPrice,
        billingFrequency,
        notableFeatures,
        extractionTimestamp,
        raw: row,
      };
    })
    .filter((finding): finding is TinyFishProcurementFinding => Boolean(finding));
}

export async function runTinyFishVendorPricingResearch(input: {
  vendor: string;
  goal: string;
  budgetLimit: number | null;
  mustHaveFeatures: string[];
  comparisonCriteria: string[];
  taskId: string;
}): Promise<{ findings: TinyFishProcurementFinding[]; steps: AgentStep[] }> {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    throw new Error('TINYFISH_API_KEY is not configured');
  }

  const base = process.env.TINYFISH_API_BASE_URL || 'https://api.tinyfish.ai/v1';
  const path = process.env.TINYFISH_VENDOR_RESEARCH_PATH || '/vendor-research';

  const query = `${input.vendor} pricing ${input.goal}`;

  const upstream = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      vendor: input.vendor,
      budgetMax: input.budgetLimit,
      mustHaveFeatures: input.mustHaveFeatures,
      comparisonCriteria: input.comparisonCriteria,
      taskId: input.taskId,
    }),
    cache: 'no-store',
  });

  const rawText = await upstream.text();
  let payload: TinyFishVendorResearchResponse;

  try {
    payload = JSON.parse(rawText) as TinyFishVendorResearchResponse;
  } catch {
    throw new Error(`TinyFish returned non-JSON research response: ${rawText.slice(0, 240)}`);
  }

  if (!upstream.ok) {
    throw new Error(payload.error || `TinyFish research failed (${upstream.status})`);
  }

  const steps = normalizeSteps(payload.steps ?? payload.data?.steps);
  const pricingRaw = payload.pricing ?? payload.data?.pricing;
  const findings = normalizeFindings(pricingRaw, input.vendor);

  if (findings.length === 0) {
    throw new Error(`TinyFish returned no live pricing findings for ${input.vendor}`);
  }

  return {
    findings,
    steps,
  };
}
