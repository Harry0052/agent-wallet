'use client';

import { migrateLegacyBrowserStorage } from '@/lib/browserStorage';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CacheConfig {
  /** How long data is considered fresh (won't refetch) */
  freshMs: number;
  /** How long data is usable while stale (show immediately, refresh bg) */
  staleMs: number;
  /** Whether to persist to localStorage */
  persist: boolean;
}

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  userId: string;
}

export type CacheResult<T> =
  | { status: 'fresh'; data: T }
  | { status: 'stale'; data: T }
  | { status: 'miss' };

// ── Default freshness policies ─────────────────────────────────────────────

export const FRESHNESS: Record<string, CacheConfig> = {
  dashboard:      { freshMs: 30_000,  staleMs: 300_000,  persist: true },
  transactions:   { freshMs: 60_000,  staleMs: 600_000,  persist: true },
  accounts:       { freshMs: 30_000,  staleMs: 300_000,  persist: true },
  balances:       { freshMs: 15_000,  staleMs: 120_000,  persist: true },
  budgets:        { freshMs: 120_000, staleMs: 3600_000, persist: true },
  subscriptions:  { freshMs: 60_000,  staleMs: 600_000,  persist: true },
  statements:     { freshMs: 60_000,  staleMs: 600_000,  persist: true },
  insights:       { freshMs: 120_000, staleMs: 3600_000, persist: true },
  entitlements:   { freshMs: 600_000, staleMs: 3600_000, persist: true },
  wallet:         { freshMs: 15_000,  staleMs: 120_000,  persist: true },
  settings:       { freshMs: 300_000, staleMs: 3600_000, persist: true },
};

// ── In-memory store ────────────────────────────────────────────────────────

const memoryCache = new Map<string, CacheEntry<unknown>>();
const inflightRequests = new Map<string, Promise<unknown>>();

// ── User scope management ──────────────────────────────────────────────────

let currentUserId: string | null = null;

export function setCacheUserId(userId: string): void {
  if (currentUserId && currentUserId !== userId) {
    // User changed — clear all caches for safety
    clearAllCaches();
  }
  currentUserId = userId;
}

export function getCacheUserId(): string | null {
  return currentUserId;
}

// ── Core cache operations ──────────────────────────────────────────────────

function cacheKey(domain: string, key: string): string {
  return `agent-wallet:cache:${currentUserId || 'anon'}:${domain}:${key}`;
}

function readMemory<T>(fullKey: string, config: CacheConfig): CacheResult<T> {
  const entry = memoryCache.get(fullKey) as CacheEntry<T> | undefined;
  if (!entry || entry.userId !== currentUserId) return { status: 'miss' };

  const age = Date.now() - entry.cachedAt;
  if (age < config.freshMs) return { status: 'fresh', data: entry.data };
  if (age < config.staleMs) return { status: 'stale', data: entry.data };
  return { status: 'miss' };
}

function readPersistent<T>(fullKey: string, config: CacheConfig): CacheResult<T> {
  migrateLegacyBrowserStorage();
  if (!config.persist || typeof window === 'undefined') return { status: 'miss' };
  try {
    const raw = localStorage.getItem(fullKey);
    if (!raw) return { status: 'miss' };
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.userId !== currentUserId) {
      localStorage.removeItem(fullKey);
      return { status: 'miss' };
    }
    const age = Date.now() - entry.cachedAt;
    if (age < config.freshMs) return { status: 'fresh', data: entry.data };
    if (age < config.staleMs) return { status: 'stale', data: entry.data };
    // Expired — remove
    localStorage.removeItem(fullKey);
    return { status: 'miss' };
  } catch {
    return { status: 'miss' };
  }
}

