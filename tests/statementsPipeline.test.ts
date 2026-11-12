import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

// ── 1. Statement repository exports expected functions ──────────────

test("statement repository exports expected CRUD and lifecycle functions", () => {
  const source = read("statements/statementRepository.ts");
  assert.match(source, /export async function ensureStatementSchema/);
  assert.match(source, /export async function upsertStatementDocument/);
  assert.match(source, /export async function listPendingDownloads/);
  assert.match(source, /export async function listPendingParses/);
  assert.match(source, /export async function markDownloaded/);
  assert.match(source, /export async function markDownloadFailed/);
  assert.match(source, /export async function markParsed/);
  assert.match(source, /export async function markParseFailed/);
  assert.match(source, /export async function insertExtractedTransactions/);
  assert.match(source, /export async function getStatementDocumentByMonth/);
  assert.match(source, /export async function listStatementDocuments/);
  assert.match(source, /export async function updateReconcileStatus/);
  assert.match(source, /export async function updateExtractedTransactionMatch/);
});

// ── 2. Statement sync module exports expected functions ─────────────

test("statement sync module exports pipeline, metadata sync, download, and parse functions", () => {
  const source = read("statements/statementSync.ts");
  assert.match(source, /export async function runStatementPipeline/);
  assert.match(source, /export async function syncStatementsMetadataForItem/);
  assert.match(source, /export async function downloadMissingStatementPdfs/);
  assert.match(source, /export async function parseDownloadedStatements/);
});

// ── 3. Statement parser module exports expected functions ───────────

test("statement parser module exports parseStatementText and helpers", () => {
  const source = read("statements/statementParser.ts");
  assert.match(source, /export function parseStatementText/);
  assert.match(source, /export interface ParsedStatementLine/);
  assert.match(source, /export interface StatementParseResult/);
});

// ── 4. Statement reconciler module exports expected functions ───────

test("statement reconciler exports reconcileStatementDocument and reconcileAllForUser", () => {
  const source = read("statements/statementReconciler.ts");
  assert.match(source, /export async function reconcileStatementDocument/);
  assert.match(source, /export async function reconcileAllForUser/);
  assert.match(source, /export interface ReconciliationResult/);
  assert.match(source, /export function descriptionSimilarity/);
});

// ── 5. Unified history module exports expected functions ────────────

test("unified history module exports getTransactionsByMonth, getStatementDocumentForMonth, and getHistoricalCoverageMap", () => {
  const source = read("statements/unifiedHistory.ts");
  assert.match(source, /export async function getTransactionsByMonth/);
  assert.match(source, /export async function getStatementDocumentForMonth/);
  assert.match(source, /export async function getHistoricalCoverageMap/);
  assert.match(source, /export interface UnifiedTransaction/);
  assert.match(source, /export interface HistoricalCoverage/);
});

// ── 6. API routes use enforceApiAuth and enforceRateLimit ──────────

test("statements/history route enforces auth and rate limiting", () => {
  const source = read("app/api/statements/history/route.ts");
  assert.match(source, /enforceApiAuth\(/);
  assert.match(source, /enforceRateLimit\(/);
  assert.match(source, /profile:\s*["']general["']/);
  assert.match(source, /getTransactionsByMonth/);
});

test("statements/documents route enforces auth and rate limiting", () => {
  const source = read("app/api/statements/documents/route.ts");
  assert.match(source, /enforceApiAuth\(/);
  assert.match(source, /enforceRateLimit\(/);
  assert.match(source, /profile:\s*["']general["']/);
  assert.match(source, /getStatementDocumentForMonth/);
});

test("connect/statements/sync route enforces auth and rate limiting", () => {
  const source = read("app/api/connect/statements/sync/route.ts");
  assert.match(source, /enforceApiAuth\(/);
  assert.match(source, /enforceRateLimit\(/);
  assert.match(source, /runStatementPipeline/);
  assert.match(source, /reconcileAllForUser/);
});

// ── 7. Webhook handler references STATEMENTS webhook type ──────────

test("webhook handler handles STATEMENTS webhook type with STATEMENTS_REFRESH_COMPLETE code", () => {
  const source = read("transactions/transactionWebhook.ts");
  assert.match(source, /webhookType\s*===\s*["']STATEMENTS["']/);
  assert.match(source, /STATEMENTS_REFRESH_COMPLETE/);
  assert.match(source, /handleStatementsWebhook/);
  assert.match(source, /runStatementPipeline/);
  assert.match(source, /reconcileAllForUser/);
});

// ── 8. Statement documents table has correct schema fields ─────────

test("statement documents table schema includes required columns", () => {
  const source = read("statements/statementRepository.ts");
  assert.match(source, /statement_documents/);
  assert.match(source, /plaid_statement_id/);
  assert.match(source, /institution_id/);
  assert.match(source, /institution_name/);
  assert.match(source, /account_mask/);
  assert.match(source, /month\s+INTEGER/);
  assert.match(source, /year\s+INTEGER/);
  assert.match(source, /period_start/);
  assert.match(source, /period_end/);
  assert.match(source, /storage_path/);
  assert.match(source, /checksum/);
  assert.match(source, /download_status/);
  assert.match(source, /parse_status/);
  assert.match(source, /reconcile_status/);
  assert.match(source, /source_support_status/);
});

// ── 9. Link service includes "statements" in products ──────────────

test("link service includes statements in Plaid products list", () => {
  const source = read("financial_connectors/linkService.ts");
  assert.match(source, /products:.*\[.*["']statements["'].*\]/s);
});

// ── 10. Plaid client has listStatements and getStatementPdf methods ─

test("plaid client exposes listStatements, getStatementPdf, and refreshStatements methods", () => {
  const source = read("financial_connectors/plaidClient.ts");
  assert.match(source, /async listStatements\(/);
  assert.match(source, /async getStatementPdf\(/);
  assert.match(source, /async refreshStatements\(/);
  assert.match(source, /PlaidStatementMetadata/);
  assert.match(source, /PlaidStatementsListResponse/);
});
