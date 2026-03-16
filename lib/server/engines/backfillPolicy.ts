export type BackfillEngine = 'insights' | 'tasks' | 'health' | 'cashflow' | 'all';
export type BackfillStepEngine = Exclude<BackfillEngine, 'all'>;

export interface BackfillOptions {
  force?: boolean;
  sinceDaysAgo?: number;
  minFreshnessHours?: number;
  requestId?: string;
  nowMs?: number;
}

export interface NormalizedBackfillOptions {
  force: boolean;
  sinceDaysAgo: number;
  minFreshnessHours?: number;
  requestId?: string;
  nowMs: number;
}

export type BackfillStepDecision =
  | {
      skip: true;
      reason: 'fresh_data';
      freshnessHours: number;
    }
  | {
      skip: false;
      reason: 'run_required';
      freshnessHours: number;
    };

export const BACKFILL_SEQUENCE: BackfillStepEngine[] = [
  'insights',
  'health',
  'cashflow',
  'tasks',
];

export const DEFAULT_FRESHNESS_HOURS: Record<BackfillStepEngine, number> = {
  insights: 6,
  tasks: 6,
  health: 24,
  cashflow: 12,
};

const DEFAULT_SINCE_DAYS = 30;
const MAX_SINCE_DAYS = 365;

export function clampSinceDaysAgo(sinceDaysAgo: number | undefined): number {
  if (typeof sinceDaysAgo !== 'number' || !Number.isFinite(sinceDaysAgo)) {
    return DEFAULT_SINCE_DAYS;
  }

  const floored = Math.floor(sinceDaysAgo);
  if (floored < 1) return 1;
  if (floored > MAX_SINCE_DAYS) return MAX_SINCE_DAYS;
  return floored;
}

export function resolveFreshnessHours(
  engine: BackfillStepEngine,
  override: number | undefined,
): number {
  if (typeof override !== 'number' || !Number.isFinite(override)) {
    return DEFAULT_FRESHNESS_HOURS[engine];
  }

  const floored = Math.floor(override);
  if (floored < 1) return 1;
  return floored;
}

export function isBackfillFresh(
  lastGeneratedAt: string | null,
  nowMs: number,
  freshnessHours: number,
): boolean {
  if (!lastGeneratedAt) return false;
  const generatedAtMs = Date.parse(lastGeneratedAt);
  if (!Number.isFinite(generatedAtMs)) return false;

  const ageMs = nowMs - generatedAtMs;
  if (ageMs < 0) return false;
  return ageMs < freshnessHours * 60 * 60 * 1000;
}

export function normalizeBackfillOptions(
  opts: BackfillOptions | undefined,
): NormalizedBackfillOptions {
  return {
    force: opts?.force === true,
    sinceDaysAgo: clampSinceDaysAgo(opts?.sinceDaysAgo),
    minFreshnessHours: opts?.minFreshnessHours,
    requestId: opts?.requestId?.trim() || undefined,
    nowMs: typeof opts?.nowMs === 'number' && Number.isFinite(opts.nowMs)
      ? opts.nowMs
      : Date.now(),
  };
}

export function decideBackfillStep(input: {
  engine: BackfillStepEngine;
  options: NormalizedBackfillOptions;
  lastGeneratedAt: string | null;
}): BackfillStepDecision {
  const freshnessHours = resolveFreshnessHours(
    input.engine,
    input.options.minFreshnessHours,
  );

  if (!input.options.force && isBackfillFresh(input.lastGeneratedAt, input.options.nowMs, freshnessHours)) {
    return {
      skip: true,
      reason: 'fresh_data',
      freshnessHours,
    };
  }

  return {
    skip: false,
    reason: 'run_required',
    freshnessHours,
  };
}
