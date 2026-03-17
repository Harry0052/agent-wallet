import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceEntitlement } from '@/security/entitlementGuard';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';
import { routeSmartSurfaceIntent } from '@/lib/server/smartSurface/intentRouter';
import { assembleSmartSurfaceContext } from '@/lib/server/smartSurface/contextAssembly';
import { composeSmartSurfaceResult } from '@/lib/server/smartSurface/resultComposer';
import { isInternalActionsRuntimeEnabled } from '@/lib/server/smartSurface/actionsRuntimeBoundary';

export const runtime = 'nodejs';

const BodySchema = z.object({
  prompt: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  const guard = await enforceEntitlement(req, {
    requiredFeature: 'ai_research',
    rateLimitScope: 'smart_surface',
  });
  if (!guard.ok) return guard.response;

  try {
    const body = BodySchema.parse(await req.json());
    const intent = routeSmartSurfaceIntent(body.prompt);
    const context = await assembleSmartSurfaceContext(guard.ctx.auth.walletUserId);
    const result = composeSmartSurfaceResult({ intent, context });

    if (isInternalActionsRuntimeEnabled()) {
      // Reserved service boundary for future internal action execution.
      // Intentionally not exposed in primary Calico flows.
    }

    return NextResponse.json({
      ok: true,
      result,
      meta: {
        generatedAt: context.generatedAt,
        trust: context.trust,
      },
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Failed to process Calico request';
    const errorCode = classifyTaskError({
      message,
      validation: error instanceof z.ZodError,
    });
    logServerEvent('error', 'smart.surface.failed', { errorCode, message });

    return NextResponse.json(apiError(errorCode, message, true), {
      status: error instanceof z.ZodError ? 400 : 500,
    });
  }
}
