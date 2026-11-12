import "server-only";

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { previousProductPrefix } from "@/lib/previousName";
import { getPlaidClient } from "@/financial_connectors/plaidClient";
import { logServerEvent } from "@/lib/server/observability";
import {
  insertExtractedTransactions,
  listPendingDownloads,
  listPendingParses,
  markDownloadFailed,
  markDownloaded,
  markParsed,
  markParseFailed,
  upsertStatementDocument,
  type ExtractedTransactionInput,
  type StatementDocumentRow,
} from "@/statements/statementRepository";
import { parseStatementText } from "@/statements/statementParser";

// ── Types ─────────────────────────────────────────────────────────────

export interface StatementPipelineResult {
  metadataSynced: number;
  downloaded: number;
  parsed: number;
  extractedLines: number;
  errors: string[];
}

// ── Plaid response types ──────────────────────────────────────────────

interface PlaidStatementMetadata {
  statement_id: string;
  account_id: string | null;
  month: number; // 1-12
  year: number;
}

interface PlaidStatementsListResponse {
  accounts: Array<{
    account_id: string;
    account_mask: string | null;
    statements: PlaidStatementMetadata[];
  }>;
  institution_id: string;
  institution_name: string;
  request_id: string;
}

// ── Configuration ─────────────────────────────────────────────────────

function getStorageBasePath(): string {
  const configured = process.env.STATEMENT_STORAGE_PATH;
  if (configured) return configured;

  const nextDirectory = "/tmp/agent-wallet-statements";
  const previousDirectory = `/tmp/${previousProductPrefix()}-statements`;
  if (!existsSync(nextDirectory) && existsSync(previousDirectory)) {
    return previousDirectory;
  }
  return nextDirectory;
}

function getStatementLookbackYears(): number {
  const raw = process.env.STATEMENT_LOOKBACK_YEARS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 10) return parsed;
  }
  return 2;
}

function buildStoragePath(
  userId: string,
  year: number,
  month: number,
  statementId: string,
): string {
  const base = getStorageBasePath();
  const mm = String(month).padStart(2, "0");
  return join(base, userId, String(year), `${mm}_${statementId}.pdf`);
}

function computeChecksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ── Plaid API helpers ─────────────────────────────────────────────────

/**
 * Calls Plaid /statements/list using the client's internal request method.
 * The PlaidClient does not expose a dedicated listStatements method, so we
 * reach through to the underlying HTTP helper.
 */
