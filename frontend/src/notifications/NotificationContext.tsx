import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { UnreadCountDto } from '@healthy-tasks/shared';
import { api } from '../api/client';
import {
  createBroadcastChannel,
  createWebLocksElection,
  pollDelayMs,
  type LeaderElection,
  type PollChannel,
  type PollMessage,
} from './pollCoordinator';

/**
 * Polling for new notifications (spec: not websockets; SSE is Phase 15).
 *
 * Phase 14 / PR 2 made the polling cost-aware. Exactly ONE tab per browser polls,
 * and only while it is visible:
 *
 *  - C1 leadership is held only while `visibilityState === 'visible'`, so a
 *    backgrounded tab resigns and an all-hidden browser polls not at all
 *  - C2 the leader's interval walks 30s -> 2m -> 10m as idle time grows, reset by
 *    interaction in ANY tab (activity is broadcast, throttled)
 *  - C3 leadership is a Web Lock, so N tabs cost one poll, and the browser hands
 *    leadership over automatically when a tab dies, crash included
 *
 * Note this reduces query VOLUME and server load. It only reduces database AWAKE
 * time - what Neon actually bills - when every tab is hidden or idle, because
 * autosuspend is binary: one poll every 30s keeps the compute up exactly as much
 * as five do.
 */

const LOCK_NAME = 'hl-notif-leader';
const CHANNEL_NAME = 'hl-notif';
/** Interaction events are noisy; only tell the other tabs this often. */
const ACTIVITY_BROADCAST_THROTTLE_MS = 30_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll'] as const;

interface NotificationContextValue {
  unread: UnreadCountDto | null;
  /** Re-fetch the unread counts now (e.g. after marking something read). */
  refresh: () => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  unread: null,
  refresh: () => {},
});

export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext);
}

interface Props {
  children: ReactNode;
  /** Injectable for tests; jsdom implements neither of these for real. */
  election?: LeaderElection;
  channel?: PollChannel;
}

/** Polls unread counts; mounted inside the authenticated layout. */
export function NotificationProvider({ children, election, channel }: Props) {
  const [unread, setUnread] = useState<UnreadCountDto | null>(null);
  const [isLeader, setIsLeader] = useState(false);

  // Stable for the provider's lifetime. Injected fakes win; otherwise the real
  // Web Locks / BroadcastChannel implementations, which themselves degrade to
  // "every tab leads, no fan-out" where the browser lacks them.
  const channelRef = useRef<PollChannel | null>(null);
  if (channelRef.current === null) {
    channelRef.current = channel ?? createBroadcastChannel(CHANNEL_NAME);
  }
  const ch = channelRef.current;

  const electionRef = useRef<LeaderElection | null>(null);
  if (electionRef.current === null) {
    electionRef.current = election ?? createWebLocksElection(LOCK_NAME);
  }
  const el = electionRef.current;

  const lastActivityRef = useRef<number>(Date.now());
  const lastActivityPostRef = useRef<number>(0);

  const fetchAndShare = useCallback(async (): Promise<void> => {
    try {
      const counts = await api.getUnreadCount();
      setUnread(counts);
      ch.post({ type: 'counts', counts });
    } catch {
      /* transient poll failures are non-fatal; the next tick retries */
    }
  }, [ch]);

  const refresh = useCallback((): void => {
    // User-initiated, so it counts as activity, and it always fetches locally
    // rather than waiting on the leader - the caller needs the fresh value now.
    lastActivityRef.current = Date.now();
    void fetchAndShare();
  }, [fetchAndShare]);

  // Receive the leader's results, and let any tab's interaction reset the ladder.
  useEffect(() => {
    const unsubscribe = ch.subscribe((msg: PollMessage) => {
      if (msg.type === 'counts') setUnread(msg.counts);
      else if (msg.type === 'activity') lastActivityRef.current = Date.now();
    });
    return () => {
      unsubscribe();
      ch.close();
    };
  }, [ch]);

  // Stand for election only while visible; resign the moment we are hidden.
  useEffect(() => {
    let withdraw: (() => void) | null = null;

    const stand = (): void => {
      if (withdraw) return;
      withdraw = el.campaign(() => setIsLeader(true));
    };
    const standDown = (): void => {
      withdraw?.();
      withdraw = null;
      setIsLeader(false);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') standDown();
      else stand();
    };

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      standDown();
    };
  }, [el]);

  // One fetch per visible mount, so opening a second tab shows its bell straight
  // away instead of waiting up to a full interval for the leader's broadcast.
  useEffect(() => {
    if (document.visibilityState !== 'hidden') void fetchAndShare();
  }, [fetchAndShare]);

  // Track interaction for the idle ladder, and tell the other tabs about it.
  useEffect(() => {
    const onActivity = (): void => {
      const now = Date.now();
      lastActivityRef.current = now;
      if (now - lastActivityPostRef.current >= ACTIVITY_BROADCAST_THROTTLE_MS) {
        lastActivityPostRef.current = now;
        ch.post({ type: 'activity' });
      }
    };
    for (const e of ACTIVITY_EVENTS) {
      window.addEventListener(e, onActivity, { passive: true });
    }
    window.addEventListener('focus', onActivity);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
      window.removeEventListener('focus', onActivity);
    };
  }, [ch]);

  // The poll loop. Runs ONLY while this tab holds leadership, and re-arms itself
  // at whatever the idle ladder currently says.
  useEffect(() => {
    if (!isLeader) return;
    let cancelled = false;
    let handle: number | undefined;

    const schedule = (): void => {
      if (cancelled) return;
      handle = window.setTimeout(() => {
        void tick();
      }, pollDelayMs(Date.now() - lastActivityRef.current));
    };
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      await fetchAndShare();
      schedule();
    };

    // Taking leadership means either a fresh mount or a tab that just became
    // visible; both want current numbers immediately.
    void tick();
    return () => {
      cancelled = true;
      if (handle !== undefined) window.clearTimeout(handle);
    };
  }, [isLeader, fetchAndShare]);

  return (
    <NotificationContext.Provider value={{ unread, refresh }}>
      {children}
    </NotificationContext.Provider>
  );
}
