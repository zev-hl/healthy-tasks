import type { ExclusivesMarketplace } from '@healthy-tasks/shared';

// A short memory of what Amazon last said about an ASIN, so retyping a code or
// re-opening an import does not spend the seller account's rate limit again.
// Negative answers ("not listed") are remembered too — a typo would otherwise
// call Amazon on every keystroke-triggered retry.
//
// Deliberately process-local and small: it is a rate-limit saver, not a source
// of truth. Anything that must be correct is read from the database instead.

export const LOOKUP_TTL_MS = 10 * 60 * 1000;
export const LOOKUP_CACHE_MAX = 5_000;

/** What Amazon said: the listing it found, or null for "not listed". */
export type CachedListing = { sku: string; title: string | null } | null;

interface Entry {
  value: CachedListing;
  at: number;
}

const cache = new Map<string, Entry>();

export const lookupKey = (marketplace: ExclusivesMarketplace, asin: string): string =>
  `${marketplace}:${asin}`;

/** The remembered answer, or undefined when there is none worth using. */
export function readLookupCache(key: string, now: number = Date.now()): CachedListing | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (now - entry.at >= LOOKUP_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Touch it so the oldest entry is always the least recently used.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

export function writeLookupCache(
  key: string,
  value: CachedListing,
  now: number = Date.now(),
): void {
  cache.delete(key);
  cache.set(key, { value, at: now });
  while (cache.size > LOOKUP_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Test seam: the cache outlives a database reset, so tests must clear it. */
export function __resetLookupCache(): void {
  cache.clear();
}

export const __lookupCacheSize = (): number => cache.size;
