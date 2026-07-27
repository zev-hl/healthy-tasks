import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { UserDto } from '@healthy-tasks/shared';
import { api, getToken, getTokenExpiresAt, setToken, setUnauthorizedHandler } from '../api/client';

interface AuthState {
  user: UserDto | null;
  loading: boolean;
  /** True when the session ended due to expiry/revocation (vs. a manual logout). */
  sessionExpired: boolean;
  /** True in the last minute before idle expiry — prompt the user to continue. */
  expiryWarning: boolean;
  /** Renew the session (resets the idle clock) and dismiss the warning. */
  extendSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<UserDto>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

// Poll the session clock frequently enough to surface the pre-expiry warning
// and the expiry itself promptly (rather than only when the next request fails).
const SESSION_CHECK_INTERVAL_MS = 10_000;
// Show the "continue session?" prompt this long before idle expiry.
const EXPIRY_WARNING_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [expiryWarning, setExpiryWarning] = useState(false);

  const expireSession = useCallback(() => {
    setToken(null);
    setExpiryWarning(false);
    setUser((current) => {
      // Only flag "expired" if we were actually logged in (not a manual logout).
      if (current) setSessionExpired(true);
      return null;
    });
  }, []);

  // Renew the session by making an authenticated request: the server re-issues a
  // token (sliding the idle window), which the API client adopts automatically.
  const extendSession = useCallback(async () => {
    try {
      await api.me();
      setExpiryWarning(false);
    } catch {
      // If it already lapsed, the 401 path will end the session and bounce.
    }
  }, []);

  // On mount, if we have a stored token, try to restore the session.
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setUser(me);
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // A 401 on any request (session expired/revoked) ends the session.
  useEffect(() => {
    setUnauthorizedHandler(expireSession);
    return () => setUnauthorizedHandler(null);
  }, [expireSession]);

  // Proactively watch the session clock: warn in the final minute, and end the
  // session (bounce to login) the moment it lapses — before the user submits a
  // form. Active use refreshes the token, pushing expiry out and hiding the warning.
  useEffect(() => {
    if (!user) return;
    const check = () => {
      const exp = getTokenExpiresAt();
      if (exp === null) {
        expireSession();
        return;
      }
      const remaining = exp - Date.now();
      if (remaining <= 0) expireSession();
      else setExpiryWarning(remaining <= EXPIRY_WARNING_MS);
    };
    check(); // run immediately so a near-expiry token warns without delay
    const handle = window.setInterval(check, SESSION_CHECK_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [user, expireSession]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      sessionExpired,
      expiryWarning,
      extendSession,
      async login(email, password) {
        const res = await api.login(email, password);
        setToken(res.token);
        setUser(res.user);
        setSessionExpired(false);
        setExpiryWarning(false);
        return res.user;
      },
      logout() {
        setToken(null);
        setUser(null);
        setSessionExpired(false);
        setExpiryWarning(false);
      },
    }),
    [user, loading, sessionExpired, expiryWarning, extendSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
