import assert from 'node:assert/strict';
import test from 'node:test';
import { runSourcingWorkflow, type SourcingExporter, type SourcingPassExecutor } from '../lib/sourcing/workflow.ts';
import { normalizeSourcingRequest } from '../lib/sourcing/normalize.ts';

function makeRaw(index: number, overrides: Record<string, unknown> = {}) {
  return {
    sourceUrl: `https://www.indeed.com/viewjob?jk=${index}`,
    fullName: `Candidate ${index}`,
    currentTitle: 'Senior Software Engineer',
    location: 'Remote',
    remoteStatus: 'remote',
    yearsExperience: 8 + index,
    skills: ['TypeScript', 'AWS', 'Node.js'],
    companyHistory: ['Example Corp', 'Startup LLC'],
    education: 'BS CS',
    summary: 'Experienced backend engineer',
    extractionConfidence: 0.85,
    ...overrides,
  };
}

function makePassExecutor(passes: Array<{
  candidates: unknown[];
  profilesVisited?: number;
  resultPagesVisited?: number;
  stateChanged?: boolean;
  compactActions?: string[];
  invalidCandidates?: number;
  error?: Error;
}>): SourcingPassExecutor {
  let cursor = 0;

  return {
    async runPass() {
      const current = passes[Math.min(cursor, passes.length - 1)];
      cursor += 1;

      if (current.error) throw current.error;

      return {
        candidates: current.candidates as never,
        profilesVisited: current.profilesVisited ?? current.candidates.length,
        resultPagesVisited: current.resultPagesVisited ?? 1,
        stateChanged: current.stateChanged ?? current.candidates.length > 0,
        compactActions: current.compactActions || [],
        invalidCandidates: current.invalidCandidates ?? 0,
      };
    },
  };
}

function makeExporter(behavior: 'ok' | 'fail'): SourcingExporter {
  return {
    async exportShortlist(input) {
      if (behavior === 'fail') {
        throw new Error('Sheets API unavailable');
      }

      return {
        sheetId: 'sheet_123',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet_123/edit',
        tabName: 'Shortlist_task',
        rowsWritten: input.shortlist.length,
        exportedAt: new Date().toISOString(),
      };
    },
  };
}

test('10) partial failure handling keeps shortlist when export fails', async () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers remote with TypeScript and AWS on Indeed');

  const result = await runSourcingWorkflow({
    taskId: 'task_partial',
    request,
  }, {
    passExecutor: makePassExecutor([
      { candidates: [makeRaw(1), makeRaw(2), makeRaw(3)] },
    ]),
    exporter: makeExporter('fail'),
  });

  assert.equal(result.status, 'partial_success');
  assert.equal(result.shortlist.length, 3);
  assert.equal(result.export.sheetUrl, null);
  assert.ok(result.errors.some((entry) => entry.stage === 'exporting'));
});

test('11) no-result scenario fails with retained diagnostics', async () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers in Austin with Rust');

  const result = await runSourcingWorkflow({
    taskId: 'task_no_results',
    request,
  }, {
    passExecutor: makePassExecutor([
      { candidates: [], stateChanged: false, compactActions: ['No matches found on scanned pages.'] },
    ]),
    exporter: makeExporter('ok'),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.shortlist.length, 0);
  assert.ok(result.summary.toLowerCase().includes('no strong candidates'));
});

test('12) workflow output includes persistence-ready state and logs', async () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers remote with TypeScript and AWS');

  const result = await runSourcingWorkflow({
    taskId: 'task_persistence',
    request,
  }, {
    passExecutor: makePassExecutor([
      { candidates: [makeRaw(1), makeRaw(2), makeRaw(3)] },
    ]),
    exporter: makeExporter('ok'),
  });

  assert.equal(result.taskId, 'task_persistence');
  assert.ok(result.startedAt.length > 0);
  assert.ok(result.updatedAt.length > 0);
  assert.ok(result.completedAt);
  assert.ok(result.actionLogs.length > 0);
  assert.ok(result.metrics.totalDurationMs >= 0);
});

test('13) exactly top-3 shortlist generation from larger pool', async () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers remote with TypeScript and AWS');

  const result = await runSourcingWorkflow({
    taskId: 'task_top3',
    request,
  }, {
    passExecutor: makePassExecutor([
      { candidates: [makeRaw(1), makeRaw(2), makeRaw(3), makeRaw(4), makeRaw(5)] },
    ]),
    exporter: makeExporter('ok'),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.extractedCandidates.length, 5);
  assert.equal(result.shortlist.length, 3);
});

