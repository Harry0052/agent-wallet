import { randomUUID } from 'node:crypto';
import type { AgentStep, SubscriptionOperationType } from '@/lib/types';

interface TinyFishSubscriptionResponse {
  success?: boolean;
  steps?: unknown;
  data?: Record<string, unknown>;
  error?: string;
}

function toStepList(raw: unknown): AgentStep[] {
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

function toUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter((url) => /^https?:\/\//i.test(url));
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractEvidence(payload: TinyFishSubscriptionResponse): string[] {
  const data = payload.data || {};
  const direct = typeof data.evidenceUrl === 'string' && /^https?:\/\//i.test(data.evidenceUrl)
    ? [data.evidenceUrl]
    : [];
  const evidenceUrls = toUrls(data.evidenceUrls);
  const proofUrls = toUrls(data.proofUrls);
  const screenshots = toUrls(data.screenshots);
  const captures = toUrls(data.captures);
  const trace = typeof data.traceUrl === 'string' && /^https?:\/\//i.test(data.traceUrl)
    ? [data.traceUrl]
    : [];
  return Array.from(new Set([...direct, ...evidenceUrls, ...proofUrls, ...screenshots, ...captures, ...trace]));
}

function detectCredentialBlocker(message: string): string | null {
  const normalized = message.toLowerCase();
  const blockers = ['login', 'sign in', 'session', 'credentials', 'authentication', '2fa', 'captcha'];
  if (!blockers.some((token) => normalized.includes(token))) return null;
  return message;
}

function mapOperation(operation: SubscriptionOperationType): string {
  if (operation === 'inspect_billing') return 'inspect-billing';
  if (operation === 'renewal_check') return 'renewal-check';
  if (operation === 'switch_billing') return 'switch-billing';
  return operation;
}

export async function runTinyFishSubscriptionOperation(params: {
  taskId: string;
  service: string;
  planName: string;
  sourceUrl: string;
  operation: SubscriptionOperationType;
}): Promise<{
  success: boolean;
  steps: AgentStep[];
  evidenceUrls: string[];
  projectedSavings: number | null;
  projectedSavingsBasis: 'monthly' | 'annual' | 'unknown';
  renewalDate?: string;
  summary: string;
  blocker?: string;
  raw: Record<string, unknown>;
}> {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    throw new Error('TINYFISH_API_KEY is not configured');
  }

  const base = process.env.TINYFISH_API_BASE_URL || 'https://api.tinyfish.ai/v1';
  const path = process.env.TINYFISH_SUBSCRIPTION_OPERATION_PATH || '/subscription/operation';

  const upstream = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      taskId: params.taskId,
      service: params.service,
      plan: params.planName,
      sourceUrl: params.sourceUrl,
      operation: mapOperation(params.operation),
      context: `Perform ${params.operation} on live ${params.service} subscription flow.`,
    }),
    cache: 'no-store',
  });

  const rawText = await upstream.text();
  let payload: TinyFishSubscriptionResponse;
  try {
    payload = JSON.parse(rawText) as TinyFishSubscriptionResponse;
  } catch {
    throw new Error(`TinyFish returned non-JSON subscription response: ${rawText.slice(0, 240)}`);
  }

  if (!upstream.ok) {
    throw new Error(payload.error || `TinyFish subscription operation failed (${upstream.status})`);
  }

  const success = Boolean(payload.success ?? payload.data?.success);
  const steps = toStepList(payload.steps ?? payload.data?.steps);
  const evidenceUrls = extractEvidence(payload);
  const projectedSavings = toNumber(payload.data?.projectedSavings ?? payload.data?.savingsAmount);
  const basisRaw = String(payload.data?.projectedSavingsBasis ?? payload.data?.savingsPeriod ?? '').toLowerCase();
  const projectedSavingsBasis = basisRaw.includes('month')
    ? 'monthly'
    : basisRaw.includes('year') || basisRaw.includes('annual')
      ? 'annual'
      : 'unknown';
  const renewalDate = typeof payload.data?.renewalDate === 'string'
    ? payload.data.renewalDate
    : typeof payload.data?.nextBillingDate === 'string'
      ? payload.data.nextBillingDate
      : undefined;

  const summary = typeof payload.data?.summary === 'string'
    ? payload.data.summary
    : typeof payload.data?.message === 'string'
      ? payload.data.message
      : success
        ? `${params.operation} completed on live web flow`
        : `Subscription operation ${params.operation} did not complete`;

  const blocker = detectCredentialBlocker(
    `${payload.error || ''} ${typeof payload.data?.message === 'string' ? payload.data.message : ''}`.trim(),
  ) || (typeof payload.data?.blocker === 'string' ? payload.data.blocker : undefined);

  return {
    success,
    steps,
    evidenceUrls,
    projectedSavings,
    projectedSavingsBasis,
    renewalDate,
    summary,
    blocker,
    raw: (payload.data || {}) as Record<string, unknown>,
  };
}
