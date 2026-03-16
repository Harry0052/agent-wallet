import 'server-only';

import { query } from '@/lib/server/db';
import { ENGINE_VERSION, RULES_VERSION } from '@/lib/server/engines/contracts';
import { logServerEvent } from '@/lib/server/observability';
import {
  recordEngineMetric,
  recordEngineError,
  type EngineType,
} from '@/lib/server/engines/engineMetrics';
import {
  BACKFILL_SEQUENCE,
  decideBackfillStep,
  normalizeBackfillOptions,
  type BackfillOptions,
  type BackfillStepEngine,
} from '@/lib/server/engines/backfillPolicy';

export interface BackfillExplainability {
  summary: string;
  factors: string[];
}

export interface BackfillStepResult {
  engine: BackfillStepEngine;
  status: 'completed' | 'skipped' | 'failed';
  reason: 'executed' | 'fresh_data' | 'engine_unavailable' | 'failed';
  force: boolean;
  sinceDaysAgo: number;
  freshnessHours: number;
  lastGeneratedAt: string | null;
  generatedAt: string;
  latencyMs: number;
  engineVersion: string;
  rulesVersion: string;
  explainability: BackfillExplainability;
  metadata?: Record<string, unknown>;
}

export interface BackfillAllResult {
  userId: string;
  requestId?: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  force: boolean;
  sinceDaysAgo: number;
  steps: BackfillStepResult[];
  totals: {
    total: number;
    completed: number;
    skipped: number;
    failed: number;
  };
}

type EngineRunnerOutput = {
  count?: number;
  suppressed?: number;
  confidence?: number;
  status?: string;
  insufficientDataReasons?: string[];
  metadata?: Record<string, unknown>;
};

interface LastGeneratedAtRow {
  generated_at: string;
}

const ENGINE_TABLE_MAP: Record<BackfillStepEngine, string> = {
  insights: 'insight_generation_log',
  tasks: 'task_generation_log',
  health: 'health_score_snapshots',
  cashflow: 'cashflow_snapshots',
};

const ENGINE_METRIC_MAP: Record<BackfillStepEngine, EngineType> = {
  insights: 'insight',
  tasks: 'task',
  health: 'health',
  cashflow: 'cashflow',
};

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    throw new Error('Backfill requires a non-empty userId.');
  }
  return normalized;
}

function isMissingTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (code === '42P01' || code === '3F000') return true;
  const message = error.message.toLowerCase();
  return message.includes('relation') && message.includes('does not exist');
}

async function getLastGeneratedAt(
  userId: string,
  engine: BackfillStepEngine,
): Promise<string | null> {
  const table = ENGINE_TABLE_MAP[engine];

  try {
    const result = await query<LastGeneratedAtRow>(
      `SELECT generated_at::text
       FROM ${table}
       WHERE user_id = $1
       ORDER BY generated_at DESC
       LIMIT 1`,
      [userId],
    );

    if (result.rows.length === 0) return null;
    return result.rows[0].generated_at || null;
  } catch (error) {
    if (isMissingTableError(error)) {
      logServerEvent('warn', 'engine.backfill.missing_table', {
        userId,
        engine,
        table,
      });
      return null;
    }
    throw error;
  }
}