async function plaidListStatements(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<PlaidStatementsListResponse> {
  const plaid = getPlaidClient();
  // Access the private request method on the PlaidClient instance
  const requestFn = (plaid as unknown as {
    request: <T extends object>(path: string, payload: Record<string, unknown>) => Promise<T>;
  }).request.bind(plaid);

  return requestFn<PlaidStatementsListResponse>("/statements/list", {
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate,
  });
}

/**
 * Calls Plaid /statements/download to retrieve raw PDF bytes.
 */
async function plaidDownloadStatementPdf(
  accessToken: string,
  statementId: string,
): Promise<Buffer> {
  const plaid = getPlaidClient();
  const requestFn = (plaid as unknown as {
    request: <T extends object>(path: string, payload: Record<string, unknown>) => Promise<T>;
  }).request.bind(plaid);

  const response = await requestFn<{ pdf: string }>("/statements/download", {
    access_token: accessToken,
    statement_id: statementId,
  });

  if (response.pdf && typeof response.pdf === "string") {
    return Buffer.from(response.pdf, "base64");
  }

  throw new Error("Unexpected response format from Plaid statements/download.");
}

// ── Metadata sync ─────────────────────────────────────────────────────

export async function syncStatementsMetadataForItem(params: {
  userId: string;
  itemId: string;
  plaidItemId: string;
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
}): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  logServerEvent("info", "statements.metadata.sync_start", {
    userId: params.userId,
    itemId: params.itemId,
    plaidItemId: params.plaidItemId,
  });

  const now = new Date();
  const lookbackYears = getStatementLookbackYears();
  const startDate = new Date(now.getFullYear() - lookbackYears, now.getMonth(), 1);

  const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-01`;
  const endStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  let response: PlaidStatementsListResponse;
  try {
    response = await plaidListStatements(params.accessToken, startStr, endStr);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logServerEvent("error", "statements.metadata.plaid_list_failed", {
      userId: params.userId,
      plaidItemId: params.plaidItemId,
      error: message,
    });
    errors.push(`Plaid statements/list failed: ${message}`);
    return { synced, errors };
  }

  const institutionId = params.institutionId || response.institution_id || null;
  const institutionName = params.institutionName || response.institution_name || null;

  for (const account of response.accounts) {
    for (const stmt of account.statements) {
      try {
        await upsertStatementDocument({
          userId: params.userId,
          itemId: params.itemId,
          plaidAccountId: stmt.account_id || account.account_id,
          plaidStatementId: stmt.statement_id,
          institutionId,
          institutionName,
          accountMask: account.account_mask,
          month: stmt.month,
          year: stmt.year,
        });
        synced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        errors.push(`Failed to upsert statement ${stmt.statement_id}: ${message}`);
        logServerEvent("warn", "statements.metadata.upsert_failed", {
          userId: params.userId,
          statementId: stmt.statement_id,
          error: message,
        });
      }
    }
  }

  logServerEvent("info", "statements.metadata.sync_complete", {
    userId: params.userId,
    itemId: params.itemId,
    synced,
    errorCount: errors.length,
  });

  return { synced, errors };
}

// ── PDF download ──────────────────────────────────────────────────────

async function downloadSingleStatementPdf(
  doc: StatementDocumentRow,
  accessToken: string,
): Promise<{ success: boolean; error?: string }> {
  const storagePath = buildStoragePath(doc.user_id, doc.year, doc.month, doc.plaid_statement_id);

  try {
    const pdfBuffer = await plaidDownloadStatementPdf(accessToken, doc.plaid_statement_id);

    await mkdir(dirname(storagePath), { recursive: true });
    await writeFile(storagePath, pdfBuffer);

    const checksum = computeChecksum(pdfBuffer);
    await markDownloaded(doc.id, storagePath, checksum);

    logServerEvent("info", "statements.pdf.downloaded", {
      docId: doc.id,
      storagePath,
      sizeBytes: pdfBuffer.length,
      checksum,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    await markDownloadFailed(doc.id, message);
    return { success: false, error: message };
  }
}

export async function downloadMissingStatementPdfs(userId: string): Promise<{
  downloaded: number;
  failed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let downloaded = 0;
  let failed = 0;

  const pendingDocs = await listPendingDownloads(userId);
  if (pendingDocs.length === 0) {
    return { downloaded, failed, errors };
  }

  logServerEvent("info", "statements.download.batch_start", {
    userId,
    pendingCount: pendingDocs.length,
  });

  // Get access tokens for all connected items
  const { listConnectorItemSecretsForUser } = await import(
    "@/financial_connectors/tokenVault"
  );
  const itemSecrets = await listConnectorItemSecretsForUser(userId);

  // Build a map from plaid_item_id to access_token
  const tokenByPlaidItemId = new Map<string, string>();
  for (const secret of itemSecrets) {
    tokenByPlaidItemId.set(secret.plaid_item_id, secret.plaid_access_token);
  }

  // Group docs by item_id for batched processing
  const docsByItem = new Map<string, StatementDocumentRow[]>();
  for (const doc of pendingDocs) {
    const existing = docsByItem.get(doc.item_id) || [];
    existing.push(doc);
    docsByItem.set(doc.item_id, existing);
  }

  for (const [itemId, docs] of docsByItem) {
    // Find the access token. We iterate secrets since the internal item_id
    // is not the same as plaid_item_id; pick the first available token.
    let accessToken: string | null = null;
    for (const secret of itemSecrets) {
      accessToken = secret.plaid_access_token;
      break;
    }

    if (!accessToken) {
      const msg = `No access token found for item ${itemId}`;
      errors.push(msg);
      logServerEvent("warn", "statements.download.no_token", { userId, itemId });
      for (const doc of docs) {
        await markDownloadFailed(doc.id, msg);
      }
      failed += docs.length;
      continue;
    }

    for (const doc of docs) {
      const result = await downloadSingleStatementPdf(doc, accessToken);
      if (result.success) {
        downloaded += 1;
      } else {
        failed += 1;
        if (result.error) errors.push(result.error);
      }
    }
  }

  logServerEvent("info", "statements.download.batch_complete", {
    userId,
    downloaded,
    failed,
  });

  return { downloaded, failed, errors };
}

// ── Parse ─────────────────────────────────────────────────────────────

export async function parseDownloadedStatements(userId: string): Promise<{
  parsed: number;
  failed: number;
  extractedLines: number;
}> {
  let parsed = 0;
  let failed = 0;
  let extractedLines = 0;

  const pendingDocs = await listPendingParses(userId);
  if (pendingDocs.length === 0) {
    return { parsed, failed, extractedLines };
  }

  logServerEvent("info", "statements.parse.batch_start", {
    userId,
    pendingCount: pendingDocs.length,
  });

  for (const doc of pendingDocs) {
    try {
      if (!doc.storage_path) {
        await markParseFailed(doc.id, "No storage path — PDF not downloaded.");
        failed += 1;
        continue;
      }

      let fileData: Buffer;
      try {
        fileData = await readFile(doc.storage_path);
      } catch {
        await markParseFailed(doc.id, `File not found at ${doc.storage_path}`);
        failed += 1;
        continue;
      }

      // Attempt naive text extraction from the raw PDF buffer.
      // Many PDFs embed uncompressed text streams that we can read.
      const rawText = extractTextFromPdfBuffer(fileData);

      if (!rawText || rawText.trim().length < 20) {
        await markParseFailed(
          doc.id,
          "PDF text extraction yielded insufficient text. A PDF parsing library is required.",
        );
        failed += 1;
        continue;
      }

      const parseResult = parseStatementText(rawText, {
        year: doc.year,
        month: doc.month,
        institutionName: doc.institution_name || undefined,
      });

      if (parseResult.lines.length === 0) {
        await markParseFailed(
          doc.id,
          `No transaction lines extracted. Warnings: ${parseResult.warnings.join("; ")}`,
        );
        failed += 1;
        continue;
      }

      const extractedRows: ExtractedTransactionInput[] = parseResult.lines.map((line) => ({
        userId: doc.user_id,
        itemId: doc.item_id,
        plaidAccountId: doc.plaid_account_id,
        statementDocumentId: doc.id,
        postedDate: line.date,
        descriptionRaw: line.description,
        descriptionNormalized: line.description,
        amount: line.amount,
        currency: "USD",
        direction: line.direction,
        runningBalance: line.runningBalance,
        extractionConfidence: line.confidence,
        category: null,
      }));

      const insertedCount = await insertExtractedTransactions(extractedRows);
      extractedLines += insertedCount;

      await markParsed(doc.id, parseResult.periodStart, parseResult.periodEnd);
      parsed += 1;

      logServerEvent("info", "statements.parse.document_complete", {
        docId: doc.id,
        extractedLineCount: parseResult.extractedLineCount,
        averageConfidence: parseResult.averageConfidence,
        warningCount: parseResult.warnings.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      await markParseFailed(doc.id, message);
      failed += 1;

      logServerEvent("error", "statements.parse.document_failed", {
        docId: doc.id,
        error: message,
      });
    }
  }

  logServerEvent("info", "statements.parse.batch_complete", {
    userId,
    parsed,
    failed,
    extractedLines,
  });

  return { parsed, failed, extractedLines };
}

/**
 * Naive text extraction from a PDF buffer. Looks for text streams
 * between BT/ET operators and extracts string operands from Tj/TJ ops.
 * This handles simple, uncompressed PDFs. For production use, a proper
 * PDF library (pdf-parse, pdfjs-dist) should be installed.
 */
function extractTextFromPdfBuffer(data: Buffer): string {
  const raw = data.toString("latin1");
  const textChunks: string[] = [];

  // Match text between BT (begin text) and ET (end text) blocks
  const btEtRe = /BT\s([\s\S]*?)ET/g;
  let btMatch: RegExpExecArray | null;
  while ((btMatch = btEtRe.exec(raw)) !== null) {
    const block = btMatch[1];

    // Extract Tj operand strings: (text) Tj
    const tjRe = /\(([^)]*)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRe.exec(block)) !== null) {
      textChunks.push(tjMatch[1]);
    }

    // Extract TJ array strings: [(text)] TJ
    const tjArrayRe = /\[([^\]]*)\]\s*TJ/gi;
    let arrMatch: RegExpExecArray | null;
    while ((arrMatch = tjArrayRe.exec(block)) !== null) {
      const inner = arrMatch[1];
      const strRe = /\(([^)]*)\)/g;
      let strMatch: RegExpExecArray | null;
      while ((strMatch = strRe.exec(inner)) !== null) {
        textChunks.push(strMatch[1]);
      }
    }
  }

  return textChunks.join(" ").replace(/\s+/g, " ").trim();
}

// ── Full pipeline ─────────────────────────────────────────────────────

export async function runStatementPipeline(params: {
  userId: string;
  itemId: string;
  plaidItemId: string;
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
}): Promise<StatementPipelineResult> {
  const errors: string[] = [];

  logServerEvent("info", "statements.pipeline.start", {
    userId: params.userId,
    itemId: params.itemId,
  });

  // Step 1: Sync metadata from Plaid
  const metadataResult = await syncStatementsMetadataForItem(params);
  errors.push(...metadataResult.errors);

  // Step 2: Download missing PDFs
  const downloadResult = await downloadMissingStatementPdfs(params.userId);
  errors.push(...downloadResult.errors);

  // Step 3: Parse downloaded statements
  const parseResult = await parseDownloadedStatements(params.userId);

  const pipelineResult: StatementPipelineResult = {
    metadataSynced: metadataResult.synced,
    downloaded: downloadResult.downloaded,
    parsed: parseResult.parsed,
    extractedLines: parseResult.extractedLines,
    errors,
  };

  logServerEvent("info", "statements.pipeline.complete", {
    userId: params.userId,
    itemId: params.itemId,
    metadataSynced: pipelineResult.metadataSynced,
    downloaded: pipelineResult.downloaded,
    parsed: pipelineResult.parsed,
    extractedLines: pipelineResult.extractedLines,
    errorCount: errors.length,
  });

  return pipelineResult;
}
