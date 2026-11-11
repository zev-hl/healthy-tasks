import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Fragment, useEffect, useState } from 'react';
import {
  Clock,
  LayoutDashboard,
  Layers,
  ListChecks,
  ScrollText,
  Settings,
  Target,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@healthy-tasks/shared';
import { useAuth } from '../auth/AuthContext';
import { NotificationProvider, useNotifications } from '../notifications/NotificationContext';
import { CommandPalette } from './CommandPalette';
import { Avatar, userLabel } from './ui/Avatar';
import { AppLauncher, appForPath, type AppKey } from './AppLauncher';
import { ToastProvider } from './harbor/Toast';
import { TimerPill } from './harbor/TimeBlock';
import { NativeEnhancer } from './harbor/NativeEnhancer';

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that light this item up (its tabs and sub-pages). */
  match: string[];
  roles?: Role[];
  /** Pages inside this section, listed under it while you are in the section. */
  subs?: { to: string; label: string; roles?: Role[] }[];
}

const MANAGERS: Role[] = ['Admin', 'Manager'];

/** HL Central's own sidebar, decided page by page (docs/redesign-decisions.md). */
const CENTRAL_NAV: NavEntry[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    match: ['/notifications', '/reports/due-date'],
  },
  {
    to: '/tasks',
    label: 'Tasks',
    icon: ListChecks,
    match: ['/tasks', '/admin/templates'],
    subs: [{ to: '/admin/templates', label: 'Templates', roles: MANAGERS }],
  },
  { to: '/time', label: 'Time', icon: Clock, match: ['/time', '/reports/time'] },
  { to: '/goals', label: 'Goals', icon: Target, match: ['/goals'] },
  {
    to: '/admin/organization',
    label: 'People',
    icon: Users,
    match: ['/admin/users', '/admin/organization'],
    roles: MANAGERS,
  },
  {
    to: '/admin/settings',
    label: 'Settings',
    icon: Settings,
    match: ['/admin/settings', '/admin/departments'],
    roles: ['Admin'],
  },
];

/** Exclusive Alerts: its own app, opened from the launcher, in the same shell. */
const EXCLUSIVES_NAV: NavEntry[] = [
  { to: '/exclusives/log', label: 'Alert Log', icon: ScrollText, match: ['/exclusives/log'] },
  { to: '/exclusives/groups', label: 'Alert Groups', icon: Layers, match: ['/exclusives/groups'] },
  {
    to: '/exclusives/alert-tasks',
    label: 'Alert Task Setup',
    icon: Workflow,
    match: ['/exclusives/alert-tasks'],
    roles: MANAGERS,
  },
];

const APP_NAMES: Record<AppKey, { name: string; mark: string }> = {
  central: { name: 'HL Central', mark: 'HL' },
  exclusives: { name: 'Exclusive Alerts', mark: 'EA' },
};

function taskIdOnPage(pathname: string): number | null {
  const m = /^\/tasks\/(\d+)$/.exec(pathname);
  return m ? Number(m[1]) : null;
}

function isUnder(pathname: string, base: string): boolean {
  return base === '/' ? pathname === '/' : pathname === base || pathname.startsWith(`${base}/`);
}

function Sidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const app = appForPath(pathname);
  const nav = (app === 'exclusives' ? EXCLUSIVES_NAV : CENTRAL_NAV).filter(
    (n) => !n.roles || (user && n.roles.includes(user.role)),
  );
  const brand = APP_NAMES[app];
  const home = app === 'exclusives' ? '/exclusives/log' : '/';

  return (
    <aside className="sidebar" aria-label={`${brand.name} menu`}>
      <Link to={home} className="side-brand">
        <span className="side-logo" aria-hidden="true">
          {brand.mark}
        </span>
        <span className="side-brand-name">{brand.name}</span>
      </Link>

      <nav className="side-nav" aria-label="Main">
        {nav.map((n) => {
          const active = isUnder(pathname, n.to) || n.match.some((m) => isUnder(pathname, m));
          const Icon = n.icon;
          const subs = (n.subs ?? []).filter(
            (s) => !s.roles || (user && s.roles.includes(user.role)),
          );
          const onSub = subs.some((s) => isUnder(pathname, s.to));
          return (
            <Fragment key={n.to}>
              <NavLink
                to={n.to}
                end={n.to === '/'}
                className={`side-nav-item${active ? (onSub ? ' open' : ' active') : ''}`}
                aria-current={active && !onSub ? 'page' : undefined}
                title={n.label}
              >
                <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                <span className="side-label">{n.label}</span>
              </NavLink>
              {active &&
                subs.map((s) => {
                  const here = isUnder(pathname, s.to);
                  return (
                    <NavLink
                      key={s.to}
                      to={s.to}
                      className={`side-sub-item${here ? ' active' : ''}`}
                      aria-current={here ? 'page' : undefined}
                    >
                      {s.label}
                    </NavLink>
                  );
                })}
            </Fragment>
          );
        })}
      </nav>

      <div className="side-spacer" />

      <TimerPill hiddenOnTaskId={taskIdOnPage(pathname)} />
      <AppLauncher current={app} />

      {user && (
        <Link
          to="/profile"
          className={`side-account${pathname === '/profile' ? ' active' : ''}`}
          title="Your profile"
        >
          <Avatar user={user} px={28} decorative />
          <span className="side-account-text">
            <span className="side-account-name">{userLabel(user)}</span>
            <span className="side-account-role">{user.role}</span>
          </span>
        </Link>
      )}
    </aside>
  );
}

/**
 * Global banner shown to EVERY user (not just admins) when the recurrence
 * background timer has gone stale — driven by the `schedulerDown` flag on the
 * unread-count heartbeat that the whole app already polls (Phase 11).
 */
function SchedulerBanner() {
  const { unread } = useNotifications();
  if (!unread?.schedulerDown) return null;
  return (
    <div className="scheduler-banner" role="alert">
      <strong>Background timer not running.</strong> Recurring tasks won’t be created — please
      contact an administrator.
    </div>
  );
}

export function Layout() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const location = useLocation();

  // Global Cmd/Ctrl+K toggles the command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdkOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A new page starts at its top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <NotificationProvider>
      <ToastProvider>
        <div className="app-shell">
          <Sidebar />
          <main className="app-main">
            <SchedulerBanner />
            <Outlet />
          </main>
        </div>
        {cmdkOpen && <CommandPalette onClose={() => setCmdkOpen(false)} />}
        <NativeEnhancer />
      </ToastProvider>
    </NotificationProvider>
  );
}
