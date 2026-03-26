import "server-only";

const PARSER_VERSION = "1.0.0";

export interface ParsedStatementLine {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  direction: "debit" | "credit";
  runningBalance: number | null;
  confidence: number; // 0-1
}

export interface StatementParseResult {
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;
  lines: ParsedStatementLine[];
  accountMask: string | null;
  parserVersion: string;
  rawLineCount: number;
  extractedLineCount: number;
  averageConfidence: number;
  warnings: string[];
}

// ── Date pattern helpers ──────────────────────────────────────────────

// MM/DD/YYYY or MM-DD-YYYY
const DATE_FULL_RE = /\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})\b/;
// MM/DD or MM-DD (no year — use hint year)
const DATE_SHORT_RE = /\b(\d{1,2})[/\-](\d{1,2})\b/;

function parseDateFromMatch(
  match: RegExpMatchArray,
  hintYear: number,
  hintMonth: number,
  isFullDate: boolean,
): string | null {
  const m = parseInt(match[1], 10);
  const d = parseInt(match[2], 10);
  const y = isFullDate ? parseInt(match[3], 10) : hintYear;

  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const yyyy = y < 100 ? 2000 + y : y;
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");

  // Basic sanity: reject dates too far from hint month (allow adjacent months)
  if (!isFullDate) {
    const diff = Math.abs(m - hintMonth);
    if (diff > 2 && diff < 10) return null;
  }

  return `${yyyy}-${mm}-${dd}`;
}

function extractDate(
  line: string,
  hintYear: number,
  hintMonth: number,
): { date: string; confidence: number } | null {
  const fullMatch = line.match(DATE_FULL_RE);
  if (fullMatch) {
    const date = parseDateFromMatch(fullMatch, hintYear, hintMonth, true);
    if (date) return { date, confidence: 0.95 };
  }

  const shortMatch = line.match(DATE_SHORT_RE);
  if (shortMatch) {
    const date = parseDateFromMatch(shortMatch, hintYear, hintMonth, false);
    if (date) return { date, confidence: 0.7 };
  }

  return null;
}

// ── Amount pattern helpers ────────────────────────────────────────────

// Matches amounts like $1,234.56 or 1234.56 or -$12.34 or ($500.00)
const AMOUNT_RE = /(?:\(?)\$?-?\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\)?/g;

function extractAmounts(line: string): number[] {
  const amounts: number[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(AMOUNT_RE.source, "g");
  while ((match = re.exec(line)) !== null) {
    const raw = match[1].replace(/,/g, "");
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed >= 0.01) {
      amounts.push(parsed);
    }
  }
  return amounts;
}

// ── Direction detection ───────────────────────────────────────────────

