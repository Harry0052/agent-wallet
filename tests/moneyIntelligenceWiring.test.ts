import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/harry/agent wallet";

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

test("smart home payload exposes money intelligence and expanded affordability windows", () => {
  const source = read("lib/server/smartHome.ts");
  assert.match(source, /moneyIntelligence:/);
  assert.match(source, /safeToSpendThisWeek/);
  assert.match(source, /safeToSpendThisMonth/);
  assert.match(source, /safeToSpendUntilNextIncome/);
  assert.match(source, /studentFocus/);
});

test("unified statements route enriches response with money intelligence payload", () => {
  const source = read("app/api/statements/unified/route.ts");
  assert.match(source, /buildMoneyIntelligenceForUser/);
  assert.match(source, /money_intelligence/);
  assert.match(source, /statement:\s*\{/);
  assert.match(source, /studentFocus/);
});

test("statement workspace renders student-focus cards from money intelligence", () => {
  const source = read("components/StatementsWorkspace.tsx");
  assert.match(source, /Student Focus Cards/);
  assert.match(source, /studentFocus\.cards/);
  assert.match(source, /studentCardStatusLabel/);
});

test("smart home and unified statements wire advanced intelligence payloads", () => {
  const homeSource = read("lib/server/smartHome.ts");
  const statementsSource = read("app/api/statements/unified/route.ts");
  assert.match(homeSource, /advancedIntelligence/);
  assert.match(statementsSource, /advancedIntelligence/);
});

test("advanced intelligence API route supports baseline and what-if simulation", () => {
  const source = read("app/api/intelligence/advanced/route.ts");
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  assert.match(source, /simulateCustomFinancialScenario/);
});

test("category correction route is auth/rate-limited and records learnable corrections", () => {
  const source = read("app/api/statements/category-corrections/route.ts");
  assert.match(source, /enforceApiAuth/);
  assert.match(source, /enforceRateLimit/);
  assert.match(source, /recordCategoryCorrection/);
  assert.match(source, /listCategoryLearningRules/);
});
