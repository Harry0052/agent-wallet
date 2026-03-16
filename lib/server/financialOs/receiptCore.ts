import type { DeterministicReceiptLineItem, DeterministicReceiptParseResult } from "./types";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

function parseCurrencyValue(raw: string): number | null {
  const cleaned = raw
    .replace(/[, ]/g, "")
    .replace(/^\$/, "")
    .replace(/^USD/i, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return round(parsed);
}

function parseDateFromText(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const patterns = [
    /\b(\d{4})[-/](\d{2})[-/](\d{2})\b/,
    /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/,
    /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const parsed = Date.parse(match[0]);
    if (!Number.isFinite(parsed)) continue;
    return new Date(parsed).toISOString();
  }

  return null;
}

function pickMerchantLine(lines: string[]): string | null {
  for (const line of lines.slice(0, 6)) {
    const value = line.trim();
    if (!value) continue;
    if (/\b(receipt|invoice|tax|date|time|order)\b/i.test(value)) continue;
    if (/[0-9]{3,}/.test(value) && value.length > 24) continue;
    if (value.length < 2 || value.length > 80) continue;
    return normalizeWhitespace(value);
  }
  return null;
}

function parseLineItems(lines: string[]): DeterministicReceiptLineItem[] {
  const items: DeterministicReceiptLineItem[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 4) continue;
    if (/\b(total|subtotal|tax|tip|balance|amount due)\b/i.test(trimmed)) continue;
    const moneyMatch = trimmed.match(/(-?\$?\d+(?:\.\d{2})?)\s*$/);
    if (!moneyMatch) continue;
    const amount = parseCurrencyValue(moneyMatch[1]);
    if (amount === null) continue;
    const label = normalizeWhitespace(trimmed.slice(0, trimmed.length - moneyMatch[1].length));
    if (!label || label.length < 2) continue;
    items.push({ label, amount });
  }
  return items.slice(0, 20);
}

export function extractDeterministicReceipt(rawText: string): DeterministicReceiptParseResult {
  const text = rawText.replace(/\r/g, "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  let subtotal: number | null = null;
  let tax: number | null = null;
  let tip: number | null = null;
  let total: number | null = null;

  const subtotalMatch = lower.match(/subtotal[^0-9-]*(-?\$?\d+(?:\.\d{2})?)/i);
  const taxMatch = lower.match(/\btax\b[^0-9-]*(-?\$?\d+(?:\.\d{2})?)/i);
  const tipMatch = lower.match(/\btip\b[^0-9-]*(-?\$?\d+(?:\.\d{2})?)/i);
  const totalMatch = lower.match(/\b(total|amount due|balance due)\b[^0-9-]*(-?\$?\d+(?:\.\d{2})?)/i);

  subtotal = subtotalMatch ? parseCurrencyValue(subtotalMatch[1]) : null;
  tax = taxMatch ? parseCurrencyValue(taxMatch[1]) : null;
  tip = tipMatch ? parseCurrencyValue(tipMatch[1]) : null;
  total = totalMatch ? parseCurrencyValue(totalMatch[2]) : null;

  if (total === null) {
    const candidates = [...text.matchAll(/\$?\d+\.\d{2}/g)]
      .map((match) => parseCurrencyValue(match[0]))
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a);
    total = candidates[0] ?? null;
  }

  const merchant = pickMerchantLine(lines);
  const date = parseDateFromText(text);
  const lineItems = parseLineItems(lines);

  const missingFields: string[] = [];
  if (!merchant) missingFields.push("merchant");
  if (total === null) missingFields.push("total");
  if (!date) missingFields.push("date");

  const confidence = Math.max(
    0.2,
    Math.min(
      0.97,
      0.35
        + (merchant ? 0.22 : 0)
        + (date ? 0.16 : 0)
        + (total !== null ? 0.2 : 0)
        + (subtotal !== null ? 0.04 : 0)
        + (tax !== null ? 0.03 : 0)
        + Math.min(lineItems.length / 8, 1) * 0.1,
    ),
  );

  return {
    merchant,
    date,
    currency: "USD",
    subtotal,
    tax,
    tip,
    total,
    lineItems,
    confidence: round(confidence),
    fallbackUsed: false,
    extractionMethod: "deterministic",
    missingFields,
    explainability: {
      summary: "Deterministic parser extracted merchant, totals, and date from receipt text patterns.",
      factors: [
        merchant ? "Merchant line detected." : "Merchant line not detected.",
        total !== null ? "Total amount detected." : "Total amount not detected.",
        date ? "Date detected." : "Date not detected.",
      ],
    },
  };
}
