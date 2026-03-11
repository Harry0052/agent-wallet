import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSourcingRequest } from '../lib/sourcing/normalize.ts';
import { toStructuredCandidate } from '../lib/sourcing/extraction.ts';
import { rankCandidates } from '../lib/sourcing/scoring.ts';
import { CandidateMemoryCache, dedupeCandidates, canonicalizeProfileUrl } from '../lib/sourcing/dedupe.ts';
import { buildSourcingExecutionPlan, shouldEarlyStop } from '../lib/sourcing/planner.ts';
import { formatShortlistRows } from '../lib/sourcing/sheetsRows.ts';
import { toSourcingDashboardCard } from '../lib/sourcing/dashboard.ts';
import type { CandidateSourcingTaskRecord } from '../lib/server/sourcingTaskStore.ts';

const prompt = 'Sign in to Indeed, find and shortlist 3 senior software engineers in San Francisco with experience in TypeScript and AWS, then export to Google Sheets';

function makeStructured(overrides: Record<string, unknown> = {}) {
  const request = normalizeSourcingRequest(prompt);
  return toStructuredCandidate({
    raw: {
      sourceUrl: 'https://www.indeed.com/viewjob?jk=abc123',
      fullName: 'Jane Doe',
      currentTitle: 'Senior Software Engineer',
      location: 'San Francisco, CA',
      remoteStatus: 'remote',
      yearsExperience: 9,
      skills: ['TypeScript', 'AWS', 'Node.js'],
      companyHistory: ['Example Inc', 'Acme Corp'],
      education: 'BS Computer Science',
      summary: 'Senior backend engineer focused on distributed systems.',
      extractionConfidence: 0.9,
      ...overrides,
    },
    taskId: 'task_1',
    request,
  });
}

test('1) task intake and normalization', () => {
  const request = normalizeSourcingRequest(prompt);
  assert.equal(request.platform, 'indeed');
  assert.equal(request.shortlistTarget, 3);
  assert.equal(request.seniority, 'senior');
  assert.equal(request.location, 'San Francisco');
  assert.ok(request.requiredSkills.includes('typescript'));
  assert.ok(request.requiredSkills.includes('aws'));
});

test('2) parameter normalization respects remote intent', () => {
  const request = normalizeSourcingRequest('Find 3 senior software engineers remote with Kubernetes and Go skills on Indeed');
  assert.equal(request.remotePreference, 'remote');
  assert.equal(request.location, null);
  assert.ok(request.requiredSkills.includes('go'));
  assert.ok(request.requiredSkills.includes('kubernetes'));
});

test('3) candidate schema validation', () => {
  const valid = makeStructured();
  assert.ok(valid);
  assert.equal(valid?.fullName, 'Jane Doe');

  const invalid = toStructuredCandidate({
    raw: {
      fullName: 'No URL Candidate',
    },
    taskId: 'task_1',
    request: normalizeSourcingRequest(prompt),
  });
  assert.equal(invalid, null);
});

test('4) scoring engine is deterministic', () => {
  const request = normalizeSourcingRequest(prompt);
  const one = makeStructured({ sourceUrl: 'https://www.indeed.com/viewjob?jk=1', fullName: 'A One' });
  const two = makeStructured({ sourceUrl: 'https://www.indeed.com/viewjob?jk=2', fullName: 'B Two', yearsExperience: 7 });
  assert.ok(one && two);

  const first = rankCandidates([one!, two!], request).map((candidate) => `${candidate.sourceUrl}:${candidate.score}`);
  const second = rankCandidates([one!, two!], request).map((candidate) => `${candidate.sourceUrl}:${candidate.score}`);
  assert.deepEqual(first, second);
});

test('5) deduplication removes duplicate candidates', () => {
  const first = makeStructured({ sourceUrl: 'https://www.indeed.com/viewjob?jk=abc123&utm=1' });
  const second = makeStructured({ sourceUrl: 'https://indeed.com/viewjob?jk=abc123' });
  assert.ok(first && second);

  const deduped = dedupeCandidates([first!, second!]);
  assert.equal(deduped.unique.length, 1);
  assert.equal(deduped.removed, 1);
  assert.equal(canonicalizeProfileUrl(first!.sourceUrl), canonicalizeProfileUrl(second!.sourceUrl));
});

