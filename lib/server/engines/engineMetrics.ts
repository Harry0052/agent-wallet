import 'server-only';

import { logServerEvent } from '@/lib/server/observability';
import { ENGINE_VERSION, RULES_VERSION } from '@/lib/server/engines/contracts';

export type EngineType = 'insight' | 'cashflow' | 'health' | 'task' | 'command' | 'event';

export interface EngineMetric {
  engine: EngineType;
  event: string;
  userId: string;
  latencyMs: number;
  count?: number;
  confidence?: number;
  engineVersion?: string;
  rulesVersion?: string;
  metadata?: Record<string, unknown>;
}

export function recordEngineMetric(metric: EngineMetric): void {
  logServerEvent('info', `engine.${metric.engine}.${metric.event}`, {
    userId: metric.userId,
    latencyMs: metric.latencyMs,
    count: metric.count,
    confidence: metric.confidence,
    engineVersion: metric.engineVersion || ENGINE_VERSION,
    rulesVersion: metric.rulesVersion || RULES_VERSION,
    ...metric.metadata,
  });
}

export function recordEngineError(input: {
  engine: EngineType;
  event: string;
  userId: string;
  error: unknown;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}): void {
  const errorMessage =
    input.error instanceof Error ? input.error.message : String(input.error);

  logServerEvent('error', `engine.${input.engine}.${input.event}`, {
    userId: input.userId,
    latencyMs: input.latencyMs,
    error: errorMessage,
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    ...input.metadata,
  });
}

export function withMetrics<T>(
  engine: EngineType,
  event: string,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();

  return fn().then(
    (result) => {
      recordEngineMetric({
        engine,
        event,
        userId,
        latencyMs: Date.now() - start,
      });
      return result;
    },
    (error) => {
      recordEngineError({
        engine,
        event: `${event}.error`,
        userId,
        error,
        latencyMs: Date.now() - start,
      });
      throw error;
    },
  );
}
