import { NextRequest, NextResponse } from 'next/server';
import type { AgentStep, VendorOption } from '@/lib/types';
import { getWalletUserId, recordWebAction } from '@/lib/server/ledger';
import { mapErrorToFailure } from '@/lib/failures/mapError';
import { FailureSource } from '@/lib/failures/codes';

export const runtime = 'nodejs';

type TinyFishAction =
  | 'vendor-discovery'
  | 'vendor-research'
  | 'purchase-prepare'
  | 'purchase-confirm'
  | 'subscription-operation'
  | 'signup-prepare'
  | 'signup-finalize'
  | 'search'
  | 'prepare'
  | 'confirm';

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
  if (action === 'vendor-discovery') return process.env.TINYFISH_VENDOR_DISCOVERY_PATH || '/vendor-discovery';
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
        type: action === 'vendor-research' || action === 'search' ? 'search'
          : action === 'subscription-operation' ? 'visit'
          : action === 'signup-prepare' || action === 'signup-finalize' ? 'form-fill'
          : 'checkout',
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

// ---------------------------------------------------------------------------
// SSE automation helpers (used for signup actions)
// ---------------------------------------------------------------------------

/**
 * Parse TinyFish SSE automation response.
 *
 * The SSE stream contains structured events (STARTED, STREAMING_URL, PROGRESS,
 * COMPLETE). The final result lives inside the COMPLETE event's `resultJson`
 * (or `result_json` / `result`) field. We scan every `data:` line, parse it as
 * JSON, and look for the terminal event first. If no terminal event is found we
 * fall back to extracting any JSON-shaped content from the raw text.
 */
function parseAutomationSsePayload(rawText: string): Record<string, unknown> {
  const lines = rawText.split(/\r?\n/);
  const parsedEvents: Record<string, unknown>[] = [];

  // ---- Step 1: collect all parsed data payloads ----
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedEvents.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Non-JSON data line – skip
    }
  }

  // ---- Step 2: find the COMPLETE / terminal event ----
  const terminalTypes = new Set([
    'COMPLETE', 'COMPLETED', 'DONE', 'FINISHED', 'FINAL',
    'SUCCESS', 'SUCCEEDED', 'FAILED', 'ERROR', 'CANCELED', 'CANCELLED',
  ]);

  for (const evt of parsedEvents) {
    const evtType = String(evt.type || evt.event || evt.kind || evt.status || '').toUpperCase().trim();
    if (!terminalTypes.has(evtType)) continue;

    // The result payload can live under several keys
    const resultPayload = evt.resultJson ?? evt.result_json ?? evt.result ?? evt.data;

    if (resultPayload && typeof resultPayload === 'object' && !Array.isArray(resultPayload)) {
      return resultPayload as Record<string, unknown>;
    }

    // resultJson might be a JSON string
    if (typeof resultPayload === 'string') {
      const trimmedResult = resultPayload.trim();
      try { return JSON.parse(trimmedResult) as Record<string, unknown>; } catch { /* fall through */ }

      // Try extracting JSON from inside fenced code block
      const fenced = trimmedResult.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced?.[1]) {
        try { return JSON.parse(fenced[1].trim()) as Record<string, unknown>; } catch { /* fall through */ }
      }

      // Try extracting first JSON object
      const fb = trimmedResult.indexOf('{');
      const lb = trimmedResult.lastIndexOf('}');
      if (fb >= 0 && lb > fb) {
        try { return JSON.parse(trimmedResult.slice(fb, lb + 1)) as Record<string, unknown>; } catch { /* fall through */ }
      }
    }

    // The terminal event itself may contain the fields we need (success, plan, price…)
    // Return the entire event minus the internal SSE metadata
    const { type: _t, event: _e, kind: _k, timestamp: _ts, runId: _r, ...rest } = evt;
    if (Object.keys(rest).length > 0) {
      return rest;
    }
  }

  // ---- Step 3: fallback – check if the last parsed event has useful data ----
  if (parsedEvents.length > 0) {
    const last = parsedEvents[parsedEvents.length - 1];
    const resultPayload = last.resultJson ?? last.result_json ?? last.result ?? last.data;
    if (resultPayload && typeof resultPayload === 'object' && !Array.isArray(resultPayload)) {
      return resultPayload as Record<string, unknown>;
    }
    if (typeof resultPayload === 'string') {
      try { return JSON.parse(resultPayload) as Record<string, unknown>; } catch { /* fall through */ }
    }
    // Return the last event itself as a fallback
    const { type: _t, event: _e, kind: _k, timestamp: _ts, runId: _r, ...rest } = last;
    if (Object.keys(rest).length > 0) {
      return rest;
    }
  }

  // ---- Step 4: ultimate fallback – try to extract JSON from raw text ----
  const rawTrimmed = rawText.trim();
  const firstBrace = rawTrimmed.indexOf('{');
  const lastBrace = rawTrimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(rawTrimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>; } catch { /* fall through */ }
  }

  return {
    success: false,
    error_message: 'Automation result parsing failed',
    debug_excerpt: rawTrimmed.slice(0, 160),
  };
}

