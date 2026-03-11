import { CandidateMemoryCache } from './dedupe.ts';
import { toStructuredCandidateFromRaw } from './extraction.ts';
import {
  buildSourcingExecutionPlan,
  queryForPass,
  shouldEarlyStop,
  shouldRetryPass,
} from './planner.ts';
import { rankCandidates } from './scoring.ts';
import {
  SourcingTaskResultSchema,
  type NormalizedSourcingRequest,
  type RawSourcedCandidate,
  type SourcingActionLog,
  type SourcingExecutionPlan,
  type SourcingTaskResult,
  type StructuredCandidate,
} from './schemas.ts';

export interface SourcingPassResult {
  candidates: RawSourcedCandidate[];
  profilesVisited: number;
  resultPagesVisited: number;
  stateChanged: boolean;
  compactActions: string[];
  invalidCandidates?: number;
}

export interface SourcingPassExecutor {
  runPass(input: {
    taskId: string;
    request: NormalizedSourcingRequest;
    plan: SourcingExecutionPlan;
    passIndex: number;
    query: string;
    seenProfileUrls: string[];
    knownCandidateCount: number;
  }): Promise<SourcingPassResult>;
}

export interface SourcingExporter {
  exportShortlist(input: {
    taskId: string;
    request: NormalizedSourcingRequest;
    shortlist: StructuredCandidate[];
  }): Promise<{
    sheetId: string | null;
    sheetUrl: string | null;
    tabName: string | null;
    rowsWritten: number;
    exportedAt: string | null;
  }>;
}

export interface SourcingWorkflowDependencies {
  passExecutor: SourcingPassExecutor;
  exporter: SourcingExporter;
  now?: () => Date;
  onActionLog?: (entry: SourcingActionLog) => void;
}

function firstErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Unknown error';
}

function readErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return String((error as { code?: string }).code);
  }
  return null;
}

function readErrorStateChanged(error: unknown): boolean | null {
  if (error && typeof error === 'object' && 'stateChanged' in error && typeof (error as { stateChanged?: unknown }).stateChanged === 'boolean') {
    return Boolean((error as { stateChanged?: boolean }).stateChanged);
  }
  return null;
}

function classifyErrorCode(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('auth') || lower.includes('login') || lower.includes('captcha') || lower.includes('sign in')) {
    return 'AUTH_REQUIRED';
  }
  if (lower.includes('timeout')) return 'TIMEOUT';
  if (lower.includes('rate')) return 'RATE_LIMIT';
  if (lower.includes('validation')) return 'SCHEMA_VALIDATION_ERROR';
  if (lower.includes('no candidates')) return 'NO_RESULTS';
  if (lower.includes('sheet') || lower.includes('google')) return 'SHEETS_EXPORT_ERROR';
  return 'TRANSIENT_UPSTREAM';
}

function isRetryable(code: string): boolean {
  return code === 'TIMEOUT' || code === 'RATE_LIMIT' || code === 'TRANSIENT_UPSTREAM';
}

function nowIso(getNow: () => Date): string {
  return getNow().toISOString();
}

function appendAction(
  logs: SourcingActionLog[],
  entry: SourcingActionLog,
  callback?: (entry: SourcingActionLog) => void,
): void {
  logs.push(entry);
  callback?.(entry);
}

