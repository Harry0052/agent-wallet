import { previousProductPrefix } from "./previousName.ts";

const MIGRATED_FLAG = "agent-wallet.storage-migrated";
const NEXT_PREFIX = "agent-wallet";

export function migrateLegacyBrowserStorage(): void {
  if (typeof window === "undefined") return;

  try {
    const storage = window.localStorage;
    if (!storage || storage.getItem(MIGRATED_FLAG) === "1") return;

    const legacyPrefix = previousProductPrefix();
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }

    for (const key of keys) {
      if (!key.startsWith(legacyPrefix)) continue;
      const nextKey = `${NEXT_PREFIX}${key.slice(legacyPrefix.length)}`;
      if (storage.getItem(nextKey) == null) {
        const value = storage.getItem(key);
        if (value != null) storage.setItem(nextKey, value);
      }
      storage.removeItem(key);
    }

    storage.setItem(MIGRATED_FLAG, "1");
  } catch {
    // Ignore storage failures so a locked browser does not break render.
  }
}