function toExplainability(input: {
  engine: BackfillStepEngine;
  status: BackfillStepResult['status'];
  reason: BackfillStepResult['reason'];
  freshnessHours: number;
  sinceDaysAgo: number;
  lastGeneratedAt: string | null;
  output?: EngineRunnerOutput;
}): BackfillExplainability {
  if (input.status === 'skipped' && input.reason === 'fresh_data') {
    return {
      summary: `Skipped ${input.engine} backfill because data is still fresh.`,
      factors: [
        `Latest generation: ${input.lastGeneratedAt || 'none'}.`,
        `Freshness threshold: ${input.freshnessHours} hour(s).`,
        'Set force=true to bypass freshness guard.',
      ],
    };
  }

  if (input.status === 'skipped' && input.reason === 'engine_unavailable') {
    return {
      summary: `Skipped ${input.engine} backfill because the engine is unavailable in this runtime.`,
      factors: [
        'Module import failed for the target engine.',
        'No data writes were attempted for this step.',
      ],
    };
  }

  if (input.status === 'failed') {
    return {
      summary: `Backfill failed for ${input.engine}.`,
      factors: [
        'Engine execution raised an error.',
        'Error details are recorded in server observability logs.',
      ],
    };
  }

  const factors: string[] = [
    `Backfill window requested: last ${input.sinceDaysAgo} day(s).`,
    `Freshness threshold for idempotency: ${input.freshnessHours} hour(s).`,
  ];

  if (typeof input.output?.count === 'number') {
    factors.push(`Items processed: ${input.output.count}.`);
  }
  if (typeof input.output?.suppressed === 'number') {
    factors.push(`Suppressed by guardrails: ${input.output.suppressed}.`);
  }
  if (typeof input.output?.status === 'string') {
    factors.push(`Engine result status: ${input.output.status}.`);
  }
  if (typeof input.output?.confidence === 'number') {
    factors.push(`Engine confidence: ${input.output.confidence.toFixed(2)}.`);
  }
  if ((input.output?.insufficientDataReasons?.length || 0) > 0) {
    factors.push(
      `Incomplete data signals: ${input.output!.insufficientDataReasons!.join(' | ')}`,
    );
  }

  return {
    summary: `Executed ${input.engine} backfill using deterministic engine logic.`,
    factors,
  };
}

async function runBackfillStep(input: {
  userId: string;
  engine: BackfillStepEngine;
  opts?: BackfillOptions;
  run: (userId: string) => Promise<EngineRunnerOutput>;
}): Promise<BackfillStepResult> {
  const normalizedUserId = normalizeUserId(input.userId);
  const normalizedOptions = normalizeBackfillOptions(input.opts);
  const startMs = Date.now();

  const lastGeneratedAt = await getLastGeneratedAt(normalizedUserId, input.engine);
  const decision = decideBackfillStep({
    engine: input.engine,
    options: normalizedOptions,
    lastGeneratedAt,
  });

  if (decision.skip) {
    const latencyMs = Date.now() - startMs;
    const step: BackfillStepResult = {
      engine: input.engine,
      status: 'skipped',
      reason: decision.reason,
      force: normalizedOptions.force,
      sinceDaysAgo: normalizedOptions.sinceDaysAgo,
      freshnessHours: decision.freshnessHours,
      lastGeneratedAt,
      generatedAt: new Date().toISOString(),
      latencyMs,
      engineVersion: ENGINE_VERSION,
      rulesVersion: RULES_VERSION,
      explainability: toExplainability({
        engine: input.engine,
        status: 'skipped',
        reason: decision.reason,
        freshnessHours: decision.freshnessHours,
        sinceDaysAgo: normalizedOptions.sinceDaysAgo,
        lastGeneratedAt,
      }),
      metadata: {
        requestId: normalizedOptions.requestId,
      },
    };

    recordEngineMetric({
      engine: ENGINE_METRIC_MAP[input.engine],
      event: 'backfill.skipped',
      userId: normalizedUserId,
      latencyMs,
      metadata: {
        reason: decision.reason,
        freshnessHours: decision.freshnessHours,
        sinceDaysAgo: normalizedOptions.sinceDaysAgo,
        force: normalizedOptions.force,
        requestId: normalizedOptions.requestId,
        lastGeneratedAt,
      },
    });

    return step;
  }

  try {
    const output = await input.run(normalizedUserId);
    const latencyMs = Date.now() - startMs;

    const step: BackfillStepResult = {
      engine: input.engine,
      status: 'completed',
      reason: 'executed',
      force: normalizedOptions.force,
      sinceDaysAgo: normalizedOptions.sinceDaysAgo,
      freshnessHours: decision.freshnessHours,
      lastGeneratedAt,
      generatedAt: new Date().toISOString(),
      latencyMs,
      engineVersion: ENGINE_VERSION,
      rulesVersion: RULES_VERSION,
      explainability: toExplainability({
        engine: input.engine,
        status: 'completed',
        reason: 'executed',
        freshnessHours: decision.freshnessHours,
        sinceDaysAgo: normalizedOptions.sinceDaysAgo,
        lastGeneratedAt,
        output,
      }),
      metadata: {
        ...output.metadata,
        requestId: normalizedOptions.requestId,
      },
    };

    recordEngineMetric({
      engine: ENGINE_METRIC_MAP[input.engine],
      event: 'backfill.complete',
      userId: normalizedUserId,
      latencyMs,
      count: output.count,
      confidence: output.confidence,
      metadata: {
        suppressed: output.suppressed,
        resultStatus: output.status,
        sinceDaysAgo: normalizedOptions.sinceDaysAgo,
        force: normalizedOptions.force,
        requestId: normalizedOptions.requestId,
      },
    });

    return step;
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      const latencyMs = Date.now() - startMs;
      const step: BackfillStepResult = {
        engine: input.engine,
        status: 'skipped',
        reason: 'engine_unavailable',
        force: normalizedOptions.force,
        sinceDaysAgo: normalizedOptions.sinceDaysAgo,
        freshnessHours: decision.freshnessHours,
        lastGeneratedAt,
        generatedAt: new Date().toISOString(),
        latencyMs,
        engineVersion: ENGINE_VERSION,
        rulesVersion: RULES_VERSION,
        explainability: toExplainability({
          engine: input.engine,
          status: 'skipped',
          reason: 'engine_unavailable',
          freshnessHours: decision.freshnessHours,
          sinceDaysAgo: normalizedOptions.sinceDaysAgo,
          lastGeneratedAt,
        }),
        metadata: {
          requestId: normalizedOptions.requestId,
        },
      };

      logServerEvent('warn', `engine.${input.engine}.backfill.engine_unavailable`, {
        userId: normalizedUserId,
        requestId: normalizedOptions.requestId,
      });

      return step;
    }

    recordEngineError({
      engine: ENGINE_METRIC_MAP[input.engine],
      event: 'backfill.error',
      userId: normalizedUserId,
      error,
      latencyMs: Date.now() - startMs,
      metadata: {
        sinceDaysAgo: normalizedOptions.sinceDaysAgo,
        force: normalizedOptions.force,
        requestId: normalizedOptions.requestId,
      },
    });
    throw error;
  }
}

