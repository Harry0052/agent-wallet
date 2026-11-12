"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EntitlementsResponse } from "@/services/entitlements";
import { fetchEntitlements, hasFeature } from "@/services/entitlements";

export interface UseEntitlementsResult {
  loading: boolean;
  /** Error string if verification failed (null = no error) */
  error: string | null;
  /** Whether data is from cache vs fresh fetch */
  stale: boolean;
  plan: string | null;
  isActive: boolean;
  available: string[];
  locked: Array<{ key: string; label: string; description: string; minimumPlan: string }>;
  /** Check if a specific feature key is available */
  can: (feature: string) => boolean;
  /** Refresh entitlements from server */
  refresh: () => Promise<void>;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1200;
const CACHE_KEY = "agent-wallet.entitlements.v1";
const CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/** Read last-known-good entitlements from localStorage */
function readCache(): { data: EntitlementsResponse; cachedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.cachedAt === "number" &&
      parsed.data &&
      Array.isArray(parsed.data.available)
    ) {
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

/** Write entitlements to localStorage for fallback */
function writeCache(data: EntitlementsResponse): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch { /* ignore */ }
}

const EMPTY_RESPONSE: EntitlementsResponse = {
  plan: null,
  isActive: false,
  available: [],
  locked: [],
  tutorial: null,
};

/**
 * Client-side hook for checking entitlements.
 *
 * Flow:
 * 1. On mount, immediately check localStorage cache for last-known-good data
 * 2. Fetch fresh data from /api/entitlements with automatic retry
 * 3. On success: update state + cache
 * 4. On failure: keep existing data (from cache or previous fetch), set error
 * 5. Never wipe known-good data on a temporary failure
 */
export function useEntitlements(): UseEntitlementsResult {
  const [data, setData] = useState<EntitlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const hasLoadedRef = useRef(false);

  // On mount: seed from cache if available
  useEffect(() => {
    if (hasLoadedRef.current) return;
    const cached = readCache();
    if (cached && Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS) {
      setData(cached.data);
      setStale(true);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    let lastError = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fetchEntitlements();
        setData(result);
        setStale(false);
        setLoading(false);
        hasLoadedRef.current = true;
        writeCache(result);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Verification failed";
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    // All retries exhausted.
    // CRITICAL: Do NOT wipe existing data. If we have cached/previous data, keep it.
    hasLoadedRef.current = true;

    setData((prev) => {
      if (prev && prev.available.length > 0) {
        // We already have data from cache or previous fetch — keep it, mark stale
        setStale(true);
        return prev;
      }

      // No existing data at all — try cache one more time
      const cached = readCache();
      if (cached && cached.data.available.length > 0) {
        setStale(true);
        return cached.data;
      }

      // Truly no data — return empty
      return EMPTY_RESPONSE;
    });

    setError(lastError);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const can = useCallback(
    (feature: string) => {
      if (!data) return false;
      return hasFeature(data.available, feature);
    },
    [data],
  );

  return {
    loading,
    error,
    stale,
    plan: data?.plan ?? null,
    isActive: data?.isActive ?? false,
    available: data?.available ?? [],
    locked: data?.locked ?? [],
    can,
    refresh: load,
  };
}
