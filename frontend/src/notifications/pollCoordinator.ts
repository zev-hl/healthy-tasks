import type { UnreadCountDto } from '@healthy-tasks/shared';

/**
 * Cross-tab poll coordination (Phase 14 / PR 2).
 *
 * Three problems, one mechanism:
 *
 *  - C1 Background tabs should not poll. Browsers only throttle background
 *    `setInterval` to roughly 1/min, not zero.
 *  - C2 A visible but abandoned tab should back off.
 *  - C3 N tabs of the same app in one browser should cost ONE poll, not N.
 *
 * The trick that collapses all three: **leadership is held only while a tab is
 * visible.** A hidden tab resigns, letting a visible one take over; if every tab
 * is hidden, nobody holds the lock and nobody polls. That removes the need for
 * any visibility aggregation, heartbeat, or stale-entry TTL - and Web Locks
 * releases the lock automatically when a tab DIES, crash included, so takeover is
 * correct without a liveness protocol of our own.
 *
 * Both primitives are interfaces so the coordination logic can be tested against
 * fakes: jsdom implements neither Web Locks nor cross-document BroadcastChannel,
 * so a test against the real ones would be testing nothing.
 */

/** Poll interval while the user is actively using the app. */
export const POLL_ACTIVE_MS = 30_000;
/** After IDLE_SHORT_MS without interaction. */
export const POLL_IDLE_SHORT_MS = 2 * 60_000;
/** After IDLE_LONG_MS without interaction. */
export const POLL_IDLE_LONG_MS = 10 * 60_000;

export const IDLE_SHORT_MS = 5 * 60_000;
export const IDLE_LONG_MS = 30 * 60_000;

/**
 * The poll interval for a given idle duration. Pure, so the ladder is testable
 * without timers, a DOM, or a rendered component.
 */
export function pollDelayMs(idleMs: number): number {
  if (idleMs >= IDLE_LONG_MS) return POLL_IDLE_LONG_MS;
  if (idleMs >= IDLE_SHORT_MS) return POLL_IDLE_SHORT_MS;
  return POLL_ACTIVE_MS;
}

export type PollMessage =
  /** The leader's latest counts, fanned out to followers. */
  | { type: 'counts'; counts: UnreadCountDto }
  /** Someone interacted; the leader resets its idle ladder. */
  | { type: 'activity' };

export interface PollChannel {
  post(msg: PollMessage): void;
  /** Returns an unsubscribe function. */
  subscribe(fn: (msg: PollMessage) => void): () => void;
  close(): void;
}

export interface LeaderElection {
  /**
   * Stand for election. `onElected` fires if and when this tab takes leadership.
   * The returned function resigns (or withdraws, if not yet elected).
   */
  campaign(onElected: () => void): () => void;
}

// --- Real implementations --------------------------------------------------

function nullChannel(): PollChannel {
  return { post: () => {}, subscribe: () => () => {}, close: () => {} };
}

/**
 * Fan-out over BroadcastChannel. Same-origin and same browser profile only, so
 * two browsers (or a normal + incognito window) coordinate separately - accepted.
 */
export function createBroadcastChannel(name: string): PollChannel {
  if (typeof BroadcastChannel === 'undefined') return nullChannel();

  // The underlying channel is opened lazily and REOPENED after close, which
  // matters because React StrictMode double-invokes effects in development:
  // mount -> cleanup -> mount. A close() that were terminal would leave the
  // second mount listening to a dead channel, silently killing cross-tab
  // fan-out in dev only. Keeping subscribers in a Set outside the channel makes
  // close/reopen invisible to callers.
  let ch: BroadcastChannel | null = null;
  const handlers = new Set<(m: PollMessage) => void>();

  const ensure = (): BroadcastChannel => {
    if (!ch) {
      ch = new BroadcastChannel(name);
      ch.onmessage = (e: MessageEvent) => {
        for (const h of handlers) h(e.data as PollMessage);
      };
    }
    return ch;
  };

  return {
    post: (msg) => {
      try {
        ensure().postMessage(msg);
      } catch {
        /* a channel problem must never break polling */
      }
    },
    subscribe: (fn) => {
      handlers.add(fn);
      ensure();
      return () => {
        handlers.delete(fn);
      };
    },
    close: () => {
      ch?.close();
      ch = null;
    },
  };
}

/** Degraded election: every tab leads, i.e. exactly the pre-Phase-14 behavior. */
export function createAlwaysLeaderElection(): LeaderElection {
  return {
    campaign: (onElected) => {
      onElected();
      return () => {};
    },
  };
}

/**
 * Leader election over the Web Locks API. The lock is held for as long as the
 * callback's promise is pending, and the BROWSER releases it when the tab goes
 * away - including a crash or a force-quit, which is precisely what a hand-rolled
 * heartbeat gets wrong.
 */
export function createWebLocksElection(name: string): LeaderElection {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return createAlwaysLeaderElection();
  }
  return {
    campaign(onElected) {
      let resign = (): void => {};
      const held = new Promise<void>((resolve) => {
        resign = resolve;
      });
      // Aborting only withdraws a still-QUEUED request; once the lock is granted
      // the signal is ignored, which is why we also resolve `held`.
      const controller = new AbortController();
      void navigator.locks
        .request(name, { mode: 'exclusive', signal: controller.signal }, async () => {
          onElected();
          await held;
        })
        .catch(() => {
          /* AbortError when we withdrew before being elected */
        });
      return () => {
        controller.abort();
        resign();
      };
    },
  };
}
