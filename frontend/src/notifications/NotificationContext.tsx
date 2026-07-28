import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UnreadCountDto } from '@healthy-tasks/shared';
import { api } from '../api/client';

// 30-second polling for new notifications (spec: not websockets). Websockets are
// a possible future upgrade if polling proves insufficient — not built here.
const POLL_MS = 30_000;

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

/** Polls unread counts on an interval; mounted inside the authenticated layout. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState<UnreadCountDto | null>(null);

  const refresh = useCallback(() => {
    void api
      .getUnreadCount()
      .then(setUnread)
      .catch(() => {
        /* transient poll failures are non-fatal; next tick retries */
      });
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return (
    <NotificationContext.Provider value={{ unread, refresh }}>
      {children}
    </NotificationContext.Provider>
  );
}
