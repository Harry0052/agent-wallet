"use client";

import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";

export function useLocalStorageState<T>(
  key: string,
  initialValue: T,
  options?: {
    broadcast?: boolean;
  },
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);
  const initialValueRef = useRef(initialValue);
  const lastSerializedRef = useRef<string | null>(null);
  const skipNextPersistRef = useRef(false);

  useEffect(() => {
    initialValueRef.current = initialValue;
  }, [initialValue, key]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        lastSerializedRef.current = raw;
        setValue(JSON.parse(raw) as T);
      } else {
        lastSerializedRef.current = JSON.stringify(initialValueRef.current);
      }
    } catch {
      // Ignore malformed local storage payloads.
      lastSerializedRef.current = JSON.stringify(initialValueRef.current);
    } finally {
      setHydrated(true);
    }
  }, [key]);

  const persist = useCallback((nextValue: T) => {
    const serialized = JSON.stringify(nextValue);
    if (serialized === lastSerializedRef.current) {
      return;
    }

    if (skipNextPersistRef.current) {
      lastSerializedRef.current = serialized;
      skipNextPersistRef.current = false;
      return;
    }

    try {
      window.localStorage.setItem(key, serialized);
      lastSerializedRef.current = serialized;
      if (options?.broadcast !== false) {
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("calico:storage-change", {
              detail: { key, value: serialized },
            }),
          );
        }, 0);
      }
    } catch {
      // Ignore local storage write failures.
    }
  }, [key, options?.broadcast]);

  const setStoredValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setValue((current) => {
      const nextValue =
        typeof update === "function"
          ? (update as (prevState: T) => T)(current)
          : update;

      return nextValue;
    });
  }, []);

  // Persist to localStorage in a useEffect so writes happen after render,
  // avoiding cascading re-renders when calico:storage-change listeners fire.
  useEffect(() => {
    if (hydrated) {
      persist(value);
    }
  }, [hydrated, persist, value]);

  // Listen for changes from other components on the same page
  useEffect(() => {
    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value?: string }>).detail;
      if (detail?.key !== key) return;

      const raw = detail?.value ?? window.localStorage.getItem(key);
      if (raw == null || raw === lastSerializedRef.current) return;

      try {
        skipNextPersistRef.current = true;
        lastSerializedRef.current = raw;
        setValue(JSON.parse(raw) as T);
      } catch {
        // Ignore malformed payloads
      }
    };

    // Also listen for cross-tab storage events
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      if (event.newValue == null || event.newValue === lastSerializedRef.current) return;
      try {
        skipNextPersistRef.current = true;
        lastSerializedRef.current = event.newValue;
        setValue(JSON.parse(event.newValue) as T);
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

  return [value, setStoredValue];
}
