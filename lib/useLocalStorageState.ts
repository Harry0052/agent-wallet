"use client";

import { Dispatch, SetStateAction, useEffect, useState } from "react";

export function useLocalStorageState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // Ignore malformed local storage payloads.
    } finally {
      setHydrated(true);
    }
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      // Notify other components on the same page that localStorage changed.
      // (The native StorageEvent only fires in *other* tabs.)
      window.dispatchEvent(new CustomEvent("calico:storage-change", { detail: { key } }));
    } catch {
      // Ignore local storage write failures.
    }
  }, [hydrated, key, value]);

  // Listen for changes from other components on the same page
  useEffect(() => {
    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string }>).detail;
      if (detail?.key !== key) return;
      try {
        const raw = window.localStorage.getItem(key);
        if (raw != null) {
          setValue(JSON.parse(raw) as T);
        }
      } catch {
        // Ignore malformed payloads
      }
    };

    // Also listen for cross-tab storage events
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      try {
        if (event.newValue != null) {
          setValue(JSON.parse(event.newValue) as T);
        }
      } catch {
        // Ignore malformed payloads
      }
    };

    window.addEventListener("calico:storage-change", onLocalChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("calico:storage-change", onLocalChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);

  return [value, setValue];
}