function detectDirection(
  line: string,
  _amount: number,
): "debit" | "credit" {
  const upper = line.toUpperCase();

  // Explicit DR/CR markers
  if (/\bDR\.?\b/.test(upper) || /\bDEBIT\b/.test(upper)) return "debit";
  if (/\bCR\.?\b/.test(upper) || /\bCREDIT\b/.test(upper)) return "credit";

  // Negative sign or parens typically mean debit
  if (/\(\$?\d/.test(line) || /\-\s*\$?\d/.test(line)) return "debit";

  // Positive keywords
  if (/\bDEPOSIT\b/.test(upper) || /\bREFUND\b/.test(upper) || /\bPAYMENT\s+RECEIVED\b/.test(upper)) {
    return "credit";
  }

  // Default assumption: amounts on statements are debits (purchases)
  return "debit";
}

// ── Period detection ──────────────────────────────────────────────────

const PERIOD_RE =
  /(?:statement\s+period|billing\s+period|period)[:\s]+(\S+)\s+(?:to|through|-|–)\s+(\S+)/i;
const ACCOUNT_MASK_RE = /(?:account|acct)\.?\s*(?:ending\s+in|#|no\.?)\s*(\d{3,4})/i;

function extractPeriod(
  lines: string[],
  hintYear: number,
  _hintMonth: number,
): { periodStart: string | null; periodEnd: string | null } {
  for (const line of lines) {
    const match = line.match(PERIOD_RE);
    if (!match) continue;

    const startStr = match[1];
    const endStr = match[2];

    const startDate = parseLooseDate(startStr, hintYear);
    const endDate = parseLooseDate(endStr, hintYear);

    if (startDate || endDate) {
      return { periodStart: startDate, periodEnd: endDate };
    }
  }
  return { periodStart: null, periodEnd: null };
}

function parseLooseDate(value: string, hintYear: number): string | null {
  // Try direct parse
  const parsed = Date.parse(value);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Try MM/DD/YYYY
  const full = value.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
  if (full) {
    const y = parseInt(full[3], 10);
    const yyyy = y < 100 ? 2000 + y : y;
    const mm = String(parseInt(full[1], 10)).padStart(2, "0");
    const dd = String(parseInt(full[2], 10)).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  // Try MM/DD
  const short = value.match(/^(\d{1,2})[/\-](\d{1,2})$/);
  if (short) {
    const mm = String(parseInt(short[1], 10)).padStart(2, "0");
    const dd = String(parseInt(short[2], 10)).padStart(2, "0");
    return `${hintYear}-${mm}-${dd}`;
  }

  return null;
}

function extractAccountMask(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(ACCOUNT_MASK_RE);
    if (match) return match[1];
  }
  return null;
}

// ── Merchant normalization (mirrors transactionNormalizer) ─────────

function normalizeMerchantName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Main parser ───────────────────────────────────────────────────────

export function parseStatementText(
  text: string,
  hints: {
    year: number;
    month: number;
    institutionName?: string;
  },
): StatementParseResult {
  const warnings: string[] = [];
  const rawLines = text.split(/\r?\n/);
  const rawLineCount = rawLines.length;

  if (rawLineCount === 0) {
    return {
      periodStart: null,
      periodEnd: null,
      lines: [],
      accountMask: null,
      parserVersion: PARSER_VERSION,
      rawLineCount: 0,
      extractedLineCount: 0,
      averageConfidence: 0,
      warnings: ["Empty statement text provided."],
    };
  }

  // Extract header metadata from first ~30 lines
  const headerLines = rawLines.slice(0, Math.min(30, rawLines.length));
  const { periodStart, periodEnd } = extractPeriod(headerLines, hints.year, hints.month);
  const accountMask = extractAccountMask(headerLines);

  const parsedLines: ParsedStatementLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line || line.length < 8) continue;

    // Skip header-like lines
    if (/^(date|description|amount|balance|transaction)\b/i.test(line)) continue;
    if (/^-{3,}$/.test(line) || /^={3,}$/.test(line)) continue;
    if (/^page\s+\d/i.test(line)) continue;

    const dateResult = extractDate(line, hints.year, hints.month);
    if (!dateResult) continue;

    const amounts = extractAmounts(line);
    if (amounts.length === 0) {
      warnings.push(`Line ${i + 1}: date found but no amount — skipped.`);
      continue;
    }

    // The main transaction amount is typically the first (or only) amount.
    // If there are multiple amounts, the last one is often a running balance.
    const amount = amounts[0];
    const runningBalance = amounts.length >= 2 ? amounts[amounts.length - 1] : null;

    // Extract description: text between date and first amount
    const dateMatch = line.match(DATE_FULL_RE) || line.match(DATE_SHORT_RE);
    let description = line;
    if (dateMatch && dateMatch.index !== undefined) {
      const afterDate = line.slice(dateMatch.index + dateMatch[0].length).trim();
      // Remove amounts from the tail to isolate the description
      const amountMatch = afterDate.match(AMOUNT_RE);
      if (amountMatch && amountMatch.index !== undefined) {
        description = afterDate.slice(0, amountMatch.index).trim();
      } else {
        description = afterDate;
      }
    }

    // Clean up description
    description = description
      .replace(/\s+/g, " ")
      .replace(/^[,\-–]\s*/, "")
      .replace(/[,\-–]\s*$/, "")
      .trim();

    if (!description) {
      description = "Unknown";
      warnings.push(`Line ${i + 1}: empty description.`);
    }

    const direction = detectDirection(line, amount);

    // Confidence: starts from date confidence, adjust down for missing info
    let confidence = dateResult.confidence;
    if (description === "Unknown") confidence *= 0.6;
    if (amounts.length > 3) {
      confidence *= 0.7;
      warnings.push(`Line ${i + 1}: multiple amounts found — may be misinterpreted.`);
    }

    parsedLines.push({
      date: dateResult.date,
      description: normalizeMerchantName(description),
      amount,
      direction,
      runningBalance,
      confidence: Math.round(confidence * 1000) / 1000,
    });
  }

  const avgConfidence =
    parsedLines.length > 0
      ? parsedLines.reduce((sum, l) => sum + l.confidence, 0) / parsedLines.length
      : 0;

  if (parsedLines.length === 0 && rawLineCount > 0) {
    warnings.push("No transaction lines could be extracted from the statement text.");
  }

  return {
    periodStart,
    periodEnd,
    lines: parsedLines,
    accountMask,
    parserVersion: PARSER_VERSION,
    rawLineCount,
    extractedLineCount: parsedLines.length,
    averageConfidence: Math.round(avgConfidence * 1000) / 1000,
    warnings,
  };
}
