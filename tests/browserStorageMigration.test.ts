import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyBrowserStorage } from "../lib/browserStorage.ts";
import { previousProductPrefix } from "../lib/previousName.ts";

function installMemoryStorage(): Map<string, string> {
  const entries = new Map<string, string>();
  const localStorage = {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.has(key) ? entries.get(key)! : null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  return entries;
}

test("legacy browser storage keys move to the agent-wallet prefix", () => {
  const entries = installMemoryStorage();
  try {
    const legacyKey = `${previousProductPrefix()}.display-name`;
    entries.set(legacyKey, "Ada");

    migrateLegacyBrowserStorage();

    assert.equal(entries.get("agent-wallet.display-name"), "Ada");
    assert.equal(entries.has(legacyKey), false);
    assert.equal(entries.get("agent-wallet.storage-migrated"), "1");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("storage migration is a no-op when window is missing", () => {
  delete (globalThis as { window?: unknown }).window;
  assert.doesNotThrow(() => migrateLegacyBrowserStorage());
});
