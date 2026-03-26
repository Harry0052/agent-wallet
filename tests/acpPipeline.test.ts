import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

// ── 1. Goal renderer exports expected functions ─────────────────────────────

test("goal renderer exports renderTinyFishGoal, selectBrowserProfile, and selectEndpoint", () => {
  const source = read("lib/server/automation/providers/goalRenderer.ts");
  assert.match(source, /export function renderTinyFishGoal\(/);
  assert.match(source, /export function selectBrowserProfile\(/);
  assert.match(source, /export function selectEndpoint\(/);
});

// ── 2. Goal renderer output contains required sections ──────────────────────

test("goal renderer contains objective, policy limits, steps, stop conditions, and return schema sections", () => {
  const source = read("lib/server/automation/providers/goalRenderer.ts");
  assert.match(source, /OBJECTIVE:/);
  assert.match(source, /USER-APPROVED POLICY LIMITS:/);
  assert.match(source, /EXECUTION STEPS:/);
  assert.match(source, /STOP CONDITIONS/);
  assert.match(source, /RETURN FORMAT \(JSON\):/);
  assert.match(source, /DUPLICATE PROTECTION:/);
});

// ── 3. Completion validator exports validateCompletion ──────────────────────

test("completion validator exports validateCompletion function", () => {
  const source = read("lib/server/automation/providers/completionValidator.ts");
  assert.match(source, /export function validateCompletion\(/);
});

// ── 4. Completion validator contains all four verdicts ──────────────────────

test("completion validator defines all four verdict codes", () => {
  const source = read("lib/server/automation/providers/completionValidator.ts");
  assert.match(source, /VERIFIED_COMPLETE/);
  assert.match(source, /NEEDS_USER_REVIEW/);
  assert.match(source, /FAILED/);
  assert.match(source, /NO_ACTION_TAKEN/);
});

// ── 5. SSE stream route uses enforceApiAuth and enforceRateLimit ────────────

test("tasks/stream route enforces auth and rate limiting", () => {
  const source = read("app/api/tasks/stream/route.ts");
  assert.match(source, /enforceApiAuth\(/);
  assert.match(source, /enforceRateLimit\(/);
  assert.match(source, /text\/event-stream/);
});

// ── 6. Journal route uses enforceApiAuth and enforceRateLimit ───────────────

test("tasks/journal route enforces auth and rate limiting", () => {
  const source = read("app/api/tasks/journal/route.ts");
  assert.match(source, /enforceApiAuth\(/);
  assert.match(source, /enforceRateLimit\(/);
  assert.match(source, /getActionJournal/);
});

// ── 7. TinyFish adapter imports and uses goalRenderer and validator ─────────

test("tinyFish adapter imports renderTinyFishGoal and validateCompletion", () => {
  const source = read("lib/server/automation/providers/tinyFishAdapter.ts");
  assert.match(source, /import.*renderTinyFishGoal.*from.*goalRenderer/);
  assert.match(source, /import.*validateCompletion.*from.*completionValidator/);
  assert.match(source, /renderTinyFishGoal\(/);
  assert.match(source, /validateCompletion\(/);
});

// ── 8. Control Center page exists and imports ControlCenter component ───────

test("control page exists and imports ControlCenter component", () => {
  const source = read("app/(app)/control/page.tsx");
  assert.match(source, /import.*ControlCenter.*from/);
  assert.match(source, /ControlCenter/);
});

// ── 9. AppNav includes /control route ───────────────────────────────────────

test("AppNav includes /control route", () => {
  const source = read("components/AppNav.tsx");
  assert.match(source, /\/control/);
});

// ── 10. Store exports getActionJournal function ─────────────────────────────

test("automation store exports getActionJournal function", () => {
  const source = read("lib/server/automation/store.ts");
  assert.match(source, /export async function getActionJournal\(/);
});

// ── 11. Detectors file contains detector functions ──────────────────────────

test("detectors file exports detection functions", () => {
  const source = read("lib/server/automation/detectors.ts");
  assert.match(source, /export function detectRecurringChargePatterns\(/);
  assert.match(source, /export function detectTrialConversions\(/);
  assert.match(source, /export function detectRefundBudgetFlows\(/);
  assert.match(source, /export function detectSplitEligibleBills\(/);
  assert.match(source, /export function detectAutomationCandidates\(/);
});

// ── 12. ActionPlanner marks savings_transfer as live ────────────────────────

test("supported action types list includes savings_transfer with live status", () => {
  const source = read("lib/server/automation/providers/types.ts");
  const savingsBlock = source.match(/actionType:\s*['"]savings_transfer['"][\s\S]*?live:\s*(true|false)/);
  assert.ok(savingsBlock, "savings_transfer entry must exist in SUPPORTED_ACTIONS");
  assert.equal(savingsBlock[1], "true", "savings_transfer should have live: true");
});

// ── 13. Governor exports cooldownUntilForActionType and suppression ─────────

test("governor exports cooldownUntilForActionType and evaluateAutomationCandidateSuppression", () => {
  const source = read("lib/server/automation/governor.ts");
  assert.match(source, /export function cooldownUntilForActionType\(/);
  assert.match(source, /export function evaluateAutomationCandidateSuppression\(/);
});

// ── 14. Migration file contains rendered_goal and tinyfish_result columns ───

test("ACP journal migration adds rendered_goal and tinyfish_result columns", () => {
  const source = read("db/migrations/20260325_acp_journal_columns.sql");
  assert.match(source, /rendered_goal/);
  assert.match(source, /tinyfish_result/);
  assert.match(source, /rollback_possible/);
  assert.match(source, /rollback_notes/);
});

// ── 15. Services/taskCenter exports fetchActionJournal and streamActionExecution ─

test("taskCenter service exports fetchActionJournal and streamActionExecution", () => {
  const source = read("services/taskCenter.ts");
  assert.match(source, /export async function fetchActionJournal\(/);
  assert.match(source, /export function streamActionExecution\(/);
  assert.match(source, /EventSource/);
});
