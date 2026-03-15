import 'server-only';

import { logServerEvent } from '@/lib/server/observability';
import { recordEngineMetric, recordEngineError } from '@/lib/server/engines/engineMetrics';

export async function backfillInsights(
  userId: string,
  _opts?: { force?: boolean },
): Promise<void> {
  const start = Date.now();
  try {
    const mod = await import('@/lib/server/engines/insightEngine');
    await mod.generateInsights(userId);
    recordEngineMetric({
      engine: 'insight',
      event: 'backfill.complete',
      userId,
      latencyMs: Date.now() - start,
    });
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      logServerEvent('warn', 'engine.insight.backfill.not_implemented', { userId });
      return;
    }
    recordEngineError({
      engine: 'insight',
      event: 'backfill.error',
      userId,
      error,
      latencyMs: Date.now() - start,
    });
    throw error;
  }
}

export async function backfillTasks(
  userId: string,
  _opts?: { force?: boolean },
): Promise<void> {
  const start = Date.now();
  try {
    const mod = await import('@/lib/server/engines/taskEngine');
    await mod.generateTasks(userId);
    recordEngineMetric({
      engine: 'task',
      event: 'backfill.complete',
      userId,
      latencyMs: Date.now() - start,
    });
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      logServerEvent('warn', 'engine.task.backfill.not_implemented', { userId });
      return;
    }
    recordEngineError({
      engine: 'task',
      event: 'backfill.error',
      userId,
      error,
      latencyMs: Date.now() - start,
    });
    throw error;
  }
}

export async function backfillHealthSnapshots(
  userId: string,
  _opts?: { sinceDaysAgo?: number },
): Promise<void> {
  const start = Date.now();
  try {
    const mod = await import('@/lib/server/engines/healthScoreEngine');
    await mod.computeHealthScore(userId);
    recordEngineMetric({
      engine: 'health',
      event: 'backfill.complete',
      userId,
      latencyMs: Date.now() - start,
    });
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      logServerEvent('warn', 'engine.health.backfill.not_implemented', { userId });
      return;
    }
    recordEngineError({
      engine: 'health',
      event: 'backfill.error',
      userId,
      error,
      latencyMs: Date.now() - start,
    });
    throw error;
  }
}

export async function backfillCashFlowSnapshots(
  userId: string,
  _opts?: { sinceDaysAgo?: number },
): Promise<void> {
  const start = Date.now();
  try {
    const mod = await import('@/lib/server/engines/cashFlowEngine');
    await mod.predictCashFlow(userId);
    recordEngineMetric({
      engine: 'cashflow',
      event: 'backfill.complete',
      userId,
      latencyMs: Date.now() - start,
    });
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      logServerEvent('warn', 'engine.cashflow.backfill.not_implemented', { userId });
      return;
    }
    recordEngineError({
      engine: 'cashflow',
      event: 'backfill.error',
      userId,
      error,
      latencyMs: Date.now() - start,
    });
    throw error;
  }
}

export async function backfillAll(userId: string): Promise<void> {
  const start = Date.now();
  logServerEvent('info', 'engine.backfill.all.start', { userId });

  const results = await Promise.allSettled([
    backfillInsights(userId),
    backfillTasks(userId),
    backfillHealthSnapshots(userId),
    backfillCashFlowSnapshots(userId),
  ]);

  const failures = results.filter((r) => r.status === 'rejected');

  logServerEvent(
    failures.length > 0 ? 'warn' : 'info',
    'engine.backfill.all.complete',
    {
      userId,
      latencyMs: Date.now() - start,
      total: results.length,
      succeeded: results.length - failures.length,
      failed: failures.length,
    },
  );
}

function isModuleNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('cannot find module') ||
    msg.includes('module not found') ||
    msg.includes('is not a function')
  );
}
