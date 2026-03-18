"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EntitlementsResponse } from "@/services/entitlements";
import { fetchEntitlements, hasFeature } from "@/services/entitlements";

export interface UseEntitlementsResult {
  loading: boolean;
  error: boolean;
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
const RETRY_DELAY_MS = 1500;

/**
 * Client-side hook for checking entitlements.
 * Fetches from /api/entitlements on mount with automatic retry.
 * Call `refresh()` after plan changes (e.g. post-upgrade).
 */
export function useEntitlements(): UseEntitlementsResult {
  const [data, setData] = useState<EntitlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const retryCount = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fetchEntitlements();
        setData(result);
        retryCount.current = 0;
        setLoading(false);
        return;
      } catch {
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    // All retries exhausted — fail closed but mark error for UI feedback
    setData({
      plan: null,
      isActive: false,
      available: [],
      locked: [],
      tutorial: null,
    });
    setError(true);
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
    plan: data?.plan ?? null,
    isActive: data?.isActive ?? false,
    available: data?.available ?? [],
    locked: data?.locked ?? [],
    can,
    refresh: load,
  };
}
