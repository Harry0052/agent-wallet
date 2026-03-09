import { randomUUID } from 'node:crypto';
import type { AgentStep } from '@/lib/types';

export interface TinyFishProcurementFinding {
  vendorName: string;
  pricingPageUrl: string;
  planName: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  billingFrequency: string;
  contentAvailability: string | null;
  notes: string | null;
  notableFeatures: string[];
  extractionTimestamp: string;
  raw: Record<string, unknown>;
}

interface TinyFishVendorResearchResponse {
  candidates?: unknown;
  options?: unknown;
  pricing?: unknown;
  steps?: unknown;
  data?: Record<string, unknown>;
  error?: string;
}

const DISCOVERY_FETCH_TIMEOUT_MS = 15_000;
const DISCOVERY_MAX_ATTEMPTS = 3;
const AUTOMATION_FETCH_TIMEOUT_MS = 30_000;

function tinyFishHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
  };
}

function collectTextFragments(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTextFragments(item, output));
    return;
  }

  if (!value || typeof value !== 'object') return;

  const row = value as Record<string, unknown>;
  const interestingKeys = ['text', 'message', 'result', 'output', 'content', 'final', 'answer', 'delta'];
  for (const key of interestingKeys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      collectTextFragments(row[key], output);
    }
  }
}

function extractJsonTextFromMixedContent(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('TinyFish automation returned empty payload');
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  throw new Error(`TinyFish automation returned non-JSON output: ${trimmed.slice(0, 220)}`);
}

function parseAutomationSsePayload(rawText: string): Record<string, unknown> {
  const lines = rawText.split(/\r?\n/);
  const fragments: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;

    try {
      const parsed = JSON.parse(data) as unknown;
      collectTextFragments(parsed, fragments);
    } catch {
      fragments.push(data);
    }
  }

  const joined = fragments.join('\n').trim();
  const jsonText = extractJsonTextFromMixedContent(joined || rawText);
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TinyFish automation JSON root must be an object');
  }
  return parsed as Record<string, unknown>;
}

async function runTinyFishAutomationSse(params: {
  apiKey: string;
  goal: string;
}): Promise<Record<string, unknown>> {
  const endpoint = process.env.TINYFISH_AUTOMATION_RUN_SSE_URL || 'https://agent.tinyfish.ai/v1/automation/run-sse';
  const startUrl = process.env.TINYFISH_AUTOMATION_START_URL || 'https://www.google.com';

  const upstream = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: startUrl,
      goal: params.goal,
    }),
    cache: 'no-store',
  }, AUTOMATION_FETCH_TIMEOUT_MS);

  const rawText = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`TinyFish automation request failed (${upstream.status}): ${rawText.slice(0, 220)}`);
  }

  return parseAutomationSsePayload(rawText);
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

      const contentAvailability = typeof row.contentAvailability === 'string'
        ? row.contentAvailability
        : typeof row.availability === 'string'
          ? row.availability
          : null;

      const notes = typeof row.notes === 'string'
        ? row.notes
        : typeof row.note === 'string'
          ? row.note
          : null;

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
        contentAvailability,
        notes,
        notableFeatures,
        extractionTimestamp,
        raw: row,
      };
    })
    .filter((finding): finding is TinyFishProcurementFinding => Boolean(finding));
}

