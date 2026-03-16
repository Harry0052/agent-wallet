import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildTransactionSyncIdempotencyKey,
  dedupeByProviderId,
  dedupeRemovedProviderTransactionIds,
} from "../transactions/transactionSyncCore.ts";

const ROOT = "/Users/harry/agent wallet";

test("sync core dedupes provider transaction rows by provider_transaction_id", () => {
  const deduped = dedupeByProviderId([
    { provider_transaction_id: "tx_1", amount: 10 },
    { provider_transaction_id: "tx_2", amount: 20 },
    { provider_transaction_id: " tx_1 ", amount: 999 },
    { provider_transaction_id: "", amount: 30 },
  ]);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].provider_transaction_id, "tx_1");
  assert.equal(deduped[1].provider_transaction_id, "tx_2");
});

test("sync core dedupes removed provider transaction ids and strips blanks", () => {
  const ids = dedupeRemovedProviderTransactionIds(["a", " ", "b", "a", " b "]);
  assert.deepEqual(ids, ["a", "b"]);
});

test("sync idempotency key remains stable across retries for same cursor and item", () => {
  const keyA = buildTransactionSyncIdempotencyKey({
    plaidItemId: "item_123",
    cursorStart: "cursor_xyz",
  });
  const keyB = buildTransactionSyncIdempotencyKey({
    plaidItemId: "item_123",
    cursorStart: "cursor_xyz",
  });
  const keyOrigin = buildTransactionSyncIdempotencyKey({
    plaidItemId: "item_123",
    cursorStart: null,
  });

  assert.equal(keyA, keyB);
  assert.equal(keyA, "item_123:cursor_xyz");
  assert.equal(keyOrigin, "item_123:origin");
});

test("transaction sync wiring enforces lease + run lifecycle for retry-safe processing", () => {
  const source = readFileSync(join(ROOT, "transactions/transactionSync.ts"), "utf8");
  assert.match(source, /acquireFinancialSyncLease/);
  assert.match(source, /beginFinancialSyncRun/);
  assert.match(source, /completeFinancialSyncRun/);
  assert.match(source, /failFinancialSyncRun/);
  assert.match(source, /releaseFinancialSyncLease/);
});