function toFailureStep(input: {
  engine: BackfillStepEngine;
  opts: ReturnType<typeof normalizeBackfillOptions>;
  startMs: number;
  error: unknown;
}): BackfillStepResult {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  return {
    engine: input.engine,
    status: 'failed',
    reason: 'failed',
    force: input.opts.force,
    sinceDaysAgo: input.opts.sinceDaysAgo,
    freshnessHours: input.opts.minFreshnessHours || 0,
    lastGeneratedAt: null,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - input.startMs,
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    explainability: toExplainability({
      engine: input.engine,
      status: 'failed',
      reason: 'failed',
      freshnessHours: input.opts.minFreshnessHours || 0,
      sinceDaysAgo: input.opts.sinceDaysAgo,
      lastGeneratedAt: null,
    }),
    metadata: {
      error: message,
      requestId: input.opts.requestId,
    },
  };
}

export async function backfillInsights(
  userId: string,
  opts?: BackfillOptions,
): Promise<BackfillStepResult> {
  return runBackfillStep({
    userId,
    engine: 'insights',
    opts,
    run: async (targetUserId) => {
      const mod = await import('@/lib/server/engines/insightEngine');
      const result = await mod.generateInsights(targetUserId);
      return {
        count: result.insightsCreated,
        suppressed: result.insightsDeduped,
        metadata: {
          engineVersion: result.engineVersion,
          rulesVersion: result.rulesVersion,
        },
      };
    },
  });
}

