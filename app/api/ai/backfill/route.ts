import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { enforceApiAuth } from '@/security/authGuard';
import { enforceRateLimit } from '@/security/rateLimiter';
import { backfillAll, backfillInsights, backfillTasks, backfillHealthSnapshots, backfillCashFlowSnapshots } from '@/lib/server/engines/backfill';
import { logServerEvent } from '@/lib/server/observability';

type BackfillEngine = 'insights' | 'tasks' | 'health' | 'cashflow' | 'all';

export async function POST(request: NextRequest) {
  const rateLimited = enforceRateLimit(request, { profile: 'general' });
  if (rateLimited) return rateLimited;

  const authResult = await enforceApiAuth(request, { requiredRoles: ['admin'] });
  if (!authResult.ok) return authResult.response;

  const { auth } = authResult;

  let body: { userId?: string; engine?: BackfillEngine; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const targetUserId = body.userId || auth.walletUserId;
  const engine: BackfillEngine = body.engine || 'all';
  const force = body.force === true;

  logServerEvent('info', 'engine.backfill.api.start', {
    adminUserId: auth.appUserId,
    targetUserId,
    engine,
    force,
  });

  const start = Date.now();

  try {
    switch (engine) {
      case 'insights':
        await backfillInsights(targetUserId, { force });
        break;
      case 'tasks':
        await backfillTasks(targetUserId, { force });
        break;
      case 'health':
        await backfillHealthSnapshots(targetUserId);
        break;
      case 'cashflow':
        await backfillCashFlowSnapshots(targetUserId);
        break;
      case 'all':
      default:
        await backfillAll(targetUserId);
        break;
    }

    return NextResponse.json({
      ok: true,
      engine,
      userId: targetUserId,
      latencyMs: Date.now() - start,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logServerEvent('error', 'engine.backfill.api.error', {
      targetUserId,
      engine,
      error: message,
      latencyMs: Date.now() - start,
    });

    return NextResponse.json(
      { ok: false, error: 'Backfill failed', detail: message },
      { status: 500 },
    );
  }
}
