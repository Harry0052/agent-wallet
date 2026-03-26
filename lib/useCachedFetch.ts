'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchWithCache,
  readFromCache,
  writeToCache,
  onCacheRevalidate,
  type CacheConfig,
} from './cache';

interface UseCachedFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  refresh: () => Promise<void>;
  mutateOptimistic: (updater: (prev: T) => T) => void;
}

/**
 * React hook for cached data fetching with stale-while-revalidate semantics.
 *
 * 1. On mount: read from cache. If hit (fresh or stale), set data immediately (no loading spinner).
 * 2. If miss or stale: trigger fetch.
 * 3. Keep previous data during refetch (no flash to null).
 * 4. On error: preserve previous data, set error.
 * 5. mutateOptimistic: update local state + cache immediately, sync in background.
 * 6. On visibilitychange (focus): revalidate if stale.
 * 7. Deduplicate via fetchWithCache.
 */
export function useCachedFetch<T>(
  domain: string,
  key: string,
  fetcher: () => Promise<T>,
  config: CacheConfig,
  options?: { enabled?: boolean; keepPreviousData?: boolean },
): UseCachedFetchResult<T> {
  const enabled = options?.enabled !== false;

  // Seed initial state from cache synchronously where possible
  const [data, setData] = useState<T | null>(() => {
    if (!enabled) return null;
    if (typeof window === 'undefined') return null;
    const cached = readFromCache<T>(domain, key, config);
    if (cached.status !== 'miss') return cached.data;
    return null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!enabled) return false;
    if (typeof window === 'undefined') return true;
    const cached = readFromCache<T>(domain, key, config);
    // If we have cached data (fresh or stale), no loading spinner needed
    return cached.status === 'miss';
  });
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<boolean>(() => {
    if (!enabled) return false;
    if (typeof window === 'undefined') return false;
    const cached = readFromCache<T>(domain, key, config);
    return cached.status === 'stale';
  });

  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const doFetch = useCallback(async () => {
    if (!enabled) return;
    setError(null);

    // Check cache first — only show loading if no cached data exists
    const cached = readFromCache<T>(domain, key, config);
    if (cached.status === 'fresh') {
      if (mountedRef.current) {
        setData(cached.data);
        setStale(false);
        setLoading(false);
      }
      return;
    }

    if (cached.status === 'stale') {
      // Show stale data immediately, no loading spinner
      if (mountedRef.current) {
        setData(cached.data);
        setStale(true);
        setLoading(false);
      }
    } else {
      // Cache miss — show loading
      if (mountedRef.current) {
        setLoading(true);
      }
    }

    try {
      const result = await fetchWithCache(domain, key, fetcherRef.current, config);
      if (mountedRef.current) {
        setData(result);
        setStale(false);
        setError(null);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        // Preserve previous data on error — do not flash to null
        setError(err instanceof Error ? err.message : 'Failed to load data.');
        setLoading(false);
      }
    }
  }, [domain, key, config, enabled]);

  // Initial fetch on mount
  useEffect(() => {
    mountedRef.current = true;
    void doFetch();
    return () => {
      mountedRef.current = false;
    };
  }, [doFetch]);

  // Revalidate on tab focus
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = onCacheRevalidate(() => {
      const cached = readFromCache<T>(domain, key, config);
      if (cached.status !== 'fresh') {
        void doFetch();
      }
    });
    return unsubscribe;
  }, [domain, key, config, enabled, doFetch]);

  const refresh = useCallback(async () => {
    // Force a fresh fetch by bypassing cache freshness
    setError(null);
    if (!data) {
      setLoading(true);
    } else {
      setStale(true);
    }

    try {
      const result = await fetchWithCache(domain, key, fetcherRef.current, {
        ...config,
        freshMs: 0, // Force refetch by treating everything as stale
      });
      if (mountedRef.current) {
        setData(result);
        setStale(false);
        setError(null);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load data.');
        setLoading(false);
        setStale(false);
      }
    }
  }, [domain, key, config, data]);

  const mutateOptimistic = useCallback(
    (updater: (prev: T) => T) => {
      setData((prev) => {
        if (prev === null) return prev;
        const next = updater(prev);
        // Write optimistic data to cache immediately
        writeToCache(domain, key, next, config);
        return next;
      });
    },
    [domain, key, config],
  );

  return { data, loading, error, stale, refresh, mutateOptimistic };
}