function normalizeVendorCandidates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names = raw.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>;
      if (typeof row.vendor === 'string') return row.vendor.trim();
      if (typeof row.vendorName === 'string') return row.vendorName.trim();
      if (typeof row.name === 'string') return row.name.trim();
    }
    return '';
  }).filter(Boolean);

  return Array.from(new Set(names));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryDiscoveryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverTinyFishVendorCandidates(input: {
  goal: string;
  category?: string | null;
  existingTargets?: string[];
  maxCandidates?: number;
}): Promise<string[]> {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    throw new Error('TINYFISH_API_KEY is not configured');
  }

  const base = process.env.TINYFISH_API_BASE_URL || 'https://api.tinyfish.ai/v1';
  const path = process.env.TINYFISH_VENDOR_DISCOVERY_PATH || '/vendor-discovery';
  const requestUrl = `${base}${path}`;
  const requestInit: RequestInit = {
    method: 'POST',
    headers: tinyFishHeaders(apiKey),
    body: JSON.stringify({
      goal: input.goal,
      category: input.category || undefined,
      existingTargets: input.existingTargets || [],
      maxCandidates: input.maxCandidates || 10,
    }),
    cache: 'no-store',
  };

  try {
    let upstream: Response | null = null;
    let rawText = '';
    let lastRequestError: unknown = null;

    for (let attempt = 1; attempt <= DISCOVERY_MAX_ATTEMPTS; attempt += 1) {
      try {
        upstream = await fetchWithTimeout(requestUrl, requestInit, DISCOVERY_FETCH_TIMEOUT_MS);
        rawText = await upstream.text();
        if (shouldRetryDiscoveryStatus(upstream.status) && attempt < DISCOVERY_MAX_ATTEMPTS) {
          await sleep(250 * attempt);
          continue;
        }
        break;
      } catch (error) {
        lastRequestError = error;
        if (attempt >= DISCOVERY_MAX_ATTEMPTS) {
          break;
        }
        await sleep(250 * attempt);
      }
    }

    if (!upstream) {
      const reason = lastRequestError instanceof Error ? lastRequestError.message : 'fetch failed';
      throw new Error(`TinyFish vendor discovery request failed after ${DISCOVERY_MAX_ATTEMPTS} attempts: ${reason}`);
    }

    let payload: TinyFishVendorResearchResponse;

    try {
      payload = JSON.parse(rawText) as TinyFishVendorResearchResponse;
    } catch {
      throw new Error(`TinyFish vendor discovery returned non-JSON response: ${rawText.slice(0, 240)}`);
    }

    if (!upstream.ok) {
      throw new Error(payload.error || `TinyFish vendor discovery failed (${upstream.status})`);
    }

    const candidates = normalizeVendorCandidates(payload.candidates ?? payload.data?.candidates);
    if (candidates.length === 0) {
      throw new Error('TinyFish vendor discovery returned zero candidates');
    }

    return candidates.slice(0, input.maxCandidates || 10);
  } catch (legacyError) {
    const fallbackGoal = [
      'Find candidate vendors for the following procurement request and return JSON only.',
      'Output schema: {"candidates":["Vendor A","Vendor B","Vendor C"]}',
      'Do not include pricing or explanation text.',
      `Goal: ${input.goal}`,
      `Category: ${input.category || 'unknown'}`,
      `Existing targets: ${JSON.stringify(input.existingTargets || [])}`,
      `Max candidates: ${input.maxCandidates || 10}`,
    ].join('\n');

    try {
      const payload = await runTinyFishAutomationSse({
        apiKey,
        goal: fallbackGoal,
      });
      const payloadData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? payload.data as Record<string, unknown>
        : null;
      const candidates = normalizeVendorCandidates(payload.candidates ?? payloadData?.candidates);
      if (candidates.length === 0) {
        throw new Error('TinyFish automation returned zero vendor candidates');
      }
      return candidates.slice(0, input.maxCandidates || 10);
    } catch (fallbackError) {
      const legacyReason = legacyError instanceof Error ? legacyError.message : 'legacy vendor discovery failed';
      const fallbackReason = fallbackError instanceof Error ? fallbackError.message : 'automation vendor discovery failed';
      throw new Error(`TinyFish vendor discovery failed. Legacy: ${legacyReason}. Automation: ${fallbackReason}`);
    }
  }
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

  try {
    const upstream = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: tinyFishHeaders(apiKey),
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
  } catch (legacyError) {
    const fallbackGoal = [
      'Extract live pricing plans for the specified vendor and return strict JSON only.',
      'Output schema:',
      '{"pricing":[{"vendorName":"string","sourceUrl":"https://...","planName":"string","monthlyPrice":number|null,"annualPrice":number|null,"billingFrequency":"monthly|annual|one_time|unknown","contentAvailability":"string|null","notes":"string|null","keyFeatures":["string"]}],"steps":[{"type":"visit|extract|compare","description":"string","status":"done|running|error","url":"https://..."}]}',
      `Vendor: ${input.vendor}`,
      `Goal: ${input.goal}`,
      `Budget max: ${input.budgetLimit === null ? 'none' : input.budgetLimit}`,
      `Must have features: ${JSON.stringify(input.mustHaveFeatures || [])}`,
      `Comparison criteria: ${JSON.stringify(input.comparisonCriteria || [])}`,
      'Do not include prose, markdown, or explanation outside the JSON object.',
    ].join('\n');

    try {
      const payload = await runTinyFishAutomationSse({
        apiKey,
        goal: fallbackGoal,
      });

      const steps = normalizeSteps((payload as { steps?: unknown }).steps);
      const findings = normalizeFindings((payload as { pricing?: unknown }).pricing, input.vendor);
      if (findings.length === 0) {
        throw new Error(`TinyFish automation returned no live pricing findings for ${input.vendor}`);
      }

      return {
        findings,
        steps,
      };
    } catch (fallbackError) {
      const legacyReason = legacyError instanceof Error ? legacyError.message : 'legacy vendor research failed';
      const fallbackReason = fallbackError instanceof Error ? fallbackError.message : 'automation vendor research failed';
      throw new Error(`TinyFish vendor research failed for ${input.vendor}. Legacy: ${legacyReason}. Automation: ${fallbackReason}`);
    }
  }
}
