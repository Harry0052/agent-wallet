import type { StructuredCandidate } from './schemas.ts';

function normalizePath(pathname: string): string {
  if (!pathname) return '/';
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

const PROFILE_ID_QUERY_KEYS = ['jk', 'vjk', 'id', 'candidateid', 'cid'];

function normalizeQuery(parsed: URL): string {
  const kept = new URLSearchParams();

  for (const key of PROFILE_ID_QUERY_KEYS) {
    const value = parsed.searchParams.get(key);
    if (value) {
      kept.set(key, value.trim());
    }
  }

  const serialized = kept.toString();
  return serialized ? `?${serialized}` : '';
}

export function canonicalizeProfileUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase() === 'http:' ? 'https:' : parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const pathname = normalizePath(parsed.pathname);
    const query = normalizeQuery(parsed);
    return `${protocol}//${hostname}${pathname}${query}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function fallbackCandidateKey(candidate: Pick<StructuredCandidate, 'fullName' | 'currentTitle' | 'location'>): string {
  const parts = [candidate.fullName, candidate.currentTitle, candidate.location]
    .map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .filter(Boolean);
  return parts.join('|');
}

export function dedupeCandidates(candidates: StructuredCandidate[]): {
  unique: StructuredCandidate[];
  removed: number;
} {
  const byUrl = new Map<string, StructuredCandidate>();
  const fallbackSeen = new Set<string>();

  for (const candidate of candidates) {
    const canonicalUrl = canonicalizeProfileUrl(candidate.sourceUrl);
    if (byUrl.has(canonicalUrl)) {
      continue;
    }

    const fallbackKey = fallbackCandidateKey(candidate);
    if (fallbackKey && fallbackSeen.has(fallbackKey)) {
      continue;
    }

    byUrl.set(canonicalUrl, {
      ...candidate,
      sourceUrl: canonicalUrl,
    });

    if (fallbackKey) fallbackSeen.add(fallbackKey);
  }

  const unique = Array.from(byUrl.values());
  return {
    unique,
    removed: Math.max(0, candidates.length - unique.length),
  };
}

export class CandidateMemoryCache {
  private byUrl = new Map<string, StructuredCandidate>();
  private fallbackToUrl = new Map<string, string>();

  upsert(candidate: StructuredCandidate): boolean {
    const key = canonicalizeProfileUrl(candidate.sourceUrl);
    const fallbackKey = fallbackCandidateKey(candidate);
    const existingByUrl = this.byUrl.get(key);
    const existingByFallback = fallbackKey ? this.fallbackToUrl.get(fallbackKey) : null;
    const resolvedExistingKey = existingByUrl
      ? key
      : (existingByFallback || null);
    const existing = resolvedExistingKey ? this.byUrl.get(resolvedExistingKey) : undefined;

    if (!existing) {
      this.byUrl.set(key, { ...candidate, sourceUrl: key });
      if (fallbackKey) this.fallbackToUrl.set(fallbackKey, key);
      return true;
    }

    // Keep the higher-confidence parse when duplicates arrive.
    if (candidate.extractionConfidence > existing.extractionConfidence) {
      const nextKey = resolvedExistingKey || key;
      this.byUrl.set(nextKey, { ...candidate, sourceUrl: nextKey });
      if (fallbackKey) this.fallbackToUrl.set(fallbackKey, nextKey);
      return true;
    }

    return false;
  }

  has(url: string): boolean {
    return this.byUrl.has(canonicalizeProfileUrl(url));
  }

  hasIdentity(candidate: {
    sourceUrl: string;
    fullName?: string | null;
    currentTitle?: string | null;
    location?: string | null;
  }): boolean {
    if (this.has(candidate.sourceUrl)) return true;
    const fallbackKey = fallbackCandidateKey({
      fullName: candidate.fullName || '',
      currentTitle: candidate.currentTitle || '',
      location: candidate.location || '',
    });
    if (!fallbackKey) return false;
    return this.fallbackToUrl.has(fallbackKey);
  }

  values(): StructuredCandidate[] {
    return Array.from(this.byUrl.values());
  }

  size(): number {
    return this.byUrl.size;
  }
}
