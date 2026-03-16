import "server-only";

import { callGeminiGenerateContent } from "@/lib/server/gemini";
import { getSecretFromAny } from "@/security/secretsManager";
import type { DeterministicReceiptLineItem, DeterministicReceiptParseResult } from "@/lib/server/financialOs/types";
import { extractDeterministicReceipt } from "@/lib/server/financialOs/receiptCore";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

interface FallbackReceiptShape {
  merchant?: string | null;
  date?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  tip?: number | null;
  total?: number | null;
  lineItems?: Array<{ label?: string; amount?: number }>;
}

function normalizeFallbackResult(
  deterministic: DeterministicReceiptParseResult,
  fallback: FallbackReceiptShape,
): DeterministicReceiptParseResult {
  const lineItems: DeterministicReceiptLineItem[] = Array.isArray(fallback.lineItems)
    ? fallback.lineItems
      .map((item) => ({
        label: normalizeWhitespace(String(item.label || "")),
        amount: round(Number(item.amount)),
      }))
      .filter((item) => item.label.length > 0 && Number.isFinite(item.amount))
      .slice(0, 20)
    : deterministic.lineItems;

  const merged: DeterministicReceiptParseResult = {
    merchant: fallback.merchant ? normalizeWhitespace(String(fallback.merchant)) : deterministic.merchant,
    date: fallback.date && Number.isFinite(Date.parse(fallback.date))
      ? new Date(Date.parse(fallback.date)).toISOString()
      : deterministic.date,
    currency: fallback.currency?.trim().toUpperCase().slice(0, 3) || deterministic.currency,
    subtotal: typeof fallback.subtotal === "number" && Number.isFinite(fallback.subtotal)
      ? round(fallback.subtotal)
      : deterministic.subtotal,
    tax: typeof fallback.tax === "number" && Number.isFinite(fallback.tax)
      ? round(fallback.tax)
      : deterministic.tax,
    tip: typeof fallback.tip === "number" && Number.isFinite(fallback.tip)
      ? round(fallback.tip)
      : deterministic.tip,
    total: typeof fallback.total === "number" && Number.isFinite(fallback.total)
      ? round(fallback.total)
      : deterministic.total,
    lineItems,
    confidence: round(Math.max(deterministic.confidence, 0.74)),
    fallbackUsed: true,
    extractionMethod: "llm_fallback",
    missingFields: [],
    explainability: {
      summary: "Deterministic parsing ran first, then LLM fallback completed missing receipt fields.",
      factors: [
        `Deterministic missing fields: ${deterministic.missingFields.join(", ") || "none"}.`,
        "LLM fallback used only because deterministic confidence/coverage was insufficient.",
      ],
    },
  };

  const missing: string[] = [];
  if (!merged.merchant) missing.push("merchant");
  if (!merged.date) missing.push("date");
  if (merged.total === null) missing.push("total");
  merged.missingFields = missing;
  return merged;
}

async function runLlmFallback(input: {
  rawText: string;
  deterministic: DeterministicReceiptParseResult;
}): Promise<DeterministicReceiptParseResult | null> {
  const apiKey = getSecretFromAny(
    ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    { required: false },
  );
  if (!apiKey) return null;

  const prompt = [
    "Extract structured receipt fields as strict JSON.",
    "Return only JSON with keys: merchant,date,currency,subtotal,tax,tip,total,lineItems.",
    "lineItems is an array of {label,amount}.",
    "Use null when unknown.",
    "Receipt text:",
    input.rawText.slice(0, 8000),
  ].join("\n");

  const response = await callGeminiGenerateContent({
    apiKey,
    operation: "financial_os_receipt_parse",
    temperature: 0.1,
    maxOutputTokens: 500,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  });

  let parsed: FallbackReceiptShape | null = null;
  try {
    parsed = JSON.parse(response.raw) as FallbackReceiptShape;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return normalizeFallbackResult(input.deterministic, parsed);
}

export async function parseReceiptText(input: {
  rawText: string;
  enableFallback?: boolean;
}): Promise<DeterministicReceiptParseResult> {
  const raw = input.rawText.trim();
  if (!raw) {
    return {
      merchant: null,
      date: null,
      currency: "USD",
      subtotal: null,
      tax: null,
      tip: null,
      total: null,
      lineItems: [],
      confidence: 0.15,
      fallbackUsed: false,
      extractionMethod: "deterministic",
      missingFields: ["merchant", "date", "total"],
      explainability: {
        summary: "No receipt text was provided for parsing.",
        factors: ["Input text is empty."],
      },
    };
  }

  const deterministic = extractDeterministicReceipt(raw);
  const shouldFallback = (input.enableFallback ?? true)
    && (deterministic.missingFields.length >= 2 || deterministic.confidence < 0.62);
  if (!shouldFallback) return deterministic;

  const fallback = await runLlmFallback({
    rawText: raw,
    deterministic,
  });
  return fallback || deterministic;
}
