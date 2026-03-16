import test from "node:test";
import assert from "node:assert/strict";
import { extractDeterministicReceipt } from "../lib/server/financialOs/receiptCore.ts";

test("deterministic receipt parser extracts merchant, date, totals, and line items", () => {
  const result = extractDeterministicReceipt(
    [
      "Campus Corner Cafe",
      "Date: 2026-03-12",
      "Latte 5.50",
      "Bagel 4.25",
      "Subtotal 9.75",
      "Tax 0.78",
      "Total 10.53",
    ].join("\n"),
  );

  assert.equal(result.merchant, "Campus Corner Cafe");
  assert.ok(result.date && result.date.startsWith("2026-03-12"));
  assert.equal(result.subtotal, 9.75);
  assert.equal(result.tax, 0.78);
  assert.equal(result.total, 10.53);
  assert.equal(result.extractionMethod, "deterministic");
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.missingFields.length, 0);
  assert.ok(result.lineItems.length >= 2);
});

test("deterministic receipt parser marks missing coverage and lowers confidence for sparse text", () => {
  const result = extractDeterministicReceipt("Thanks for your purchase");
  assert.equal(result.merchant, "Thanks for your purchase");
  assert.equal(result.total, null);
  assert.ok(result.missingFields.includes("total"));
  assert.ok(result.missingFields.includes("date"));
  assert.ok(result.confidence < 0.7);
});
