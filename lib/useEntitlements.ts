"use client";

import { useCallback, useEffect, useState } from "react";
import type { EntitlementsResponse } from "@/services/entitlements";
import { fetchEntitlements, hasFeature } from "@/services/entitlements";

export interface UseEntitlementsResult {
  loading: boolean;
  plan: string | null;
  isActive: boolean;
  available: string[];
  locked: Array<{ key: string; label: string; description: string; minimumPlan: string }>;
  /** Check if a specific feature key is available */
  can: (feature: string) => boolean;
  /** Refresh entitlements from server */
  refresh: () => Promise<void>;
}

/**
 * Client-side hook for checking entitlements.
 * Fetches from /api/entitlements on mount and caches the result.
 * Call `refresh()` after plan changes (e.g. post-upgrade).
 */
export function useEntitlements(): UseEntitlementsResult {
  const [data, setData] = useState<EntitlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetchEntitlements();
      setData(result);
    } catch {
      // Fail closed: treat as no entitlements
      setData({
        plan: null,
        isActive: false,
        available: [],
        locked: [],
        tutorial: null,
      });
    } finally {
      setLoading(false);
    }
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
    plan: data?.plan ?? null,
    isActive: data?.isActive ?? false,
    available: data?.available ?? [],
    locked: data?.locked ?? [],
    can,
    refresh: load,
  };
}
