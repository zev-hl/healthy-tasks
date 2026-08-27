/**
 * A tiny per-user memo for the unread-count response (Phase 14 / S5).
 *
 * `/api/notifications/unread-count` is the heaviest thing on the polling path -
 * a preferences lookup, two counts, and `listDueReminders` with full task-access
 * scoping - and every open tab asks for it. One user with four tabs pays for it
 * four times over, all identical.
 *
 * This lives in its own module rather than inside notification.service so that
 * reminder.service can invalidate it too, without the two services importing each
 * other. Invalidation is the whole risk here: a stale count after the user marks
 * something read is a visible bug, so every mutation that can change a user's own
 * count must call `invalidateUnread`.
 *
 * Process-local by design. With more than one API instance each keeps its own,
 * which is fine: the TTL bounds staleness either way.
 */

/** Short enough that any missed invalidation self-heals almost immediately. */
export const UNREAD_CACHE_TTL_MS = 10_000;
/** Bound the map so a long-lived process cannot accumulate departed users. */
const MAX_ENTRIES = 5_000;

interface Entry {
  at: number;
  value: unknown;
}

const cache = new Map<string, Entry>();

function sweep(now: number): void {
  for (const [userId, entry] of cache) {
    if (now - entry.at >= UNREAD_CACHE_TTL_MS) cache.delete(userId);
  }
}

/** The cached value for this user, or null when absent or expired. */
export function getCachedUnread<T>(userId: string, now = Date.now()): T | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (now - entry.at >= UNREAD_CACHE_TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return entry.value as T;
}

export function setCachedUnread<T>(userId: string, value: T, now = Date.now()): void {
  if (cache.size >= MAX_ENTRIES) sweep(now);
  cache.set(userId, { at: now, value });
}

/** Drop this user's memo. Call from anything that changes their own count. */
export function invalidateUnread(userId: string): void {
  cache.delete(userId);
}

/** Test seam: empty the cache so each test starts cold. */
export function __resetUnreadCache(): void {
  cache.clear();
}
