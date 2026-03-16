import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSinceDaysAgo,
  decideBackfillStep,
  isBackfillFresh,
  normalizeBackfillOptions,
  resolveFreshnessHours,
} from '../lib/server/engines/backfillPolicy.ts';

test('since-days normalization clamps to safe bounds', () => {
  assert.equal(clampSinceDaysAgo(undefined), 30);
  assert.equal(clampSinceDaysAgo(0), 1);
  assert.equal(clampSinceDaysAgo(365), 365);
  assert.equal(clampSinceDaysAgo(999), 365);
});

test('freshness helper only returns true for recent, parseable timestamps', () => {
  const now = Date.parse('2026-03-15T00:00:00.000Z');
  assert.equal(
    isBackfillFresh('2026-03-14T21:00:00.000Z', now, 6),
    true,
  );
  assert.equal(
    isBackfillFresh('2026-03-14T12:00:00.000Z', now, 6),
    false,
  );
  assert.equal(isBackfillFresh('not-a-date', now, 6), false);
  assert.equal(isBackfillFresh(null, now, 6), false);
});

test('freshness hours resolve to per-engine defaults when override is invalid', () => {
  assert.equal(resolveFreshnessHours('insights', undefined), 6);
  assert.equal(resolveFreshnessHours('health', 0), 1);
  assert.equal(resolveFreshnessHours('cashflow', 18), 18);
});

test('step decision skips only when data is fresh and force is not enabled', () => {
  const now = Date.parse('2026-03-15T00:00:00.000Z');
  const base = normalizeBackfillOptions({
    sinceDaysAgo: 14,
    nowMs: now,
  });

  const skipDecision = decideBackfillStep({
    engine: 'tasks',
    options: base,
    lastGeneratedAt: '2026-03-14T23:00:00.000Z',
  });
  assert.equal(skipDecision.skip, true);
  assert.equal(skipDecision.reason, 'fresh_data');

  const forceDecision = decideBackfillStep({
    engine: 'tasks',
    options: normalizeBackfillOptions({
      sinceDaysAgo: 14,
      nowMs: now,
      force: true,
    }),
    lastGeneratedAt: '2026-03-14T23:00:00.000Z',
  });
  assert.equal(forceDecision.skip, false);
  assert.equal(forceDecision.reason, 'run_required');
});