test('14) duplicate candidates across passes are deduplicated', async () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers remote with TypeScript');

  const duplicate = makeRaw(1, { sourceUrl: 'https://www.indeed.com/viewjob?jk=dup&utm_source=x' });
  const duplicateVariant = makeRaw(1, { sourceUrl: 'https://indeed.com/viewjob?jk=dup' });

  const result = await runSourcingWorkflow({
    taskId: 'task_dedupe',
    request,
  }, {
    passExecutor: makePassExecutor([
      { candidates: [duplicate, makeRaw(2)] },
      { candidates: [duplicateVariant, makeRaw(3)] },
    ]),
    exporter: makeExporter('ok'),
  });

  assert.equal(result.extractedCandidates.length, 3);
  assert.equal(result.shortlist.length, 3);
  assert.equal(result.metrics.totalExtracted, 4);
  assert.equal(result.metrics.dedupedCount, 3);
});

test('15) early-stop triggers when confidence threshold met', async () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers remote with TypeScript and AWS');

  const result = await runSourcingWorkflow({
    taskId: 'task_early_stop',
    request,
  }, {
    passExecutor: makePassExecutor([
      { candidates: [makeRaw(1), makeRaw(2), makeRaw(3)] },
      { candidates: [makeRaw(4)] },
    ]),
    exporter: makeExporter('ok'),
  });

  assert.equal(result.metrics.earlyStopTriggered, true);
  assert.equal(result.metrics.extractionPasses, 1);
});

test('16) idempotent reruns produce stable shortlist ordering', async () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers remote with TypeScript and AWS');

  const passData = [
    { candidates: [makeRaw(1), makeRaw(2), makeRaw(3), makeRaw(4)] },
  ];

  const first = await runSourcingWorkflow({
    taskId: 'task_idempotent_1',
    request,
  }, {
    passExecutor: makePassExecutor(passData),
    exporter: makeExporter('ok'),
  });

  const second = await runSourcingWorkflow({
    taskId: 'task_idempotent_2',
    request,
  }, {
    passExecutor: makePassExecutor(passData),
    exporter: makeExporter('ok'),
  });

  assert.deepEqual(
    first.shortlist.map((candidate) => ({ url: candidate.sourceUrl, score: candidate.score })),
    second.shortlist.map((candidate) => ({ url: candidate.sourceUrl, score: candidate.score })),
  );

  assert.ok(first.actionLogs.length > 0);
  assert.ok(second.actionLogs.length > 0);
  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'completed');
});

test('17) auth-required failures do not retry and fail fast', async () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers in San Francisco with TypeScript');

  let attempts = 0;
  const authFailingExecutor: SourcingPassExecutor = {
    async runPass() {
      attempts += 1;
      const error = new Error('Indeed sign in is required before continuing');
      (error as Error & { code?: string; stateChanged?: boolean }).code = 'AUTH_REQUIRED';
      (error as Error & { code?: string; stateChanged?: boolean }).stateChanged = true;
      throw error;
    },
  };

  const result = await runSourcingWorkflow({
    taskId: 'task_auth_required',
    request,
  }, {
    passExecutor: authFailingExecutor,
    exporter: makeExporter('ok'),
  });

  assert.equal(attempts, 1);
  assert.equal(result.status, 'failed');
  assert.ok(result.errors.some((entry) => entry.code === 'AUTH_REQUIRED'));
});

test('18) efficiency counters track avoided passes and dropped invalid candidates', async () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers remote with TypeScript and AWS');

  const result = await runSourcingWorkflow({
    taskId: 'task_efficiency',
    request,
  }, {
    passExecutor: makePassExecutor([
      { candidates: [makeRaw(1), makeRaw(2), makeRaw(3)], invalidCandidates: 2 },
      { candidates: [makeRaw(4)] },
    ]),
    exporter: makeExporter('ok'),
  });

  assert.ok(result.efficiency);
  assert.equal(result.efficiency?.passBudget, request.maxExtractionPasses);
  assert.equal(result.efficiency?.passesUsed, 1);
  assert.equal(result.efficiency?.passesAvoided, Math.max(0, request.maxExtractionPasses - 1));
  assert.equal(result.efficiency?.invalidCandidatesDropped, 2);
  assert.ok((result.efficiency?.estimatedBrowserStepsAvoided || 0) >= 1);
});
