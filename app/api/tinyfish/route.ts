import { NextRequest, NextResponse } from 'next/server';
import type { AgentStep, VendorOption } from '@/lib/types';
import { getWalletUserId, recordWebAction } from '@/lib/server/ledger';

export const runtime = 'nodejs';

type TinyFishAction = 'vendor-research' | 'purchase-prepare' | 'purchase-confirm' | 'subscription-operation' | 'search' | 'prepare' | 'confirm';

interface TinyFishUpstream {
  options?: unknown;
  pricing?: unknown;
  steps?: unknown;
  data?: Record<string, unknown>;
  success?: boolean;
  checkoutUrl?: string;
  error?: string;
}

function endpointFor(action: TinyFishAction): string {
  const configured = {
    vendorResearch: process.env.TINYFISH_VENDOR_RESEARCH_PATH,
    purchasePrepare: process.env.TINYFISH_PURCHASE_PREPARE_PATH,
    purchaseConfirm: process.env.TINYFISH_PURCHASE_CONFIRM_PATH,
    subscriptionOp: process.env.TINYFISH_SUBSCRIPTION_OPERATION_PATH,
  };

  if (action === 'vendor-research' || action === 'search') return configured.vendorResearch || '/vendor-research';
  if (action === 'purchase-prepare' || action === 'prepare') return configured.purchasePrepare || '/purchase/prepare';
  if (action === 'purchase-confirm' || action === 'confirm') return configured.purchaseConfirm || '/purchase/confirm';
  return configured.subscriptionOp || '/subscription/operation';
}

function normalizeOptions(raw: unknown): VendorOption[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item): VendorOption | null => {
      if (!item || typeof item !== 'object') return null;
      const value = item as Partial<VendorOption>;
      if (!value.name || !value.item || typeof value.price !== 'number') return null;
      if (!value.url || typeof value.url !== 'string') return null;

      return {
        id: typeof value.id === 'string' ? value.id : crypto.randomUUID(),
        name: String(value.name),
        item: String(value.item),
        price: value.price,
        distance: typeof value.distance === 'string' ? value.distance : undefined,
        rating: typeof value.rating === 'number' ? value.rating : undefined,
        url: value.url,
        tags: Array.isArray(value.tags) ? value.tags.map(String) : undefined,
      };
    })
    .filter((opt): opt is VendorOption => Boolean(opt));
}

function normalizeSteps(raw: unknown, action: TinyFishAction): AgentStep[] {
  if (!Array.isArray(raw)) {
    return [
      {
        id: crypto.randomUUID(),
        type: action === 'vendor-research' || action === 'search' ? 'search' : action === 'subscription-operation' ? 'visit' : 'checkout',
        description: `TinyFish executed ${action}`,
        status: 'done',
        timestamp: new Date().toISOString(),
      },
    ];
  }

  return raw
    .map((item): AgentStep | null => {
      if (!item || typeof item !== 'object') return null;
      const step = item as Partial<AgentStep>;
      if (!step.type || !step.description) return null;
      return {
        id: typeof step.id === 'string' ? step.id : crypto.randomUUID(),
        type: step.type,
        description: step.description,
        status: step.status || 'done',
        url: step.url,
        timestamp: step.timestamp || new Date().toISOString(),
      };
    })
    .filter((step): step is AgentStep => Boolean(step));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action?: TinyFishAction; payload?: Record<string, unknown> };
    if (!body.action) {
      return NextResponse.json({ ok: false, error: 'Missing TinyFish action' }, { status: 400 });
    }

    const apiKey = process.env.TINYFISH_API_KEY;
    const base = process.env.TINYFISH_API_BASE_URL || 'https://api.tinyfish.ai/v1';

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'TINYFISH_API_KEY is not configured' }, { status: 500 });
    }

    const endpoint = endpointFor(body.action);
    const upstream = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body.payload || {}),
      cache: 'no-store',
    });

    const upstreamText = await upstream.text();
    let upstreamJson: TinyFishUpstream;

    try {
      upstreamJson = JSON.parse(upstreamText) as TinyFishUpstream;
    } catch {
      return NextResponse.json({ ok: false, error: `TinyFish non-JSON response: ${upstreamText.slice(0, 200)}` }, { status: 502 });
    }

    if (!upstream.ok) {
      return NextResponse.json({
        ok: false,
        error: upstreamJson.error || `TinyFish request failed (${upstream.status})`,
      }, { status: 502 });
    }

    const steps = normalizeSteps(upstreamJson.steps || upstreamJson.data?.steps, body.action);

    for (const s of steps) {
      await recordWebAction({
        userId: getWalletUserId(),
        taskId: typeof body.payload?.taskId === 'string' ? body.payload.taskId : undefined,
        actionType: s.type,
        url: s.url,
        status: s.status,
        details: { step: s },
      });
    }

    if (body.action === 'vendor-research' || body.action === 'search') {
      const options = normalizeOptions(upstreamJson.options || upstreamJson.data?.options);
      const pricing = upstreamJson.pricing || upstreamJson.data?.pricing;

      if (!Array.isArray(pricing) || pricing.length === 0) {
        return NextResponse.json({ ok: false, error: 'TinyFish returned no pricing evidence' }, { status: 502 });
      }

      if (options.length === 0) {
        return NextResponse.json({ ok: false, error: 'TinyFish returned no usable vendor options' }, { status: 502 });
      }

      return NextResponse.json({
        ok: true,
        data: {
          options,
          pricing,
        },
        steps,
      });
    }

    if (body.action === 'purchase-prepare' || body.action === 'prepare') {
      const checkoutUrl = typeof upstreamJson.checkoutUrl === 'string'
        ? upstreamJson.checkoutUrl
        : typeof upstreamJson.data?.checkoutUrl === 'string'
          ? upstreamJson.data.checkoutUrl
          : undefined;

      return NextResponse.json({
        ok: true,
        data: { checkoutUrl },
        steps,
      });
    }

    if (body.action === 'subscription-operation') {
      const success = Boolean(upstreamJson.success ?? upstreamJson.data?.success);
      const evidenceUrl = typeof upstreamJson.data?.evidenceUrl === 'string' ? upstreamJson.data.evidenceUrl : undefined;

      return NextResponse.json({
        ok: true,
        data: { success, evidenceUrl },
        steps,
      });
    }

    const success = Boolean(upstreamJson.success ?? upstreamJson.data?.success);
    return NextResponse.json({
      ok: true,
      data: { success },
      steps,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'TinyFish execution failed',
    }, { status: 500 });
  }
}
