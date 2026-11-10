import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
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
import { SectionTabs } from './SectionTabs';
import { ToastProvider } from './harbor/Toast';

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that light this item up (its tabs and sub-pages). */
  match: string[];
  roles?: Role[];
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
  { to: '/tasks', label: 'Tasks', icon: ListChecks, match: ['/tasks', '/admin/templates'] },
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
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={`side-nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              title={n.label}
            >
              <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
              <span className="side-label">{n.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="side-spacer" />

      <AppLauncher current={app} />

      {user && (
        <Link
          to="/profile"
          className={`side-account${pathname === '/profile' ? ' active' : ''}`}
          title="Your profile"
        >
          <Avatar user={user} px={32} decorative />
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
            <SectionTabs />
            <Outlet />
          </main>
        </div>
        {cmdkOpen && <CommandPalette onClose={() => setCmdkOpen(false)} />}
      </ToastProvider>
    </NotificationProvider>
  );
}