test('5b) memory cache deduplicates by candidate identity across URL variants', () => {
  const first = makeStructured({
    sourceUrl: 'https://www.indeed.com/viewjob?jk=abc123',
    extractionConfidence: 0.5,
  });
  const second = makeStructured({
    sourceUrl: 'https://www.indeed.com/pagead/clk?adid=xyz987',
    extractionConfidence: 0.9,
  });

  assert.ok(first && second);

  const cache = new CandidateMemoryCache();
  const addedFirst = cache.upsert(first!);
  const addedSecond = cache.upsert(second!);

  assert.equal(addedFirst, true);
  assert.equal(addedSecond, true); // replaces lower confidence duplicate identity
  assert.equal(cache.size(), 1);
});

test('6) early-stop policy', () => {
  const candidate = makeStructured();
  assert.ok(candidate);
  const shortlist = [
    { ...candidate!, score: 90 },
    { ...candidate!, sourceUrl: 'https://www.indeed.com/viewjob?jk=2', score: 88 },
    { ...candidate!, sourceUrl: 'https://www.indeed.com/viewjob?jk=3', score: 85 },
  ];

  const stop = shouldEarlyStop({
    shortlisted: shortlist,
    target: 3,
    threshold: 72,
    passIndex: 0,
    maxPasses: 2,
    alternativesImproving: false,
  });

  assert.equal(stop, true);
});

test('7) planner step minimization and bounds', () => {
  const request = normalizeSourcingRequest(prompt);
  const plan = buildSourcingExecutionPlan(request);
  assert.ok(plan.searchQueries.length >= 1);
  assert.ok(plan.searchQueries.length <= request.maxExtractionPasses);
  assert.equal(plan.bounds.maxResultPages, request.maxResultPages);
  assert.equal(plan.bounds.maxProfilesOpened, request.maxProfilesOpened);
});

test('8) export formatting generates expected sheet rows', () => {
  const request = normalizeSourcingRequest(prompt);
  const one = makeStructured({ sourceUrl: 'https://www.indeed.com/viewjob?jk=1', fullName: 'Candidate One', score: 91 });
  const two = makeStructured({ sourceUrl: 'https://www.indeed.com/viewjob?jk=2', fullName: 'Candidate Two', score: 87 });
  assert.ok(one && two);

  const rows = formatShortlistRows({
    request,
    shortlist: [one!, two!],
  });

  assert.equal(rows[0][0], 'Rank');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], 'Candidate One');
  assert.equal(rows[2][1], 'Candidate Two');
});

test('9) dashboard result mapping includes sheet and preview', () => {
  const candidate = makeStructured({ score: 93 });
  assert.ok(candidate);

  const record: CandidateSourcingTaskRecord = {
    id: 'task_1',
    userId: 'user_1',
    taskType: 'candidate_sourcing_task',
    intent: 'Find senior engineers',
    status: 'completed',
    input: null,
    result: {
      taskId: 'task_1',
      status: 'completed',
      summary: 'done',
      normalizedRequest: normalizeSourcingRequest(prompt),
      executionPlan: buildSourcingExecutionPlan(normalizeSourcingRequest(prompt)),
      extractedCandidates: [candidate!],
      shortlist: [candidate!],
      metrics: {
        totalExtracted: 1,
        dedupedCount: 1,
        extractionPasses: 1,
        profilesVisited: 1,
        resultPagesVisited: 1,
        retriesUsed: 0,
        earlyStopTriggered: true,
        scoringDurationMs: 1,
        exportDurationMs: 1,
        totalDurationMs: 2,
      },
      export: {
        sheetId: 'sheet_1',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet_1/edit',
        tabName: 'Shortlist',
        rowsWritten: 1,
        exportedAt: new Date().toISOString(),
      },
      errors: [],
      actionLogs: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const card = toSourcingDashboardCard(record);
  assert.equal(card.shortlistCount, 1);
  assert.equal(card.sheetUrl, 'https://docs.google.com/spreadsheets/d/sheet_1/edit');
  assert.equal(card.shortlistPreview[0]?.fullName, candidate?.fullName);
});