export async function runSourcingWorkflow(input: {
  taskId: string;
  request: NormalizedSourcingRequest;
}, deps: SourcingWorkflowDependencies): Promise<SourcingTaskResult> {
  const getNow = deps.now || (() => new Date());
  const startedAt = nowIso(getNow);
  const actionLogs: SourcingActionLog[] = [];
  const plan = buildSourcingExecutionPlan(input.request);
  const memory = new CandidateMemoryCache();

  let retriesUsed = 0;
  let extractionPasses = 0;
  let totalExtractedRaw = 0;
  let profilesVisited = 0;
  let resultPagesVisited = 0;
  let earlyStopTriggered = false;
  let previousTopScore = 0;
  let duplicateCandidatesSkipped = 0;
  let invalidCandidatesDropped = 0;

  const errors: SourcingTaskResult['errors'] = [];

  appendAction(actionLogs, {
    at: nowIso(getNow),
    phase: 'planning',
    message: `Built sourcing execution plan for query: ${plan.baseSearchQuery}`,
    stats: {
      maxResultPages: plan.bounds.maxResultPages,
      maxProfilesOpened: plan.bounds.maxProfilesOpened,
      maxExtractionPasses: plan.bounds.maxExtractionPasses,
    },
  }, deps.onActionLog);

  for (let passIndex = 0; passIndex < plan.bounds.maxExtractionPasses; passIndex += 1) {
    extractionPasses += 1;
    const query = queryForPass(plan, passIndex);

    appendAction(actionLogs, {
      at: nowIso(getNow),
      phase: 'parsing',
      message: `Pass ${passIndex + 1}: sourcing candidates with query "${query}"`,
      stats: {
        passIndex,
        query,
      },
    }, deps.onActionLog);

    let passOutput: SourcingPassResult | null = null;

    try {
      passOutput = await deps.passExecutor.runPass({
        taskId: input.taskId,
        request: input.request,
        plan,
        passIndex,
        query,
        seenProfileUrls: memory.values().map((candidate) => candidate.sourceUrl),
        knownCandidateCount: memory.size(),
      });
    } catch (error) {
      const message = firstErrorMessage(error);
      const code = readErrorCode(error) || classifyErrorCode(message);
      const retryable = isRetryable(code);
      const stateChanged = readErrorStateChanged(error) ?? false;

      errors.push({
        code,
        stage: 'parsing',
        message,
        retryable,
      });

      appendAction(actionLogs, {
        at: nowIso(getNow),
        phase: 'failed',
        message: `Pass ${passIndex + 1} failed: ${message}`,
        stats: { code, retryable },
      }, deps.onActionLog);

      if (retryable && shouldRetryPass({ retriesUsed, maxRetries: plan.bounds.maxRetries, errorCode: code, stateChanged })) {
        retriesUsed += 1;
        passIndex -= 1;
        continue;
      }

      if (memory.size() === 0) {
        const failedResult = SourcingTaskResultSchema.parse({
          taskId: input.taskId,
          status: 'failed',
          summary: `Candidate sourcing failed during parsing: ${message}`,
          normalizedRequest: input.request,
          executionPlan: plan,
          extractedCandidates: [],
          shortlist: [],
          metrics: {
            totalExtracted: 0,
            dedupedCount: 0,
            extractionPasses,
            profilesVisited,
            resultPagesVisited,
            retriesUsed,
            earlyStopTriggered: false,
            scoringDurationMs: 0,
            exportDurationMs: 0,
            totalDurationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
          },
          export: {
            sheetId: null,
            sheetUrl: null,
            tabName: null,
            rowsWritten: 0,
            exportedAt: null,
          },
          errors,
          actionLogs,
          startedAt,
          completedAt: nowIso(getNow),
          updatedAt: nowIso(getNow),
        });

        return failedResult;
      }

      break;
    }

    if (!passOutput) continue;

    profilesVisited += passOutput.profilesVisited;
    resultPagesVisited += passOutput.resultPagesVisited;
    totalExtractedRaw += passOutput.candidates.length;
    invalidCandidatesDropped += Math.max(0, passOutput.invalidCandidates || 0);

    for (const action of passOutput.compactActions) {
      appendAction(actionLogs, {
        at: nowIso(getNow),
        phase: 'parsing',
        message: action,
      }, deps.onActionLog);
    }

    let skippedDuplicates = 0;
    for (const rawCandidate of passOutput.candidates) {
      if (memory.hasIdentity(rawCandidate)) {
        skippedDuplicates += 1;
        continue;
      }
      const structured = toStructuredCandidateFromRaw({
        raw: rawCandidate,
        taskId: input.taskId,
        request: input.request,
      });
      if (!structured) continue;
      const added = memory.upsert(structured);
      if (!added) skippedDuplicates += 1;
    }
    duplicateCandidatesSkipped += skippedDuplicates;

    if (skippedDuplicates > 0) {
      appendAction(actionLogs, {
        at: nowIso(getNow),
        phase: 'parsing',
        message: `Skipped ${skippedDuplicates} duplicate candidate record(s).`,
        stats: {
          skippedDuplicates,
        },
      }, deps.onActionLog);
    }

    if ((passOutput.invalidCandidates || 0) > 0) {
      appendAction(actionLogs, {
        at: nowIso(getNow),
        phase: 'parsing',
        message: `Dropped ${passOutput.invalidCandidates} invalid candidate record(s).`,
        stats: {
          invalidCandidates: passOutput.invalidCandidates,
        },
      }, deps.onActionLog);
    }

    const scoredSnapshot = rankCandidates(memory.values(), input.request);
    const shortlistSnapshot = scoredSnapshot.slice(0, input.request.shortlistTarget);
    const currentTopScore = shortlistSnapshot[0]?.score || 0;
    const alternativesImproving = passIndex > 0 && (currentTopScore - previousTopScore) >= 4;

    if (shouldEarlyStop({
      shortlisted: shortlistSnapshot,
      target: input.request.shortlistTarget,
      threshold: input.request.earlyStopScoreThreshold,
      passIndex,
      maxPasses: plan.bounds.maxExtractionPasses,
      alternativesImproving,
    })) {
      earlyStopTriggered = true;
      appendAction(actionLogs, {
        at: nowIso(getNow),
        phase: 'scoring',
        message: 'Early-stop triggered: enough high-confidence candidates were found.',
        stats: {
          shortlistSize: shortlistSnapshot.length,
          threshold: input.request.earlyStopScoreThreshold,
        },
      }, deps.onActionLog);
      break;
    }

    previousTopScore = currentTopScore;
  }

  const scoringStarted = Date.now();
  const ranked = rankCandidates(memory.values(), input.request);
  const shortlist = ranked.slice(0, input.request.shortlistTarget);
  const scoringDurationMs = Math.max(0, Date.now() - scoringStarted);

  appendAction(actionLogs, {
    at: nowIso(getNow),
    phase: 'scoring',
    message: `Scored ${ranked.length} candidates and shortlisted ${shortlist.length}.`,
    stats: {
      scored: ranked.length,
      shortlisted: shortlist.length,
    },
  }, deps.onActionLog);

  const exportStarted = Date.now();

  let exportResult: {
    sheetId: string | null;
    sheetUrl: string | null;
    tabName: string | null;
    rowsWritten: number;
    exportedAt: string | null;
  } = {
    sheetId: null,
    sheetUrl: null,
    tabName: null,
    rowsWritten: 0,
    exportedAt: null,
  };

  let finalStatus: SourcingTaskResult['status'] = 'completed';
  let summary = `Shortlisted ${shortlist.length} candidate(s) and exported to Google Sheets.`;

  if (shortlist.length === 0) {
    finalStatus = 'failed';
    summary = 'No strong candidates were extracted from Indeed for this request.';
    errors.push({
      code: 'NO_RESULTS',
      stage: 'scoring',
      message: 'No candidates available after extraction and scoring.',
      retryable: false,
    });
  } else {
    appendAction(actionLogs, {
      at: nowIso(getNow),
      phase: 'exporting',
      message: 'Exporting shortlist to Google Sheets.',
      stats: { shortlistCount: shortlist.length },
    }, deps.onActionLog);

    try {
      exportResult = await deps.exporter.exportShortlist({
        taskId: input.taskId,
        request: input.request,
        shortlist,
      });
    } catch (error) {
      const message = firstErrorMessage(error);
      errors.push({
        code: classifyErrorCode(message),
        stage: 'exporting',
        message,
        retryable: false,
      });
      finalStatus = 'partial_success';
      summary = `Shortlisted ${shortlist.length} candidate(s), but Google Sheets export failed.`;
    }

    if (!exportResult.sheetUrl && finalStatus === 'completed') {
      finalStatus = 'partial_success';
      summary = `Shortlisted ${shortlist.length} candidate(s), but no sheet link was produced.`;
    }

    if (shortlist.length < input.request.shortlistTarget && finalStatus === 'completed') {
      finalStatus = 'partial_success';
      summary = `Found ${shortlist.length} strong candidate(s); target was ${input.request.shortlistTarget}.`;
    }
  }

  const exportDurationMs = Math.max(0, Date.now() - exportStarted);
  const totalDurationMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const passBudget = plan.bounds.maxExtractionPasses;
  const passesUsed = extractionPasses;
  const passesAvoided = Math.max(0, passBudget - passesUsed);
  const estimatedBrowserStepsAvoided = (
    (passesAvoided * (plan.bounds.maxResultPages + 1))
    + duplicateCandidatesSkipped
  );

  appendAction(actionLogs, {
    at: nowIso(getNow),
    phase: finalStatus === 'failed' ? 'failed' : 'completed',
    message: summary,
    stats: {
      status: finalStatus,
      totalExtracted: totalExtractedRaw,
      uniqueCandidates: ranked.length,
      shortlisted: shortlist.length,
      sheetUrl: exportResult.sheetUrl,
    },
  }, deps.onActionLog);

  return SourcingTaskResultSchema.parse({
    taskId: input.taskId,
    status: finalStatus,
    summary,
    normalizedRequest: input.request,
    executionPlan: plan,
    extractedCandidates: ranked,
    shortlist,
    metrics: {
      totalExtracted: totalExtractedRaw,
      dedupedCount: ranked.length,
      extractionPasses,
      profilesVisited,
      resultPagesVisited,
      retriesUsed,
      earlyStopTriggered,
      scoringDurationMs,
      exportDurationMs,
      totalDurationMs,
    },
    efficiency: {
      passBudget,
      passesUsed,
      passesAvoided,
      duplicateCandidatesSkipped,
      invalidCandidatesDropped,
      estimatedBrowserStepsAvoided,
    },
    export: exportResult,
    errors,
    actionLogs,
    startedAt,
    completedAt: nowIso(getNow),
    updatedAt: nowIso(getNow),
  });
}
