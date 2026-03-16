import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError } from '@/lib/server/auth';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import {
  backfillAll,
  backfillInsights,
  backfillTasks,
  backfillHealthSnapshots,
  backfillCashFlowSnapshots,
  type BackfillAllResult,
  type BackfillStepResult,
} from '@/lib/server/engines/backfill';
import {
  normalizeBackfillOptions,
  type BackfillEngine,
  type BackfillOptions,
} from '@/lib/server/engines/backfillPolicy';
import { apiError, classifyTaskError, logServerEvent } from '@/lib/server/observability';

export const runtime = 'nodejs';

const BackfillRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  engine: z.enum(['insights', 'tasks', 'health', 'cashflow', 'all']).default('all'),
  force: z.boolean().optional(),
  sinceDaysAgo: z.number().int().min(1).max(365).optional(),
  minFreshnessHours: z.number().int().min(1).max(168).optional(),
  confirmTargetUser: z.boolean().optional(),
  requestId: z.string().trim().min(1).max(120).optional(),
});

function buildSingleEngineResult(input: {
  userId: string;
  opts: BackfillOptions;
  step: BackfillStepResult;
}): BackfillAllResult {
  const normalizedOptions = normalizeBackfillOptions(input.opts);

  return {
    userId: input.userId,
    requestId: normalizedOptions.requestId,
    startedAt: input.step.generatedAt,
    completedAt: input.step.generatedAt,
    latencyMs: input.step.latencyMs,
    force: normalizedOptions.force,
    sinceDaysAgo: normalizedOptions.sinceDaysAgo,
    steps: [input.step],
    totals: {
      total: 1,
      completed: input.step.status === 'completed' ? 1 : 0,
      skipped: input.step.status === 'skipped' ? 1 : 0,
      failed: input.step.status === 'failed' ? 1 : 0,
    },
  };
}

export async function POST(request: NextRequest) {
  const rateLimited = enforceRateLimit(request, { profile: 'general' });
  if (rateLimited) return rateLimited;

  const authResult = await enforceApiAuth(request, { requiredRoles: ['admin'] });
  if (!authResult.ok) return authResult.response;

  const { auth } = authResult;

  let body: z.infer<typeof BackfillRequestSchema>;
  try {
    const raw = await request.text();
    const candidate = raw.trim().length > 0
      ? JSON.parse(raw)
      : {};
    body = BackfillRequestSchema.parse(candidate);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        apiError(
          'VALIDATION_ERROR',
          error.errors.map((entry) => entry.message).join(', '),
          true,
        ),
        { status: 400 },
      );
    }
    return NextResponse.json(
      apiError('VALIDATION_ERROR', 'Invalid JSON body', true),
      { status: 400 },
    );
  }

  const targetUserId = body.userId || auth.walletUserId;
  const engine: BackfillEngine = body.engine;
  const options: BackfillOptions = {
    force: body.force === true,
    sinceDaysAgo: body.sinceDaysAgo,
    minFreshnessHours: body.minFreshnessHours,
    requestId: body.requestId,
  };

  if (targetUserId !== auth.walletUserId && body.confirmTargetUser !== true) {
    return NextResponse.json(
      apiError(
        'VALIDATION_ERROR',
        'confirmTargetUser=true is required when backfilling another user.',
        true,
      ),
      { status: 400 },
    );
  }

  logServerEvent('info', 'engine.backfill.api.start', {
    adminUserId: auth.appUserId,
    targetUserId,
    engine,
    force: options.force === true,
    requestId: options.requestId,
    sinceDaysAgo: options.sinceDaysAgo,
    minFreshnessHours: options.minFreshnessHours,
  });

  const start = Date.now();

  try {
    let result: BackfillAllResult;

    switch (engine) {
      case 'insights':
        result = buildSingleEngineResult({
          userId: targetUserId,
          opts: options,
          step: await backfillInsights(targetUserId, options),
        });
        break;
      case 'tasks':
        result = buildSingleEngineResult({
          userId: targetUserId,
          opts: options,
          step: await backfillTasks(targetUserId, options),
        });
        break;
      case 'health':
        result = buildSingleEngineResult({
          userId: targetUserId,
          opts: options,
          step: await backfillHealthSnapshots(targetUserId, options),
        });
        break;
      case 'cashflow':
        result = buildSingleEngineResult({
          userId: targetUserId,
          opts: options,
          step: await backfillCashFlowSnapshots(targetUserId, options),
        });
        break;
      case 'all':
      default:
        result = await backfillAll(targetUserId, options);
        break;
    }

    logServerEvent(
      result.totals.failed > 0 ? 'warn' : 'info',
      'engine.backfill.api.complete',
      {
        adminUserId: auth.appUserId,
        targetUserId,
        engine,
        requestId: result.requestId,
        force: result.force,
        sinceDaysAgo: result.sinceDaysAgo,
        latencyMs: Date.now() - start,
        ...result.totals,
      },
    );

    return NextResponse.json({
      ok: true,
      engine,
      userId: targetUserId,
      latencyMs: Date.now() - start,
      result,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        apiError('VALIDATION_ERROR', error.message, true),
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = classifyTaskError({ message });
    logServerEvent('error', 'engine.backfill.api.error', {
      targetUserId,
      engine,
      requestId: options.requestId,
      errorCode,
      error: message,
      latencyMs: Date.now() - start,
    });

    return NextResponse.json(
      apiError(errorCode, `Backfill failed: ${message}`, true),
      { status: 500 },
    );
  }
}