async function runSignupAutomation(apiKey: string, goal: string, startUrl: string): Promise<Record<string, unknown>> {
  const endpoint = process.env.TINYFISH_AUTOMATION_RUN_SSE_URL || 'https://agent.tinyfish.ai/v1/automation/run-sse';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // 3 minute timeout

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: startUrl, goal }),
      cache: 'no-store',
      signal: controller.signal,
    });

    const rawText = await upstream.text();
    if (!upstream.ok) {
      throw new Error(`TinyFish automation failed (${upstream.status}): ${rawText.slice(0, 220)}`);
    }

    return parseAutomationSsePayload(rawText);
  } finally {
    clearTimeout(timeout);
  }
}

function buildSignupPrepareGoal(payload: Record<string, unknown>): string {
  const service = String(payload.service || 'the service');
  const plan = payload.plan ? ` on the ${String(payload.plan)} plan` : '';

  return `Go to ${service}'s website and navigate to their signup/subscription page${plan}.

Find the plan details including:
- The exact plan name
- The monthly or annual price
- The billing cycle (monthly, annual, etc.)

DO NOT enter any payment information. DO NOT complete the purchase.
Stop before any payment step.

Return JSON in this shape:
{
  "success": true,
  "plan": "plan name found",
  "price": 6.99,
  "billingCycle": "monthly",
  "signupUrl": "the URL of the signup/pricing page you found"
}

If the plan or pricing cannot be found, return:
{
  "success": false,
  "error_message": "description of what went wrong"
}`;
}

function buildSignupFinalizeGoal(payload: Record<string, unknown>): string {
  const service = String(payload.service || 'the service');

  return `Complete the signup/subscription process for ${service}.

Use the wallet's payment method to complete the purchase.
Fill in any remaining required fields.

Return JSON in this shape:
{
  "success": true,
  "loginIdentifierMasked": "h***@gmail.com",
  "subscriptionAdded": true
}

If signup cannot be completed, return:
{
  "success": false,
  "blocker": {
    "code": "reason_code",
    "message": "description of what blocked completion"
  }
}`;
}