function writeCache<T>(fullKey: string, data: T, config: CacheConfig): void {
  if (!currentUserId) return;
  const entry: CacheEntry<T> = { data, cachedAt: Date.now(), userId: currentUserId };
  memoryCache.set(fullKey, entry as CacheEntry<unknown>);

  if (config.persist && typeof window !== 'undefined') {
    try {
      localStorage.setItem(fullKey, JSON.stringify(entry));
    } catch {
      // localStorage full — evict oldest entries
      evictOldestPersistent();
      try {
        localStorage.setItem(fullKey, JSON.stringify(entry));
      } catch {
        /* give up */
      }
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Read from cache (memory first, then persistent).
 * Returns the data and whether it's fresh or stale.
 */
export function readFromCache<T>(domain: string, key: string, config: CacheConfig): CacheResult<T> {
  const fullKey = cacheKey(domain, key);
  const mem = readMemory<T>(fullKey, config);
  if (mem.status !== 'miss') return mem;

  const persistent = readPersistent<T>(fullKey, config);
  if (persistent.status !== 'miss') {
    // Promote to memory cache — keep the original cachedAt from persistent so
    // the age calculation remains accurate for subsequent readMemory calls.
    const raw = localStorage.getItem(fullKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as CacheEntry<T>;
        memoryCache.set(fullKey, parsed as CacheEntry<unknown>);
      } catch {
        /* ignore */
      }
    }
    return persistent;
  }

  return { status: 'miss' };
}

/**
 * Write data to cache.
 */
export function writeToCache<T>(domain: string, key: string, data: T, config: CacheConfig): void {
  writeCache(cacheKey(domain, key), data, config);
}

/**
 * Invalidate a specific cache domain+key.
 */
export function invalidateCache(domain: string, key: string): void {
  migrateLegacyBrowserStorage();
  const fullKey = cacheKey(domain, key);
  memoryCache.delete(fullKey);
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(fullKey);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Invalidate all entries for a domain.
 */
export function invalidateDomain(domain: string): void {
  migrateLegacyBrowserStorage();
  const prefix = `agent-wallet:cache:${currentUserId || 'anon'}:${domain}:`;
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
  if (typeof window !== 'undefined') {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  }
}

/**
 * Fetch with stale-while-revalidate + request deduplication.
 * - If fresh cache exists: return immediately, no fetch
 * - If stale cache exists: return immediately, fetch in background
 * - If no cache: fetch and return
 * - Deduplicates concurrent requests for the same key
 */
export async function fetchWithCache<T>(
  domain: string,
  key: string,
  fetcher: () => Promise<T>,
  config: CacheConfig,
): Promise<T> {
  const fullKey = cacheKey(domain, key);
  const cached = readFromCache<T>(domain, key, config);

  if (cached.status === 'fresh') {
    return cached.data;
  }

  if (cached.status === 'stale') {
    // Return stale data immediately, refresh in background
    deduplicatedFetch(fullKey, fetcher, config).catch(() => {
      /* background refresh failure is non-critical */
    });
    return cached.data;
  }

  // Cache miss — must fetch
  return deduplicatedFetch(fullKey, fetcher, config);
}

async function deduplicatedFetch<T>(
  fullKey: string,
  fetcher: () => Promise<T>,
  config: CacheConfig,
): Promise<T> {
  // Deduplicate: if same request is already in-flight, reuse it
  const existing = inflightRequests.get(fullKey);
  if (existing) return existing as Promise<T>;

  const promise = fetcher()
    .then((data) => {
      writeCache(fullKey, data, config);
      return data;
    })
    .finally(() => {
      inflightRequests.delete(fullKey);
    });

  inflightRequests.set(fullKey, promise);
  return promise;
}

// ── Cache clearing ─────────────────────────────────────────────────────────

/**
 * Clear ALL caches for current user. Call on logout.
 */
export function clearAllCaches(): void {
  // Clear memory
  memoryCache.clear();
  inflightRequests.clear();

  // Clear persistent (only user-scoped keys)
  if (typeof window !== 'undefined') {
    migrateLegacyBrowserStorage();
    const prefix = 'agent-wallet:cache:';
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  }

  currentUserId = null;
}

// ── Eviction ───────────────────────────────────────────────────────────────

function evictOldestPersistent(): void {
  if (typeof window === 'undefined') return;
  migrateLegacyBrowserStorage();
  const prefix = 'agent-wallet:cache:';
  let oldest: { key: string; time: number } | null = null;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const entry = JSON.parse(localStorage.getItem(key)!) as CacheEntry<unknown>;
      if (!oldest || entry.cachedAt < oldest.time) {
        oldest = { key, time: entry.cachedAt };
      }
    } catch {
      continue;
    }
  }

  if (oldest) localStorage.removeItem(oldest.key);
}

// ── Revalidation on app focus ──────────────────────────────────────────────

const focusListeners = new Set<() => void>();

export function onCacheRevalidate(listener: () => void): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      for (const listener of focusListeners) {
        try {
          listener();
        } catch {
          /* ignore */
        }
      }
    }
  });
}