export async function backfillTasks(
  userId: string,
  opts?: BackfillOptions,
): Promise<BackfillStepResult> {
  return runBackfillStep({
    userId,
    engine: 'tasks',
    opts,
    run: async (targetUserId) => {
      const mod = await import('@/lib/server/engines/taskEngine');
      const result = await mod.generateTasks(targetUserId);
      return {
        count: result.tasksCreated,
        suppressed: result.tasksSuppressed,
        metadata: {
          suppressionReasons: result.suppressionReasons,
          engineVersion: result.engineVersion,
          rulesVersion: result.rulesVersion,
        },
      };
    },
  });
}

export async function backfillHealthSnapshots(
  userId: string,
  opts?: BackfillOptions,
): Promise<BackfillStepResult> {
  return runBackfillStep({
    userId,
    engine: 'health',
    opts,
    run: async (targetUserId) => {
      const mod = await import('@/lib/server/engines/healthScoreEngine');
      const result = await mod.computeHealthScore(targetUserId);
      return {
        count: result.sourceTransactionIds.length,
        confidence: result.confidence,
        status: result.status,
        insufficientDataReasons: result.insufficientDataReasons,
        metadata: {
          coverageConfidence: result.coverageConfidence,
          engineVersion: result.engineVersion,
          rulesVersion: result.rulesVersion,
        },
      };
    },
  });
}

export async function backfillCashFlowSnapshots(
  userId: string,
  opts?: BackfillOptions,
): Promise<BackfillStepResult> {
  return runBackfillStep({
    userId,
    engine: 'cashflow',
    opts,
    run: async (targetUserId) => {
      const mod = await import('@/lib/server/engines/cashFlowEngine');
      const result = await mod.predictCashFlow(targetUserId);
      return {
        count: result.sourceTransactionIds.length,
        confidence: result.confidence,
        status: result.status,
        insufficientDataReasons: result.insufficientDataReasons,
        metadata: {
          coverageConfidence: result.coverageConfidence,
          engineVersion: result.engineVersion,
          rulesVersion: result.rulesVersion,
        },
      };
    },
  });
}

export async function backfillAll(
  userId: string,
  opts?: BackfillOptions,
): Promise<BackfillAllResult> {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedOptions = normalizeBackfillOptions(opts);
  const startMs = Date.now();
  const startedAt = new Date().toISOString();

  logServerEvent('info', 'engine.backfill.all.start', {
    userId: normalizedUserId,
    requestId: normalizedOptions.requestId,
    force: normalizedOptions.force,
    sinceDaysAgo: normalizedOptions.sinceDaysAgo,
  });

  const steps: BackfillStepResult[] = [];

  for (const engine of BACKFILL_SEQUENCE) {
    const stepStart = Date.now();
    try {
      const stepResult =
        engine === 'insights'
          ? await backfillInsights(normalizedUserId, normalizedOptions)
          : engine === 'tasks'
            ? await backfillTasks(normalizedUserId, normalizedOptions)
            : engine === 'health'
              ? await backfillHealthSnapshots(normalizedUserId, normalizedOptions)
              : await backfillCashFlowSnapshots(normalizedUserId, normalizedOptions);
      steps.push(stepResult);
    } catch (error) {
      steps.push(
        toFailureStep({
          engine,
          opts: normalizedOptions,
          startMs: stepStart,
          error,
        }),
      );
    }
  }

  const totals = {
    total: steps.length,
    completed: steps.filter((s) => s.status === 'completed').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
    failed: steps.filter((s) => s.status === 'failed').length,
  };

  const result: BackfillAllResult = {
    userId: normalizedUserId,
    requestId: normalizedOptions.requestId,
    startedAt,
    completedAt: new Date().toISOString(),
    latencyMs: Date.now() - startMs,
    force: normalizedOptions.force,
    sinceDaysAgo: normalizedOptions.sinceDaysAgo,
    steps,
    totals,
  };

  logServerEvent(
    totals.failed > 0 ? 'warn' : 'info',
    'engine.backfill.all.complete',
    {
      userId: normalizedUserId,
      requestId: normalizedOptions.requestId,
      latencyMs: result.latencyMs,
      ...totals,
    },
  );

  return result;
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