function normalizeFailure(stage: 'signup' | 'activation', merchant: string, rawMessage?: string): {
  code: string;
  stage: 'signup' | 'activation';
  message: string;
  recoverable: boolean;
  details: Record<string, unknown>;
} {
  const mapped = mapErrorToFailure({
    message: rawMessage || `Signup failure at ${stage}`,
    source: FailureSource.MERCHANT,
    merchant,
    stage,
    paymentStatus: stage === 'activation' ? 'captured' : 'unknown',
    activationStatus: stage === 'activation' ? 'FAILED' : 'UNKNOWN',
  });

  return {
    code: mapped.code,
    stage,
    message: mapped.userMessage,
    recoverable: mapped.recoverable,
    details: {
      detectionReason: mapped.detectionReason,
      confidence: mapped.confidence,
      rawMessage: rawMessage || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Main POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action?: TinyFishAction; payload?: Record<string, unknown> };
    if (!body.action) {
      return NextResponse.json({ ok: false, error: 'Missing TinyFish action' }, { status: 400 });
    }

    const apiKey = process.env.TINYFISH_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'TINYFISH_API_KEY is not configured' }, { status: 500 });
    }

    // -------------------------------------------------------------------
    // Signup actions use SSE automation (no dedicated v1 endpoints)
    // -------------------------------------------------------------------
    if (body.action === 'signup-prepare' || body.action === 'signup-finalize') {
      const payload = body.payload || {};
      const service = String(payload.service || '');
      const signupUrl = typeof payload.signupUrl === 'string' && payload.signupUrl
        ? payload.signupUrl
        : service ? `https://www.${service.toLowerCase().replace(/\s+/g, '')}.com` : 'https://www.google.com';

      const goal = body.action === 'signup-prepare'
        ? buildSignupPrepareGoal(payload)
        : buildSignupFinalizeGoal(payload);

      const result = await runSignupAutomation(apiKey, goal, signupUrl);
      const steps = normalizeSteps(result.steps, body.action);

      for (const s of steps) {
        await recordWebAction({
          userId: getWalletUserId(),
          taskId: typeof payload.taskId === 'string' ? payload.taskId : undefined,
          actionType: s.type,
          url: s.url,
          status: s.status,
          details: { step: s },
        });
      }

      if (body.action === 'signup-prepare') {
        const success = Boolean(result.success ?? result.status === 'success');
        const plan = typeof result.plan === 'string' ? result.plan
          : typeof result.plan_name === 'string' ? result.plan_name
          : typeof result.planName === 'string' ? result.planName : undefined;
        const rawPrice = result.price;
        const price = typeof rawPrice === 'number' ? rawPrice
          : typeof rawPrice === 'string' ? parseFloat(rawPrice.replace(/[^0-9.-]/g, '')) || undefined
          : undefined;
        const billingCycle = typeof result.billingCycle === 'string' ? result.billingCycle
          : typeof result.billing_cycle === 'string' ? result.billing_cycle
          : typeof result.billingPeriod === 'string' ? result.billingPeriod
          : typeof result.billing_period === 'string' ? result.billing_period : undefined;
        const signupUrl = typeof result.signupUrl === 'string' ? result.signupUrl
          : typeof result.signup_url === 'string' ? result.signup_url
          : typeof result.url === 'string' ? result.url : undefined;
        const errorMsg = typeof result.error_message === 'string' ? result.error_message
          : typeof result.message === 'string' && !success ? result.message : undefined;
        const notes = typeof result.notes === 'string' ? result.notes : undefined;
        const failure = !success
          ? normalizeFailure('signup', service || 'merchant', errorMsg || 'Signup preparation failed')
          : null;
        const blockerCode = typeof result.blocker === 'object' && result.blocker && typeof (result.blocker as Record<string, unknown>).code === 'string'
          ? String((result.blocker as Record<string, unknown>).code)
          : failure?.code || 'signup_blocked';
        const blockerMessage = typeof result.blocker === 'object' && result.blocker && typeof (result.blocker as Record<string, unknown>).message === 'string'
          ? String((result.blocker as Record<string, unknown>).message)
          : errorMsg || failure?.message || 'Signup preparation failed';

        return NextResponse.json({
          ok: true,
          data: {
            success,
            plan,
            price,
            billingCycle,
            signupUrl,
            notes,
            blocker: !success ? { code: blockerCode, message: blockerMessage } : undefined,
            failure: failure || undefined,
          },
          steps,
        });
      }

      // signup-finalize
      const success = Boolean(result.success ?? result.status === 'success');
      const loginIdentifierMasked = typeof result.loginIdentifierMasked === 'string'
        ? result.loginIdentifierMasked
        : typeof result.login_identifier_masked === 'string'
          ? result.login_identifier_masked : undefined;
      const toolId = typeof result.toolId === 'string'
        ? result.toolId
        : typeof result.tool_id === 'string'
          ? result.tool_id
          : undefined;
      const subscriptionAdded = Boolean(result.subscriptionAdded ?? result.subscription_added);
      const rawError = typeof result.error_message === 'string'
        ? result.error_message
        : typeof result.message === 'string' && !success
          ? result.message
          : undefined;
      const failure = !success
        ? normalizeFailure('activation', service || 'merchant', rawError || 'Signup finalization failed')
        : null;
      const blocker = result.blocker
        ? result.blocker as { code: string; message: string }
        : !success
          ? { code: failure?.code || 'signup_blocked', message: rawError || failure?.message || 'Signup finalization failed' }
          : undefined;

      return NextResponse.json({
        ok: true,
        data: {
          success,
          loginIdentifierMasked,
          toolId,
          subscriptionAdded,
          blocker,
          failure: failure || undefined,
        },
        steps,
      });
    }

    // -------------------------------------------------------------------
    // All other actions use the standard v1 proxy
    // -------------------------------------------------------------------
    const base = process.env.TINYFISH_API_BASE_URL || 'https://api.tinyfish.ai/v1';
    const endpoint = endpointFor(body.action);
    const upstream = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
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

    if (body.action === 'vendor-discovery') {
      const candidates = upstreamJson.data?.candidates || upstreamJson.options || [];
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return NextResponse.json({ ok: false, error: 'TinyFish returned no vendor candidates' }, { status: 502 });
      }

      return NextResponse.json({
        ok: true,
        data: { candidates },
        steps,
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
    const message = error instanceof Error ? error.message : 'TinyFish execution failed';
    const failure = normalizeFailure('signup', 'merchant', message);
    return NextResponse.json({
      ok: false,
      error: message,
      failure,
    }, { status: 500 });
  }
}
